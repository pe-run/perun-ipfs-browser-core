import { nativeImage } from 'electron';
import type { Session } from 'electron';
import type { Store } from '../storage/store';
import { safePNG } from './favicon-validation';
import { requestRedirect } from '../ipfs/request-address';
import { faviconOrigin } from '../../shared/address';
export class Favicons {
  readonly sources: Record<string, string[]> = {};
  private requests = new Map<
    string,
    Promise<{ images: string[]; sourceKey: string; cached: boolean }>
  >();
  private controllers = new Set<AbortController>();
  private stopped = false;
  constructor(
    private session: Session,
    private store: Store,
  ) {}
  observe(page: string, urls: string[]) {
    const origin = faviconOrigin(page);
    if (!origin) return false;
    const sources = [
      ...new Set(
        urls.flatMap((url) => {
          if (url.length > 8192) return [];
          if (
            /^data:image\/(?:png|jpeg|gif|webp|svg\+xml|x-icon)(?:;charset=utf-8)?(?:;base64)?,/i.test(
              url,
            )
          )
            return [url];
          try {
            const normalized = requestRedirect(url, page) ?? url;
            const candidate = faviconOrigin(normalized);
            return candidate &&
              !(origin.startsWith('https:') && normalized.startsWith('http:'))
              ? [normalized]
              : [];
          } catch {
            return [];
          }
        }),
      ),
    ].slice(0, 4);
    if (
      !sources.length ||
      JSON.stringify(this.sources[origin]) === JSON.stringify(sources)
    )
      return false;
    this.sources[origin] = sources;
    return true;
  }
  private cached(origin: string) {
    const cached = this.store.get<{ png?: string; sourceKey?: string }>(
      `favicon:${origin}`,
      {},
    );
    return safePNG(cached.png) ? cached : undefined;
  }
  async get(page: string) {
    const origin = faviconOrigin(page);
    if (!origin || this.stopped)
      return { images: [], sourceKey: '', cached: false };
    const sourceKey = JSON.stringify(this.sources[origin] || []),
      cached = this.cached(origin);
    if (cached && (!this.sources[origin] || cached.sourceKey === sourceKey))
      return { images: [cached.png!], sourceKey, cached: true };
    const key = origin + sourceKey,
      pending = this.requests.get(key);
    if (pending) return pending;
    const request = (async () => {
      const images: string[] = [];
      const urls = [
        ...new Set([...(this.sources[origin] || []), `${origin}/favicon.ico`]),
      ];
      // Decode in Chromium's sandboxed UI image decoder, not nativeImage (ICO/SVG support differs on Linux).
      for (const url of urls) {
        if (this.stopped) break;
        if (url.startsWith('data:image/')) {
          images.push(url);
          continue;
        }
        const controller = new AbortController();
        this.controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 4000);
        try {
          const response = await this.session.fetch(url, {
            signal: controller.signal,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
          });
          if (!response.ok || !response.body) {
            await response.body?.cancel();
            continue;
          }
          const declared = Number(response.headers.get('content-length') || 0);
          if (declared > 512 * 1024) {
            await response.body.cancel();
            continue;
          }
          const reader = response.body.getReader(),
            chunks: Uint8Array[] = [];
          let size = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > 512 * 1024) throw Error('Icon too large');
              chunks.push(value);
            }
          } finally {
            await reader.cancel();
          }
          let mime =
            response.headers
              .get('content-type')
              ?.split(';')[0]
              .trim()
              .toLowerCase() || 'image/x-icon';
          if (!/^image\/[a-z0-9.+-]+$/.test(mime)) mime = 'image/x-icon';
          images.push(
            `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`,
          );
        } catch {
          /* Missing or failed favicon: retain the default icon. */
        } finally {
          clearTimeout(timeout);
          this.controllers.delete(controller);
        }
      }
      return { images, sourceKey, cached: false, fallback: cached?.png };
    })();
    this.requests.set(key, request);
    void request.then(
      () => this.requests.delete(key),
      () => this.requests.delete(key),
    );
    return request;
  }
  save(page: string, png: string, sourceKey: string) {
    if (this.stopped) return false;
    const origin = faviconOrigin(page);
    if (!origin || !safePNG(png)) throw Error('Invalid favicon');
    if (sourceKey !== JSON.stringify(this.sources[origin] || [])) return false;
    const image = nativeImage.createFromDataURL(png);
    if (image.isEmpty()) throw Error('Invalid favicon');
    this.store.set(`favicon:${origin}`, { png, sourceKey });
    return true;
  }
  icon(page: string) {
    const origin = faviconOrigin(page);
    const png = origin && this.cached(origin)?.png;
    return png ? nativeImage.createFromDataURL(png) : undefined;
  }
  stop() {
    this.stopped = true;
    for (const controller of this.controllers) controller.abort();
    this.requests.clear();
  }
}
