import { describe, expect, it } from 'vitest';
import { requestRedirect } from '../../src/main/ipfs/request-address';

const cid = 'QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR';
const document = 'p2p://shared/ipns/docs.ipfs.tech/concepts/page.html';

describe('content address resolution', () => {
  it('preserves CIDv0 case, path, query and fragment', () => {
    expect(requestRedirect(`ipfs://${cid}/a?view=1#fragment`)).toBe(
      `p2p://shared/ipfs/${cid}/a?view=1#fragment`,
    );
  });

  it('uses the document root for root-relative paths and preserves explicit namespaces', () => {
    expect(requestRedirect('p2p://shared/assets/a.png?test=1', document)).toBe(
      'p2p://shared/ipns/docs.ipfs.tech/assets/a.png?test=1',
    );
    expect(
      requestRedirect(`p2p://shared/ipfs/${cid}/a`, document),
    ).toBeUndefined();
    expect(requestRedirect('p2p://shared/assets/a.png')).toBeUndefined();
  });

  it('uses HTTPS for network-path references resolved on a P2P page', () => {
    expect(requestRedirect(`p2p://ipfs.io/ipfs/${cid}`, document)).toBe(
      `https://ipfs.io/ipfs/${cid}`,
    );
    expect(
      requestRedirect(`http://127.0.0.1:8080/ipfs/${cid}`, document),
    ).toBeUndefined();
    expect(() => requestRedirect('p2p://ipfs.io/')).toThrow();
    expect(() => requestRedirect('p2p://user@shared/', document)).toThrow();
  });
});
