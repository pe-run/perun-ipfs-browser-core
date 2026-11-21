import { it, expect } from 'vitest';
import { createServer } from 'node:net';
import { mkdtemp, readFile, writeFile, rm, lstat } from 'node:fs/promises';
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
  const engine = new KuboEngine(binary, join(dir, 'repo'), true);
  try {
    await engine.start();
    const id = (await engine.json<{ ID: string }>('id')).ID;
    const child = (
      engine as unknown as { child: import('node:child_process').ChildProcess }
    ).child;
    child.kill('SIGKILL');
    await expect.poll(() => engine.state).not.toBe('ready');
    await expect.poll(() => engine.state, { timeout: 30000 }).toBe('ready');
    expect((await engine.json<{ ID: string }>('id')).ID).toBe(id);
  } finally {
    await engine.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);

it('keeps user storage limits and rejects a malformed repository config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kubo-config-')),
    repo = join(dir, 'repo'),
    config = join(repo, 'config');
  const engine = new KuboEngine(binary, repo, true, false);
  try {
    await engine.start();
    await engine.stop();
    const data = JSON.parse(await readFile(config, 'utf8'));
    data.Datastore.StorageMax = '2GB';
    await writeFile(config, JSON.stringify(data));
    await engine.start();
    await engine.stop();
    expect(
      JSON.parse(await readFile(config, 'utf8')).Datastore.StorageMax,
    ).toBe('2GB');
    data.Addresses = 'broken';
    await writeFile(config, JSON.stringify(data));
    await expect(engine.start()).rejects.toThrow('Invalid Kubo repository');
    expect(engine.state).toBe('failed');
  } finally {
    await engine.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);
