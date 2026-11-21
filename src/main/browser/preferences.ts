import { parseAddress } from '../../shared/address';
import type { Store } from '../storage/store';
export interface SitePreferences {
  zoom: number;
  muted: boolean;
}
export function siteScope(url: string): string {
  const a = parseAddress(url);
  if (a.kind === 'file') return 'file://';
  return a.kind === 'ipfs' || a.kind === 'ipns'
    ? `${a.kind}://${a.root}`
    : new URL(a.internal).origin;
}
export function sitePreferences(store: Store, url: string): SitePreferences {
  const saved = store.get<Partial<SitePreferences>>(
    `site:${siteScope(url)}`,
    {},
  );
  return {
    zoom:
      Number.isInteger(saved?.zoom) && saved.zoom! >= 50 && saved.zoom! <= 200
        ? saved.zoom!
        : 100,
    muted: saved?.muted === true,
  };
}
