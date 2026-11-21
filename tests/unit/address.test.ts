import { CID } from 'multiformats/cid';
import { base36 } from 'multiformats/bases/base36';
import { describe, it, expect } from 'vitest';
import {
  parseAddress,
  displayAddress,
  navigationAddress,
} from '../../src/shared/address';
const cid = 'QmYwAPJzv5CZsnAzt8auVZRnGi2CgbkUrXTFhdD7V5ZyWb';
describe('addresses', () => {
  it('accepts CIDv1 base32 and base36', () => {
    const v1 = CID.parse(cid).toV1();
    for (const root of [v1.toString(), v1.toString(base36)])
      expect(parseAddress(`ipfs://${root}/`).root).toBe(root);
  });
  it('routes http through Chromium', () => {
    expect(parseAddress('https://example.org/x').internal).toBe(
      'https://example.org/x',
    );
    expect(parseAddress('http://localhost:8888').kind).toBe('http');
  });
  it('preserves case of CIDv0 and path, query and hash', () => {
    const a = parseAddress(`ipfs://${cid}/a.css?q=1#x`);
    expect(a.internal).toBe(`p2p://shared/ipfs/${cid}/a.css?q=1#x`);
    expect(displayAddress(a.internal)).toBe(a.display);
  });
  it('maps IPNS to the same origin', () =>
    expect(new URL(parseAddress('ipns://example.org/').internal).host).toBe(
      'shared',
    ));
  it('selects p2p handler and validates internal host', () => {
    expect(navigationAddress(`p2p://shared/ipfs/${cid}/`).kind).toBe('ipfs');
    expect(() => displayAddress(`p2p://evil/ipfs/${cid}/`)).toThrow();
  });
  it('accepts local files, spaces, queries and fragments', () => {
    expect(parseAddress('file:///tmp/Perun test.html?size=1#preview')).toEqual({
      kind: 'file',
      internal: 'file:///tmp/Perun%20test.html?size=1#preview',
      display: 'file:///tmp/Perun%20test.html?size=1#preview',
    });
    expect(navigationAddress('file://localhost/tmp/').display).toBe(
      'file:///tmp/',
    );
  });
  it.each([
    'file://other-host/remote.txt',
    'file:///tmp/%2fremote.txt',
    'file:///tmp/%00broken.txt',
    'javascript:alert(1)',
    'ipfs://bad/',
    'ipfs://' + cid + '/%2e%2e/',
    'ipfs://' + cid + '/%2fsecret',
    'ipfs://' + cid + '/../',
    'p2p://shared/',
    'https://a:b@example.org/',
  ])('rejects %s', (url) => expect(() => parseAddress(url)).toThrow());
});
