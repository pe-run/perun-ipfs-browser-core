import { displayAddress, parseAddress } from './address';
export function linkPreviewURL(target: string): string {
  if (
    !target ||
    target.length > 8192 ||
    Array.from(target).some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    )
  )
    return '';
  try {
    const url = new URL(target);
    if (['mailto:', 'tel:'].includes(url.protocol)) return url.href;
    const publicURL =
      url.protocol === 'p2p:' ? displayAddress(url.href) : target;
    return parseAddress(publicURL).display;
  } catch {
    return '';
  }
}
