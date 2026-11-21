import { open } from 'node:fs/promises';

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
