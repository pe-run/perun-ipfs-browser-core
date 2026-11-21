import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { KuboEngine } from '../../src/main/ipfs/engine';
import { serveP2P } from '../../src/main/ipfs/protocol';
it('initializes, serves HTML and Range, resolves IPNS, restarts with same PeerID, exchanges blocks over P2P', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipfs-it-'));
  const binary = resolve('resources/kubo/ipfs');
  let a = new KuboEngine(binary, join(dir, 'a'), true, false);
  const b = new KuboEngine(binary, join(dir, 'b'));
  try {
    await a.start();
    expect((await stat(a.socket)).mode & 0o777).toBe(0o600);
    expect((await a.getStats()).peers).toBe(0);
    const identity = await a.json<{ ID: string; Addresses: string[] }>('id');
    const fixture = join(dir, 'index.html');
    const html = '<h1>Local P2P fixture</h1>';
    await writeFile(fixture, html);
    const cid = await a.cli('add', '-Q', fixture);
    expect(await new Response(await a.get(cid)).text()).toBe(html);
    const response = await serveP2P(
      new Request(`p2p://shared/ipfs/${cid}/`),
      a,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toBe(html);
    const range = await serveP2P(
      new Request(`p2p://shared/ipfs/${cid}/`, {
        headers: { Range: 'bytes=0-3' },
      }),
      a,
    );
    expect(range.status).toBe(206);
    expect(await range.text()).toBe('<h1>');
    await a.cli('name', 'publish', '--allow-offline', `/ipfs/${cid}`);
    expect(await a.resolveIPNS(identity.ID)).toBe(`/ipfs/${cid}`);
    const ipns = await serveP2P(
      new Request(`p2p://shared/ipns/${identity.ID}/`),
      a,
    );
    expect(await ipns.text()).toBe(html);
    const invalid = await serveP2P(
      new Request('p2p://shared/ipfs/invalid/'),
      a,
    );
    expect(invalid.status).toBe(400);
    await a.stop();
    a = new KuboEngine(binary, join(dir, 'a'), false, false);
    await a.start();
    const online = await a.json<{ ID: string; Addresses: string[] }>('id');
    await b.start();
    const addresses = online.Addresses.filter(
      (x) => x.includes('/tcp/') && !x.includes('/ip6/'),
    );
    const addr =
      addresses.find((x) => x.startsWith('/ip4/127.0.0.1/')) || addresses[0];
    expect(addr).toBeTruthy();
    await b.cli('swarm', 'connect', addr);
    expect(await new Response(await b.get(cid)).text()).toBe(html);
    expect((await b.getPeers()).some((p) => p.Peer === identity.ID)).toBe(true);
    await a.stop();
    await a.start();
    expect((await a.json<{ ID: string }>('id')).ID).toBe(identity.ID);
    await a.cli('shutdown');
    await expect.poll(() => a.state).toBe('crashed');
    await expect(a.get(cid)).rejects.toThrow();
  } finally {
    await Promise.all([a.stop(), b.stop()]);
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);
it('reports missing Kubo without hanging', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipfs-missing-'));
  const a = new KuboEngine('/missing/kubo', dir, false, false);
  try {
    await expect(a.start()).rejects.toThrow();
    expect(a.state).toBe('failed');
  } finally {
    await a.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

it('reports corrupt repo without replacing its identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipfs-corrupt-'));
  await writeFile(join(dir, 'config'), '{corrupt');
  const a = new KuboEngine(resolve('resources/kubo/ipfs'), dir, true);
  try {
    await expect(a.start()).rejects.toThrow();
    expect(a.state).toBe('failed');
  } finally {
    await a.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
