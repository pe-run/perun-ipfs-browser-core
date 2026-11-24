import { it, expect } from 'vitest';
import { createServer } from 'node:net';
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  lstat,
  symlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { KuboEngine } from '../../src/main/ipfs/engine';
const binary = resolve('resources/kubo/ipfs');
it('starts safely with a stale legacy socket and restarts after an actual SIGKILL, preserving PeerID', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubo-recovery-')),
    repo = join(dir, 'repo');
  let engine = new KuboEngine(binary, repo, true, false);
  try {
    await engine.start();
    const id = (await engine.json<{ ID: string }>('id')).ID;
    await engine.stop();
    // A real abandoned Unix socket, not an ordinary-file substitute.
    const fixture = await import('node:child_process');
    const legacy = join(repo, 'rpc.sock');
    const server = fixture.spawn(
      process.execPath,
      [
        '-e',
        "require('net').createServer().listen(process.argv[1],()=>process.stdout.write('ready'))",
        legacy,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await new Promise<void>((r, j) => {
      server.once('error', j);
      server.stdout.once('data', () => r());
    });
    const dead = new Promise<void>((r) => server.once('exit', () => r()));
    server.kill('SIGKILL');
    await dead;
    expect((await lstat(legacy)).isSocket()).toBe(true);
    await engine.start();
    expect(engine.socket).not.toBe(legacy);
    expect((await engine.json<{ ID: string }>('id')).ID).toBe(id);
    expect((await lstat(legacy)).isSocket()).toBe(true);
    const fixtureFile = join(dir, 'keep.txt');
    await writeFile(fixtureFile, 'Preserved data');
    const cid = await engine.cli('add', '-Q', fixtureFile);
    const oldSocket = engine.socket;
    const child = (
      engine as unknown as { child: import('node:child_process').ChildProcess }
    ).child;
    child.kill('SIGKILL');
    await expect.poll(() => engine.state).toBe('crashed');
    // Kubo may leave a stale file. A new start must never depend on reusing it.
    await engine.start();
    expect(engine.socket).not.toBe(oldSocket);
    expect(await new Response(await engine.get(cid)).text()).toBe(
      'Preserved data',
    );
    expect((await engine.json<{ ID: string }>('id')).ID).toBe(id);
  } finally {
    await engine.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);
it('refuses an active repository before changing its configuration or touching its socket', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubo-busy-')),
    repo = join(dir, 'repo');
  const owner = new KuboEngine(binary, repo, true, false),
    other = new KuboEngine(binary, repo, true, false);
  try {
    await owner.start();
    const config = await readFile(join(repo, 'config'), 'utf8'),
      socket = await lstat(owner.socket);
    await expect(other.start()).rejects.toThrow('already used');
    expect(await readFile(join(repo, 'config'), 'utf8')).toBe(config);
    expect((await lstat(owner.socket)).ino).toBe(socket.ino);
    expect(await owner.json('id')).toBeTruthy();
  } finally {
    await other.stop();
    await owner.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);
it('does not mistake an occupied non-Kubo legacy socket for its own ready daemon', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubo-foreign-')),
    repo = join(dir, 'repo');
  const engine = new KuboEngine(binary, repo, true, false);
  let server: ReturnType<typeof createServer> | undefined;
  try {
    await engine.start();
    await engine.stop();
    const config = await readFile(join(repo, 'config'), 'utf8');
    server = createServer((s) => s.end());
    await new Promise<void>((r) => server!.listen(join(repo, 'rpc.sock'), r));
    await expect(engine.start()).rejects.toThrow('already used');
    expect(await readFile(join(repo, 'config'), 'utf8')).toBe(config);
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await engine.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);

it('reports a missing daemon executable promptly even when the repository already exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubo-spawn-')),
    owner = new KuboEngine(binary, dir, true);
  try {
    await owner.start();
    await owner.stop();
    const missing = new KuboEngine('/missing/kubo', dir, true);
    await expect(missing.start()).rejects.toThrow('ENOENT');
    await missing.stop();
  } finally {
    await owner.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);

it('restarts a node that crashed after it had been running', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubo-auto-restart-'));
  const executable = join(dir, 'kubo');
  await symlink(binary, executable);
  const engine = new KuboEngine(executable, join(dir, 'repo'), true);
  try {
    await engine.start();
    const id = (await engine.json<{ ID: string }>('id')).ID;
    const child = (
      engine as unknown as { child: import('node:child_process').ChildProcess }
    ).child;
    await rm(executable);
    child.kill('SIGKILL');
    await expect.poll(() => engine.state, { timeout: 8000 }).toBe('failed');
    await symlink(binary, executable);
    await expect.poll(() => engine.state, { timeout: 30000 }).toBe('ready');
    expect((await engine.json<{ ID: string }>('id')).ID).toBe(id);
    const restored = (
      engine as unknown as { child: import('node:child_process').ChildProcess }
    ).child;
    restored.kill('SIGKILL');
    await expect.poll(() => engine.state).toBe('crashed');
    await engine.stop();
    const socket = engine.socket;
    await new Promise((resolve) => setTimeout(resolve, 5500));
    expect(engine.socket).toBe(socket);
  } finally {
    await engine.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);

it('keeps user storage limits and swarm addresses and rejects a malformed repository config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubo-config-')),
    repo = join(dir, 'repo'),
    config = join(repo, 'config');
  const engine = new KuboEngine(binary, repo, true, false);
  try {
    await engine.start();
    await engine.stop();
    const data = JSON.parse(await readFile(config, 'utf8'));
    // A fresh repository gets dynamic swarm ports.
    expect(data.Addresses.Swarm).toEqual([
      '/ip4/0.0.0.0/tcp/0',
      '/ip4/0.0.0.0/udp/0/quic-v1',
      '/ip6/::/tcp/0',
    ]);
    data.Datastore.StorageMax = '2GB';
    data.Addresses.Swarm = ['/ip4/127.0.0.1/tcp/0'];
    data.Addresses.Gateway = '/ip4/127.0.0.1/tcp/8080';
    await writeFile(config, JSON.stringify(data));
    await engine.start();
    await engine.stop();
    const saved = JSON.parse(await readFile(config, 'utf8'));
    expect(saved.Datastore.StorageMax).toBe('2GB');
    expect(saved.Addresses.Swarm).toEqual(['/ip4/127.0.0.1/tcp/0']);
    // The gateway and RPC endpoint stay private regardless of user edits.
    expect(saved.Addresses.Gateway).toBe('');
    expect(saved.Addresses.API).toMatch(/^\/unix\//);
    data.Addresses = 'broken';
    await writeFile(config, JSON.stringify(data));
    await expect(engine.start()).rejects.toThrow('Invalid Kubo repository');
    expect(engine.state).toBe('failed');
  } finally {
    await engine.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);

it('aborts a silent readiness RPC within the startup budget', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubo-silent-'));
  const repo = join(dir, 'repo');
  const owner = new KuboEngine(binary, repo, true);
  const executable = join(dir, 'silent-kubo');
  const engine = new KuboEngine(executable, repo, true);
  try {
    await owner.start();
    await owner.stop();
    await writeFile(
      executable,
      `#!${process.execPath}
const fs = require('node:fs');
const socket = JSON.parse(fs.readFileSync(process.env.IPFS_PATH + '/config')).Addresses.API.slice(5);
require('node:net').createServer(client => client.resume()).listen(socket);
`,
      { mode: 0o700 },
    );
    const started = performance.now();
    await expect(engine.start()).rejects.toThrow();
    expect(performance.now() - started).toBeGreaterThanOrEqual(29000);
    expect(performance.now() - started).toBeLessThan(40000);
    expect(engine.state).toBe('failed');
  } finally {
    await engine.stop();
    await owner.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 45000);
it('recovers manually after a failed first start', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubo-retry-')),
    repo = join(dir, 'repo');
  const owner = new KuboEngine(binary, repo, true, false),
    engine = new KuboEngine(binary, repo, true, false);
  try {
    await owner.start();
    await expect(engine.start()).rejects.toThrow('already used');
    expect(engine.state).toBe('failed');
    await owner.stop();
    await engine.restart();
    expect(engine.state).toBe('ready');
    expect(await engine.json('id')).toBeTruthy();
    // A running node can also be restarted on request.
    const socket = engine.socket;
    await engine.restart();
    expect(engine.state).toBe('ready');
    expect(engine.socket).not.toBe(socket);
  } finally {
    await owner.stop();
    await engine.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);
