import { expect, it } from 'vitest';
import { linkPreviewURL } from '../../src/shared/link-preview';
const cid = 'bafybeiaysi4s6lnjev27ln5icwm6tueaw2vdykrtjkwiphwekaywqhcjze';
it('shows original public link targets including paths, query and fragment', () => {
  expect(linkPreviewURL('https://example.org/a?q=1#part')).toBe(
    'https://example.org/a?q=1#part',
  );
  expect(linkPreviewURL(`p2p://shared/ipfs/${cid}/wiki/?q=1#part`)).toBe(
    `ipfs://${cid}/wiki/?q=1#part`,
  );
  expect(linkPreviewURL('p2p://shared/ipns/docs.ipfs.tech/path')).toBe(
    'ipns://docs.ipfs.tech/path',
  );
  expect(linkPreviewURL(`ipfs://${cid}/`)).toBe(`ipfs://${cid}/`);
  expect(linkPreviewURL('mailto:test@example.org')).toBe(
    'mailto:test@example.org',
  );
});
it('ignores empty, unsafe, malformed and internal UI targets', () => {
  for (const url of [
    '',
    'javascript:alert(1)',
    'file://remote.invalid/path',
    'data:text/html,hi',
    'p2p://other/ipns/example.org/',
    'p2p://shared/ipfs/not-a-cid/',
    'https://example.org/\nspoof',
    'not a URL',
  ])
    expect(linkPreviewURL(url)).toBe('');
});
