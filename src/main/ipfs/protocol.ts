import { directoryResponse, type DirectoryLink } from './directory';
import { t, localizeMessage } from '../../shared/i18n';
import type { Session } from 'electron';
import { Readable } from 'node:stream';
import { fileTypeFromBuffer } from 'file-type';
import { lookup } from 'mime-types';
import { navigationAddress } from '../../shared/address';
import type { KuboEngine } from './engine';
// Kubo reports missing paths only in the message text of an HTTP 500.
export const notFoundPattern = /not found|no link|does not exist/i;
export async function serveP2P(
  request: Request,
  engine: KuboEngine,
): Promise<Response> {
  try {
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response('Only GET/HEAD', { status: 405 });
    let address: ReturnType<typeof navigationAddress>;
    try {
      address = navigationAddress(request.url);
    } catch (error) {
      // Malformed CID, path or percent-encoding is the client's mistake.
      return new Response(
        t('ipfsFailed', { error: localizeMessage((error as Error).message) }),
        {
          status: 400,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        },
      );
    }
    if (!address.root || !address.path)
      return new Response('Missing content path', { status: 400 });
    let root =
      address.kind === 'ipns'
        ? await engine.resolveIPNS(address.root)
        : `/ipfs/${address.root}`;
    let path = `${root}${decodeURIComponent(address.path)}`;
    let stat = await engine.json<{ Type: string; Size: number }>('files/stat', {
      arg: path,
    });
    if (stat.Type === 'directory') {
      if (!new URL(request.url).pathname.endsWith('/')) {
        const u = new URL(request.url);
        u.pathname += '/';
        return new Response(null, {
          status: 301,
          headers: { Location: u.href },
        });
      }
      let index: typeof stat | undefined;
      try {
        index = await engine.json('files/stat', { arg: path + 'index.html' });
      } catch (error) {
        if (!notFoundPattern.test((error as Error).message)) throw error;
      }
      if (!index || index.Type !== 'file') {
        const listing = await engine.json<{
          Objects: { Links: DirectoryLink[] | null }[];
        }>('ls', { arg: path, 'resolve-type': 'true', size: 'false' });
        return directoryResponse(
          request,
          address.display,
          address.path,
          listing.Objects[0]?.Links || [],
        );
      }
      path += 'index.html';
      stat = index;
    }
    let mime = lookup(path);
    if (!mime) {
      const sample = await engine.rpc(
        'cat',
        { arg: path, offset: '0', length: '4096' },
        request.signal,
      );
      const chunks: Buffer[] = [];
      for await (const chunk of sample) chunks.push(Buffer.from(chunk));
      const prefix = Buffer.concat(chunks);
      const detected = await fileTypeFromBuffer(prefix).catch(() => undefined);
      const text = prefix.toString('utf8').trimStart();
      mime =
        detected?.mime ||
        (/^(?:<!doctype\s+html|<html|<head|<body|<h[1-6]|<!--)/i.test(text)
          ? 'text/html; charset=utf-8'
          : /^<\?xml/i.test(text)
            ? 'application/xml'
            : /^[{[]/.test(text)
              ? 'application/json'
              : !prefix.includes(0) && !text.includes('�')
                ? 'text/plain; charset=utf-8'
                : 'application/octet-stream');
    }
    const headers = new Headers({
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    });
    // No Service Worker registration on the shared origin.
    headers.set('Content-Security-Policy', "worker-src 'none'");
    let start = 0,
      end = stat.Size - 1,
      status = 200;
    const range = request.headers.get('range');
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2]))
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.Size}` },
        });
      if (!m[1]) start = Math.max(0, stat.Size - Number(m[2]));
      else {
        start = Number(m[1]);
        if (m[2]) end = Math.min(end, Number(m[2]));
      }
      if (start > end || start >= stat.Size)
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.Size}` },
        });
      status = 206;
      headers.set('Content-Range', `bytes ${start}-${end}/${stat.Size}`);
    }
    headers.set('Content-Length', String(Math.max(0, end - start + 1)));
    if (request.method === 'HEAD' || stat.Size === 0)
      return new Response(null, { status, headers });
    const body = Readable.toWeb(
      await engine.rpc(
        'cat',
        { arg: path, offset: String(start), length: String(end - start + 1) },
        request.signal,
      ),
    ) as ReadableStream<Uint8Array>;
    return new Response(body, { status, headers });
  } catch (error) {
    const message = (error as Error).message;
    const status = notFoundPattern.test(message) ? 404 : 502;
    return new Response(t('ipfsFailed', { error: localizeMessage(message) }), {
      status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
export function installP2P(session: Session, engine: KuboEngine) {
  session.protocol.handle('p2p', (request) => serveP2P(request, engine));
  for (const scheme of ['ipfs', 'ipns']) {
    session.protocol.handle(scheme, (request) => {
      try {
        return Response.redirect(navigationAddress(request.url).internal, 307);
      } catch {
        return new Response('Invalid IPFS/IPNS URL', { status: 400 });
      }
    });
  }
}
