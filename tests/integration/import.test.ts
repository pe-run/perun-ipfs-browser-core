import { serveP2P } from '../../src/main/ipfs/protocol';
import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { KuboEngine } from '../../src/main/ipfs/engine';
it('streams files and directories over RPC, pins, preserves names, and serves imported blocks to another peer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'perun-import-'));
  const binary = resolve('resources/kubo/ipfs');
  let a = new KuboEngine(binary, join(dir, 'a'), true);
  const b = new KuboEngine(binary, join(dir, 'b'));
  try {
    await a.start();
    const file = join(dir, 'Zażółć "plik".txt');
    await writeFile(file, 'Imported UTF-8');
    const binaryFile = join(dir, 'binary.dat');
    const bytes = Buffer.alloc(3 * 1024 * 1024, 127);
    await writeFile(binaryFile, bytes);
    const imported = await a.importPaths([file, binaryFile], 'files');
    expect(
      await new Response(await a.get(imported.cid, 'Zażółć "plik".txt')).text(),
    ).toBe('Imported UTF-8');
    expect(
      Buffer.from(
        await new Response(
          await a.get(imported.cid, 'binary.dat'),
        ).arrayBuffer(),
      ),
    ).toEqual(bytes);
    expect((await a.getStats()).pins).toContain(imported.cid);
    expect(await a.isPinned(imported.cid)).toBe(true);
    const alternate = await a.cli(
      'cid',
      'format',
      '-b',
      'base36',
      imported.cid,
    );
    expect(await a.isPinned(alternate)).toBe(true);
    const listing = await serveP2P(
      new Request(`p2p://shared/ipfs/${imported.cid}/`),
      a,
    );
    expect(listing.status).toBe(200);
    expect(listing.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'",
    );
    const listingHTML = await listing.text();
    expect(listingHTML).toContain('binary.dat');
    expect(listingHTML).toContain('Zażółć &quot;plik&quot;.txt');
    const fileResponse = await serveP2P(
      new Request(
        `p2p://shared/ipfs/${imported.cid}/${encodeURIComponent('Zażółć "plik".txt')}`,
      ),
      a,
    );
    expect(await fileResponse.text()).toBe('Imported UTF-8');
    const head = await serveP2P(
      new Request(`p2p://shared/ipfs/${imported.cid}/`, { method: 'HEAD' }),
      a,
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const identity = await a.json<{ ID: string }>('id');
    await a.cli('name', 'publish', '--allow-offline', `/ipfs/${imported.cid}`);
    expect(
      await (
        await serveP2P(new Request(`p2p://shared/ipns/${identity.ID}/`), a)
      ).text(),
    ).toContain('binary.dat');
    await a.unpin(imported.cid);
    expect(await a.isPinned(imported.cid)).toBe(false);
    await a.pin(imported.cid);

    const site = join(dir, 'site');
    await mkdir(join(site, 'empty'), { recursive: true });
    await writeFile(join(site, 'index.html'), '<h1>Imported website</h1>');
    const website = await a.importPaths([site], 'directory');
    expect(
      await new Response(await a.get(website.cid, 'index.html')).text(),
    ).toBe('<h1>Imported website</h1>');
    expect(
      (
        await a.json<{ Type: string }>('files/stat', {
          arg: `/ipfs/${website.cid}/empty`,
        })
      ).Type,
    ).toBe('directory');
    const empty = await serveP2P(
      new Request(`p2p://shared/ipfs/${website.cid}/empty/`),
      a,
    );
    expect(empty.status).toBe(200);
    expect(await empty.text()).toContain('href="../"');
    const bad = join(dir, 'bad');
    await mkdir(bad);
    await symlink(file, join(bad, 'link'));
    await expect(a.importPaths([bad], 'directory')).rejects.toThrow();
    await expect(
      a.importPaths([join(dir, 'missing')], 'files'),
    ).rejects.toThrow();
    const cancel = new AbortController();
    cancel.abort();
    await expect(
      a.importPaths([file], 'files', cancel.signal),
    ).rejects.toThrow();
    await a.stop();
    a = new KuboEngine(binary, join(dir, 'a'));
    await a.start();
    expect((await a.getStats()).pins).toContain(website.cid);
    await b.start();
    const id = await a.json<{ Addresses: string[] }>('id');
    const address = id.Addresses.find(
      (x) => x.startsWith('/ip4/127.0.0.1/') && x.includes('/tcp/'),
    )!;
    await b.cli('swarm', 'connect', address);
    expect(
      await new Response(await b.get(website.cid, 'index.html')).text(),
    ).toBe('<h1>Imported website</h1>');
  } finally {
    await Promise.all([a.stop(), b.stop()]);
    await rm(dir, { recursive: true, force: true });
  }
}, 90000);
