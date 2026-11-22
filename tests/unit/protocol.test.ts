import { it, expect } from 'vitest';
import { notFoundPattern, serveP2P } from '../../src/main/ipfs/protocol';
import type { KuboEngine } from '../../src/main/ipfs/engine';

const failing = {
  json: () => Promise.reject(Error('should not be reached')),
} as unknown as KuboEngine;

it('answers malformed addresses with 400 instead of a gateway error', async () => {
  for (const url of [
    'p2p://shared/ipfs/not-a-cid/',
    'p2p://shared/ipfs/bafybeiaysi4s6lnjev27ln5icwm6tueaw2vdykrtjkwiphwekaywqhcjze/%E0%A4%A',
    'p2p://shared/ipfs/bafybeiaysi4s6lnjev27ln5icwm6tueaw2vdykrtjkwiphwekaywqhcjze/%2e%2e/x',
  ])
    expect((await serveP2P(new Request(url), failing)).status, url).toBe(400);
});

it('recognizes the Kubo messages that mean a missing path', () => {
  for (const message of [
    'file does not exist',
    'no link named "x" under bafy',
    'path not found',
  ])
    expect(notFoundPattern.test(message), message).toBe(true);
  expect(notFoundPattern.test('context deadline exceeded')).toBe(false);
});

it.each(['files/stat', 'index', 'ls'])(
  'cancels the outstanding %s request',
  async (stage) => {
    const controller = new AbortController();
    const request = new Request(
      'p2p://shared/ipfs/bafybeiaysi4s6lnjev27ln5icwm6tueaw2vdykrtjkwiphwekaywqhcjze/',
      { signal: controller.signal },
    );
    const engine = {
      async json(
        command: string,
        { arg }: { arg: string },
        signal: AbortSignal,
      ) {
        const current = arg.endsWith('/index.html') ? 'index' : command;
        expect(signal).toBe(request.signal);
        if (current === stage) {
          controller.abort();
          signal.throwIfAborted();
        }
        if (current === 'index') throw Error('not found');
        return { Type: 'directory' };
      },
    } as unknown as KuboEngine;
    await expect(serveP2P(request, engine)).rejects.toMatchObject({
      name: 'AbortError',
    });
  },
);

it('cancels one IPNS request while another keeps waiting for the same resolution', async () => {
  const controller = new AbortController();
  const url = 'p2p://shared/ipns/example.org/page.txt';
  const resolution = Promise.withResolvers<string>();
  const engine = {
    resolveIPNS: () => resolution.promise,
    json: async () => ({ Type: 'file', Size: 1 }),
  } as unknown as KuboEngine;
  const cancelled = serveP2P(
    new Request(url, { signal: controller.signal }),
    engine,
  );
  const remaining = serveP2P(new Request(url, { method: 'HEAD' }), engine);
  controller.abort();
  await expect(cancelled).rejects.toBe(controller.signal.reason);
  resolution.resolve('/ipfs/cid');
  expect((await remaining).status).toBe(200);
});
