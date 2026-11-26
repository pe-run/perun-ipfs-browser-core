/* eslint-disable no-control-regex -- Reject control characters in untrusted URLs. */
import { t } from './i18n';
import { CID } from 'multiformats/cid';
import { base32 } from 'multiformats/bases/base32';
import { base58btc } from 'multiformats/bases/base58';
import { base36 } from 'multiformats/bases/base36';
export type Address = {
  kind: 'http' | 'https' | 'ipfs' | 'ipns' | 'file';
  display: string;
  internal: string;
  root?: string;
  path?: string;
};
export function canonicalCID(value: string): string {
  return CID.parse(
    value,
    base36.decoder.or(base32.decoder).or(base58btc.decoder),
  ).toString();
}
export function canBookmark(url?: string): boolean {
  return !!url && /^(https?|ipfs|ipns):\/\//i.test(url);
}
export function validCID(value: string): boolean {
  try {
    canonicalCID(value);
    return true;
  } catch {
    return false;
  }
}
export function parseAddress(input: string): Address {
  const value = input.trim();
  const file = /^file:\/\//i.test(value);
  if (
    !value ||
    value.length > 8192 ||
    /[\u0000-\u001f\u007f\\]/.test(value) ||
    (!file && value.includes(' '))
  )
    throw Error(t('invalidAddress'));
  if (file) {
    const url = new URL(value);
    if (
      !url.pathname.startsWith('/') ||
      url.host ||
      url.username ||
      url.password ||
      /[\u0000\\]/.test(decodeURIComponent(url.pathname)) ||
      /%2f/i.test(url.pathname)
    )
      throw Error(t('invalidPath'));
    return { kind: 'file', internal: url.href, display: url.href };
  }
  const match = /^(ipfs|ipns):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(
    value,
  );
  if (match) {
    const kind = match[1].toLowerCase() as 'ipfs' | 'ipns',
      root = match[2];
    if (
      kind === 'ipfs'
        ? !validCID(root)
        : !validCID(root) &&
          !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(root)
    )
      throw Error(t('invalidCID'));
    const path = match[3] || '/';
    for (const segment of path.split('/')) {
      const s = decodeURIComponent(segment);
      if (s === '..' || s === '.' || /[\\/\u0000]/.test(s))
        throw Error(t('invalidPath'));
    }
    const suffix = path + (match[4] || '') + (match[5] || '');
    return {
      kind,
      root,
      path,
      display: `${kind}://${root}${suffix}`,
      internal: `p2p://shared/${kind}/${root}${suffix}`,
    };
  }
  const u = new URL(value.includes('://') ? value : `https://${value}`);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
    throw Error(t('invalidProtocol'));
  return {
    kind: u.protocol.slice(0, -1) as 'http' | 'https',
    display: u.href,
    internal: u.href,
  };
}
export function displayAddress(internal: string): string {
  if (!internal.startsWith('p2p:')) return internal;
  const u = new URL(internal);
  if (u.host !== 'shared') throw Error(t('invalidAddress'));
  const m = /^\/(ipfs|ipns)\/([^/]+)(\/.*)?$/.exec(u.pathname);
  if (!m) throw Error(t('invalidPath'));
  return parseAddress(`${m[1]}://${m[2]}${m[3] || '/'}${u.search}${u.hash}`)
    .display;
}
export function navigationAddress(url: string): Address {
  return parseAddress(displayAddress(url));
}

export function faviconOrigin(url: string): string | undefined {
  if (!/^https?:\/\//i.test(url)) return;
  try {
    return new URL(parseAddress(url).internal).origin;
  } catch {
    return;
  }
}
