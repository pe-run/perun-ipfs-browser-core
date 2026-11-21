import { it, expect } from 'vitest';
import { directoryResponse } from '../../src/main/ipfs/directory';
it('escapes directory names, encodes links, blocks traversal and disables scripts', async () => {
  const response = directoryResponse(
    new Request('p2p://shared/ipfs/cid/'),
    'ipfs://cid/',
    '/',
    [
      { Name: '<img src=x onerror=alert(1)>.txt', Type: 2, Size: 0 },
      { Name: '../escape', Type: 2, Size: 0 },
      { Name: '..', Type: 1, Size: 0 },
      { Name: 'subdir', Type: 1, Size: 0 },
      { Name: 'a #?.txt', Type: 2, Size: 0 },
    ],
  );
  const html = await response.text();
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;img');
  expect(html).toContain('a%20%23%3F.txt');
  expect(html).not.toContain('../escape');
  expect(html).toContain('href="subdir/"');
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "default-src 'none'",
  );
  expect(html).not.toContain('href="../"');
});
it('supports HEAD and prevents parent navigation above the CID root', async () => {
  const response = directoryResponse(
    new Request('p2p://shared/ipfs/cid/x/', { method: 'HEAD' }),
    'ipfs://cid/x/',
    '/x/',
    [],
  );
  expect(await response.text()).toBe('');
  expect(Number(response.headers.get('content-length'))).toBeGreaterThan(0);
});
