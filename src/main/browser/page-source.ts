import { open } from 'node:fs/promises';
import type { WebContents } from 'electron';

/** Upper bound for "Copy page source"; the text goes to memory and the clipboard. */
export const sourceLimit = 8 * 1024 * 1024;

export class SourceTooLargeError extends Error {
  constructor() {
    super('Page source is too large');
  }
}

/** Decode at most `limit` bytes of a response body, cancelling the download beyond it. */
export async function readLimitedBody(
  response: Response,
  limit = sourceLimit,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) {
    await response.body?.cancel();
    throw new SourceTooLargeError();
  }
  if (!response.body) return '';
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new SourceTooLargeError();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function readLimitedFile(
  file: URL,
  limit = sourceLimit,
): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size > limit) throw new SourceTooLargeError();
    // One spare byte detects a file that grows while it is being read.
    const buffer = Buffer.alloc(size + 1);
    const { bytesRead } = await handle.read(buffer, 0, size + 1, 0);
    if (bytesRead > size) throw new SourceTooLargeError();
    return new TextDecoder().decode(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/**
 * The main document exactly as the renderer received it (also after a POST),
 * read through the DevTools protocol instead of downloading it again.
 * Returns undefined when another debugger (e.g. open DevTools) holds the page.
 */
export async function renderedSource(
  contents: WebContents,
  limit = sourceLimit,
): Promise<string | undefined> {
  const debug = contents.debugger;
  if (debug.isAttached()) return;
  try {
    debug.attach('1.3');
  } catch {
    return;
  }
  try {
    await debug.sendCommand('Page.enable');
    const { frameTree } = (await debug.sendCommand('Page.getFrameTree')) as {
      frameTree: { frame: { id: string; url: string } };
    };
    const { content, base64Encoded } = (await debug.sendCommand(
      'Page.getResourceContent',
      { frameId: frameTree.frame.id, url: frameTree.frame.url },
    )) as { content: string; base64Encoded: boolean };
    const bytes = base64Encoded
      ? Buffer.from(content, 'base64')
      : Buffer.from(content, 'utf8');
    if (bytes.length > limit) throw new SourceTooLargeError();
    return base64Encoded ? new TextDecoder().decode(bytes) : content;
  } catch (error) {
    if (error instanceof SourceTooLargeError) throw error;
    return;
  } finally {
    try {
      debug.detach();
    } catch {
      /* already detached, e.g. the page closed */
    }
  }
}

/** Isolated world for reading the DOM: page scripts cannot observe or alter it. */
const sourceWorld = 1077;

/** The document as currently shown (after scripts ran), serialized as HTML. */
export async function serializedDocument(
  contents: WebContents,
  limit = sourceLimit,
): Promise<string> {
  const html = (await contents.executeJavaScriptInIsolatedWorld(sourceWorld, [
    {
      code: `(() => {
        const type = document.doctype;
        return (type ? new XMLSerializer().serializeToString(type) + '\\n' : '') +
          document.documentElement.outerHTML;
      })()`,
    },
  ])) as unknown;
  if (typeof html !== 'string') throw Error('Document unavailable');
  if (Buffer.byteLength(html) > limit) throw new SourceTooLargeError();
  return html;
}
