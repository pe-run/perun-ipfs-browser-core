import { assertRepositoryInactive, privateSocket, kuboFailure } from './socket';
import { t } from '../../shared/i18n';
import { importToKubo, type ImportMode, type ImportResult } from './import';
import { spawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, open, chmod, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { request } from 'node:http';
import { Readable } from 'node:stream';
import type { NodeState } from '../../shared/types';
export type { NodeState };
const exec = promisify(execFile);
const restartDelays = [1000, 5000, 15000];
const ipnsCacheMs = 30000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export interface PeerInfo {
  Peer: string;
  Addr: string;
}
export interface IPFSStats {
  peerID: string;
  peers: number;
  repoBytes: number;
  totalIn: number | null;
  totalOut: number | null;
  pins: string[];
}
export interface IPFSEngine {
  readonly state: NodeState;
  readonly detail: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  get(
    cid: string,
    path?: string,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>>;
  importPaths(
    paths: string[],
    mode: ImportMode,
    signal?: AbortSignal,
  ): Promise<ImportResult>;
  resolveIPNS(name: string): Promise<string>;
  isPinned(cid: string): Promise<boolean>;
  pin(cid: string): Promise<void>;
  unpin(cid: string): Promise<void>;
  getPeers(): Promise<PeerInfo[]>;
  getStats(): Promise<IPFSStats>;
}
export class KuboEngine implements IPFSEngine {
  private child?: ChildProcess;
  private stopping = false;
  private imports = new Set<AbortController>();
  // Machine-readable state; `detail` carries the untranslated diagnostic.
  state: NodeState = 'stopped';
  detail = '';
  private socketPath: string;
  private starting = false;
  private restarts = 0;
  private restartTimer?: NodeJS.Timeout;
  private readySince = 0;
  get socket() {
    return this.socketPath;
  }
  logs = '';
  constructor(
    readonly binary: string,
    readonly repo: string,
    private offline = false,
    private autoRestart = true,
  ) {
    this.socketPath = privateSocket(repo);
  }
  private env() {
    return { ...process.env, IPFS_PATH: this.repo };
  }
  async cli(...args: string[]) {
    return (
      await exec(this.binary, args, {
        env: this.env(),
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout.trim();
  }
  async start() {
    if (this.child || this.starting) throw Error('Kubo already started');
    this.starting = true;
    this.logs = '';
    this.ipnsCache.clear();
    this.socketPath = privateSocket(this.repo);
    this.state = 'starting';
    this.detail = '';
    this.stopping = false;
    try {
      await mkdir(this.repo, { recursive: true, mode: 0o700 });
      await chmod(this.repo, 0o700);
      let text: string;
      try {
        text = await readFile(join(this.repo, 'config'), 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        await this.cli('init', '--profile=lowpower');
        text = await readFile(join(this.repo, 'config'), 'utf8');
      }
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed) || !isRecord(parsed.Identity))
        throw Error(t('invalidRepo'));
      for (const section of ['Addresses', 'Datastore'])
        if (parsed[section] === undefined) parsed[section] = {};
        else if (!isRecord(parsed[section])) throw Error(t('invalidRepo'));
      const config = parsed as Record<string, unknown> & {
        Identity: Record<string, unknown>;
        Addresses: Record<string, unknown>;
        Datastore: Record<string, unknown>;
      };
      await assertRepositoryInactive(this.repo, config.Addresses.API);
      if (!config.Identity.PeerID) throw Error(t('invalidRepo'));
      config.Addresses.API = `/unix${this.socket}`;
      config.Addresses.Gateway = '';
      config.Addresses.Swarm = [
        '/ip4/0.0.0.0/tcp/0',
        '/ip4/0.0.0.0/udp/0/quic-v1',
        '/ip6/::/tcp/0',
      ];
      // Defaults only: a limit that the user already set in the repo is kept.
      config.Datastore.StorageMax ??= '10GB';
      config.Datastore.StorageGCWatermark ??= 90;
      config.Datastore.GCPeriod ??= '1h';
      const next = await open(join(this.repo, 'config.next'), 'w', 0o600);
      try {
        await next.writeFile(JSON.stringify(config, null, 2));
        await next.sync();
      } finally {
        await next.close();
      }
      await rename(join(this.repo, 'config.next'), join(this.repo, 'config'));
      if (this.stopping) throw Error('Kubo startup cancelled');
      this.child = spawn(
        this.binary,
        ['daemon', '--enable-gc', ...(this.offline ? ['--offline'] : [])],
        { env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] },
      );
      this.child.stdout?.on('data', (b) => {
        this.logs = (this.logs + b).slice(-16000);
      });
      this.child.stderr?.on('data', (b) => {
        this.logs = (this.logs + b).slice(-16000);
      });
      this.child.on('error', (e) => {
        this.child = undefined;
        this.state = 'failed';
        this.detail = e.message;
      });
      this.child.on('exit', (code) => {
        this.child = undefined;
        if (this.stopping) {
          this.state = 'stopped';
          this.detail = '';
        } else {
          const wasReady = this.state === 'ready';
          this.state = 'crashed';
          this.detail = `(${code}): ${kuboFailure(this.logs)}`;
          if (wasReady) {
            if (Date.now() - this.readySince > 60000) this.restarts = 0;
            this.scheduleRestart();
          }
        }
      });
      const deadline = AbortSignal.timeout(30000);
      while (!deadline.aborted && !this.stopping) {
        if (!this.child)
          throw Error(
            (this.state as NodeState) === 'crashed'
              ? t('nodeCrash', { error: this.detail })
              : this.detail,
          );
        try {
          await this.json('id', {}, deadline);
          if (deadline.aborted || this.stopping) break;
          await chmod(this.socket, 0o600);
          this.state = 'ready';
          this.detail = '';
          this.readySince = Date.now();
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      throw Error(t('startTimeout', { error: this.logs }));
    } catch (e) {
      await this.stopChild();
      this.state = this.stopping ? 'stopped' : 'failed';
      this.detail = (e as Error).message;
      throw e;
    } finally {
      this.starting = false;
    }
  }
  // Bounded recovery after a crash of a node that had been running.
  private scheduleRestart() {
    if (!this.autoRestart || this.stopping) return;
    if (this.restarts >= restartDelays.length) return;
    const delay = restartDelays[this.restarts++];
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.stopping || this.child || this.starting) return;
      this.start().catch(() => this.scheduleRestart());
    }, delay);
  }
  async rpc(
    command: string,
    params: Record<string, string> = {},
    signal?: AbortSignal,
    body?: Uint8Array,
    contentType = 'application/octet-stream',
    timeoutMs = 60000,
  ): Promise<Readable> {
    const query = new URLSearchParams(params);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socket,
          path: `/api/v0/${command}?${query}`,
          method: 'POST',
          ...(body
            ? {
                headers: {
                  'Content-Type': contentType,
                  'Content-Length': body.length,
                },
              }
            : {}),
          signal,
          timeout: timeoutMs,
        },
        (res) => {
          if (res.statusCode === 200) resolve(res);
          else {
            const parts: Buffer[] = [];
            let bytes = 0;
            res.on('data', (b: Buffer) => {
              bytes += b.length;
              if (bytes < 65536) parts.push(b);
            });
            res.on('end', () =>
              reject(
                Error(
                  Buffer.concat(parts).toString() || `RPC ${res.statusCode}`,
                ),
              ),
            );
          }
        },
      );
      req.on('timeout', () => req.destroy(Error(t('rpcTimeout'))));
      req.on('error', reject);
      req.end(body);
    });
  }
  async json<T = Record<string, unknown>>(
    command: string,
    params: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const stream = await this.rpc(command, params, signal);
    const parts: Buffer[] = [];
    for await (const chunk of stream) parts.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(parts).toString()) as T;
  }
  async get(cid: string, path = '', signal?: AbortSignal) {
    return Readable.toWeb(
      await this.rpc(
        'cat',
        { arg: `/ipfs/${cid}/${path.replace(/^\//, '')}` },
        signal,
      ),
    ) as ReadableStream<Uint8Array>;
  }
  async importPaths(
    paths: string[],
    mode: ImportMode,
    signal?: AbortSignal,
  ): Promise<ImportResult> {
    if (!this.child || this.state !== 'ready') throw Error(t('nodeNotReady'));
    const abort = new AbortController();
    this.imports.add(abort);
    try {
      return await importToKubo(
        this.socket,
        paths,
        mode,
        signal ? AbortSignal.any([signal, abort.signal]) : abort.signal,
      );
    } finally {
      this.imports.delete(abort);
    }
  }
  // A page issues many requests; resolve each IPNS name once per short window.
  private ipnsCache = new Map<
    string,
    { path: Promise<string>; expires: number }
  >();
  resolveIPNS(name: string): Promise<string> {
    const now = Date.now();
    const cached = this.ipnsCache.get(name);
    if (cached && cached.expires > now) return cached.path;
    for (const [key, entry] of this.ipnsCache)
      if (entry.expires <= now) this.ipnsCache.delete(key);
    if (this.ipnsCache.size >= 256)
      this.ipnsCache.delete(this.ipnsCache.keys().next().value!);
    const path = this.json<{ Path: string }>('name/resolve', {
      arg: `/ipns/${name}`,
      recursive: 'true',
    }).then((result) => result.Path);
    const entry = { path, expires: now + ipnsCacheMs };
    this.ipnsCache.set(name, entry);
    // Failures are not cached.
    path.catch(() => {
      if (this.ipnsCache.get(name) === entry) this.ipnsCache.delete(name);
    });
    return path;
  }
  async isPinned(cid: string): Promise<boolean> {
    try {
      const result = await this.json<{ Keys: Record<string, unknown> }>(
        'pin/ls',
        { arg: cid, type: 'recursive' },
      );
      return Boolean(result.Keys?.[cid]);
    } catch (error) {
      if (/not pinned/i.test((error as Error).message)) return false;
      throw error;
    }
  }
  async pin(cid: string) {
    await this.json('pin/add', { arg: cid });
  }
  async unpin(cid: string) {
    await this.json('pin/rm', { arg: cid });
  }
  async getPeers() {
    if (this.offline) return [];
    return (
      (await this.json<{ Peers: PeerInfo[] | null }>('swarm/peers')).Peers || []
    );
  }
  async getStats(): Promise<IPFSStats> {
    const [id, peers, repo, bw, pins] = await Promise.all([
      this.json<{ ID: string }>('id'),
      this.getPeers(),
      this.json<{ RepoSize: number }>('repo/stat'),
      this.offline
        ? Promise.resolve({ TotalIn: null, TotalOut: null })
        : this.json<{ TotalIn: number; TotalOut: number }>('stats/bw'),
      this.json<{ Keys: Record<string, unknown> }>('pin/ls', {
        type: 'recursive',
      }),
    ]);
    return {
      peerID: id.ID,
      peers: peers.length,
      repoBytes: repo.RepoSize,
      totalIn: bw.TotalIn,
      totalOut: bw.TotalOut,
      pins: Object.keys(pins.Keys || {}),
    };
  }
  /** Manual recovery, also after a failed first start or exhausted restarts. */
  async restart() {
    if (this.starting) throw Error(t('nodeStarting'));
    await this.stop();
    this.restarts = 0;
    await this.start();
  }
  async stop() {
    this.stopping = true;
    this.ipnsCache.clear();
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    for (const abort of this.imports) abort.abort();
    await this.stopChild();
  }
  private async stopChild() {
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => child.kill('SIGKILL'), 8000);
      child.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
}
