import { net, type Session } from 'electron';
import { opendir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseAddress } from '../../shared/address';
import { directoryResponse, type DirectoryLink } from '../ipfs/directory';

export function installLocalFiles(session: Session) {
  session.protocol.handle('file', async (request) => {
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response('Only GET/HEAD', { status: 405 });
    try {
      const url = new URL(parseAddress(request.url).internal);
      const path = fileURLToPath(url);
      const entry = await stat(path);
      if (entry.isFile())
        return await net.fetch(request, { bypassCustomProtocolHandlers: true });
      if (!entry.isDirectory())
        return new Response('Unsupported file', { status: 404 });
      if (!url.pathname.endsWith('/')) {
        url.pathname += '/';
        return Response.redirect(url.href, 301);
      }

      const links: DirectoryLink[] = [];
      const directory = await opendir(path);
      for await (const child of directory) {
        links.push({
          Name: child.name,
          Type: child.isDirectory() ? 1 : 2,
          Size: 0,
        });
        if (links.length > 5000) break;
      }
      links.sort(
        (a, b) =>
          Number(b.Type === 1) - Number(a.Type === 1) ||
          a.Name.localeCompare(b.Name),
      );
      return directoryResponse(request, url.href, url.pathname, links);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'EACCES' || code === 'EPERM'
        ? new Response('Access denied', { status: 403 })
        : new Response('File unavailable', { status: 404 });
    }
  });
}
