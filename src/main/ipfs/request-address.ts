import { navigationAddress } from '../../shared/address';

// Resolve only URL forms whose interpretation depends on Perun's shared origin.
export function requestRedirect(
  target: string,
  documentURL?: string,
): string | undefined {
  if (/^ip(?:fs|ns):\/\//i.test(target))
    return navigationAddress(target).internal;
  if (!target.startsWith('p2p:')) return;
  const url = new URL(target);
  if (url.username || url.password || (url.hostname === 'shared' && url.port))
    throw Error('Invalid content address');
  if (url.host !== 'shared') {
    if (!documentURL?.startsWith('p2p://shared/'))
      throw Error('Invalid content origin');
    // Chromium inherits the document scheme for //host/path links.
    return navigationAddress(
      'https://' + url.host + url.pathname + url.search + url.hash,
    ).internal;
  }
  if (
    /^\/(ipfs|ipns)(?:\/|$)/.test(url.pathname) ||
    !documentURL?.startsWith('p2p://shared/')
  )
    return;
  const document = navigationAddress(documentURL);
  if (!document.root) return;
  return navigationAddress(
    `p2p://shared/${document.kind}/${document.root}${url.pathname}${url.search}${url.hash}`,
  ).internal;
}
