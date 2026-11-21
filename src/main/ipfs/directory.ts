import { getLocale, t } from '../../shared/i18n';
export interface DirectoryLink {
  Name: string;
  Type: number;
  Size: number;
}
export function escapeHTML(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}
export function directoryResponse(
  request: Request,
  publicURL: string,
  path: string,
  links: DirectoryLink[],
): Response {
  const title = t('directoryTitle', { path: publicURL });
  const safe = links.filter(
    (link) =>
      link.Name &&
      !['.', '..'].includes(link.Name) &&
      !link.Name.includes('/') &&
      !link.Name.includes('\\') &&
      !Array.from(link.Name).some((char) => char.charCodeAt(0) < 32),
  );
  const rows = safe
    .slice(0, 5000)
    .map(
      (link) =>
        `<li><a href="${escapeHTML(encodeURIComponent(link.Name) + (link.Type === 1 ? '/' : ''))}">${escapeHTML(link.Name)}${link.Type === 1 ? '/' : ''}</a></li>`,
    )
    .join('');
  const html = `<!doctype html><html lang="${getLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHTML(title)}</title><style>body{font:16px system-ui;margin:32px;line-height:1.8;color:#e8edf4;background:#151c26}a{color:#9cc5ff}h1{font-size:1.3rem;overflow-wrap:anywhere}li{overflow-wrap:anywhere}</style></head><body><h1>${escapeHTML(title)}</h1>${path === '/' ? '' : `<a href="../">${escapeHTML(t('parentDirectory'))}</a>`}<ul>${rows}</ul>${safe.length ? '' : `<p>${escapeHTML(t('emptyDirectory'))}</p>`}${safe.length > 5000 ? `<p>${escapeHTML(t('directoryLimit'))}</p>` : ''}</body></html>`;
  return new Response(request.method === 'HEAD' ? null : html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(html)),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
