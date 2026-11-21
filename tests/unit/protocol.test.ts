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
