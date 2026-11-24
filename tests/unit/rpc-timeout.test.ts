import { it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KuboEngine } from '../../src/main/ipfs/engine';

let server: Server | undefined, dir: string | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve(),
  );
  if (dir) rmSync(dir, { recursive: true, force: true });
  server = dir = undefined;
});

/** A fake RPC endpoint that sends one chunk, stays silent, then finishes. */
async function fakeEngine(silenceMs: number) {
  dir = mkdtempSync(join(tmpdir(), 'rpc-'));
  const engine = new KuboEngine('/nonexistent', dir);
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.write('first ');
    setTimeout(() => res.end('last'), silenceMs);
  });
  await new Promise<void>((resolve) => server!.listen(engine.socket, resolve));
  return engine;
}
async function read(stream: AsyncIterable<Buffer>) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

it('keeps a started content stream open through a pause longer than the idle timeout', async () => {
  const engine = await fakeEngine(300);
  const stream = await engine.rpc('cat', {}, undefined, {
    timeoutMs: 100,
    streaming: true,
  });
  expect(await read(stream)).toBe('first last');
});

it('still times out an idle non-streaming response', async () => {
  const engine = await fakeEngine(300);
  const stream = await engine.rpc('cat', {}, undefined, { timeoutMs: 100 });
  await expect(read(stream)).rejects.toThrow();
});
