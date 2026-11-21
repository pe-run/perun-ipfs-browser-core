import { it, expect } from 'vitest';
import { privateSocket, kuboFailure } from '../../src/main/ipfs/socket';
it('allocates a fresh private socket and rejects Unix paths beyond the OS limit', () => {
  const a = privateSocket('/tmp/repo'),
    b = privateSocket('/tmp/repo');
  expect(a).not.toBe(b);
  expect(a).toMatch(/^\/tmp\/repo\/rpc-[a-f0-9]{12}\.sock$/);
  expect(() => privateSocket('/' + 'x'.repeat(108))).toThrow('too long');
});
it('shows the actual fatal error rather than unrelated swarm startup addresses', () => {
  expect(
    kuboFailure(
      'Swarm listening on 172.21.0.1:1234\nError: serveHTTPApi: bind: address already in use\nSwarm listening on 127.0.0.1:9999\n',
    ),
  ).toBe('Error: serveHTTPApi: bind: address already in use');
});
