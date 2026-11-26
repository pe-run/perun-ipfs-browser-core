import web from '../../resources/branding/site-web.svg?url';
import ipfs from '../../resources/branding/site-ipfs.svg?url';
import { faviconOrigin } from '../shared/address';
import type { BrowserAPI } from '../shared/types';
let sources: Record<string, string[]> = {};
const requests = new Map<string, Promise<string | undefined>>();
export function setIconSources(value: Record<string, string[]>) {
  sources = value;
}
async function decode(data: string) {
  const image = new Image();
  image.src = data;
  await image.decode();
  if (
    !image.naturalWidth ||
    !image.naturalHeight ||
    image.naturalWidth > 4096 ||
    image.naturalHeight > 4096
  )
    throw Error('Invalid icon dimensions');
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0, 16, 16);
  return canvas.toDataURL('image/png');
}
export function siteIcon(url: string, api: BrowserAPI) {
  const image = document.createElement('img');
  image.className = 'site-icon';
  image.width = 16;
  image.height = 16;
  image.alt = '';
  image.draggable = false;
  const kind =
    url.startsWith('ipfs:') || url.startsWith('p2p:')
      ? 'ipfs'
      : url.startsWith('ipns:')
        ? 'ipns'
        : 'web';
  image.dataset.kind = kind;
  image.dataset.url = url;
  image.src = { web, ipfs, ipns: ipfs }[kind];
  const origin = faviconOrigin(url);
  if (!origin) return image;
  const key = origin + JSON.stringify(sources[origin] || []);
  let request = requests.get(key);
  if (!request) {
    request = (async () => {
      const result = (await api.command({ action: 'getFavicon', url })) as {
        images: string[];
        sourceKey: string;
        cached: boolean;
        fallback?: string;
      };
      if (result.cached) return result.images[0];
      for (const data of result.images) {
        try {
          const png = await decode(data);
          if (
            await api.command({
              action: 'saveFavicon',
              url,
              image: png,
              sourceKey: result.sourceKey,
            })
          )
            return png;
        } catch {
          /* Try the next declared icon, then conventional favicon.ico. */
        }
      }
      return result.fallback;
    })().catch(() => undefined);
    requests.set(key, request);
  }
  void request.then((png) => {
    if (png && image.isConnected) {
      image.src = png;
      image.dataset.favicon = 'true';
    }
  });
  return image;
}

export function refreshIcons(api: BrowserAPI) {
  for (const image of document.querySelectorAll<HTMLImageElement>(
    'img.site-icon',
  ))
    image.replaceWith(siteIcon(image.dataset.url || '', api));
}
