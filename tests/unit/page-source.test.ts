import { it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readLimitedBody,
  readLimitedFile,
  SourceTooLargeError,
} from '../../src/main/browser/page-source';

it('reads small responses and stops at the limit, with or without Content-Length', async () => {
  expect(await readLimitedBody(new Response('<p>zażółć</p>'), 100)).toBe(
    '<p>zażółć</p>',
  );
  await expect(
    readLimitedBody(new Response('x'.repeat(50)), 10),
  ).rejects.toBeInstanceOf(SourceTooLargeError);
  let pulled = 0;
  const endless = new Response(
    new ReadableStream({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024));
      },
    }),
  );
  await expect(readLimitedBody(endless, 4096)).rejects.toBeInstanceOf(
    SourceTooLargeError,
  );
  expect(pulled).toBeLessThan(10);
  await expect(
    readLimitedBody(
      new Response('x', { headers: { 'content-length': '999999' } }),
      10,
    ),
  ).rejects.toBeInstanceOf(SourceTooLargeError);
});

it('reads local files only up to the limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'page-source-'));
  try {
    const small = join(dir, 'a.html'),
      big = join(dir, 'b.html');
    writeFileSync(small, '<h1>Hi</h1>');
    writeFileSync(big, 'x'.repeat(100));
    return Promise.all([
      expect(readLimitedFile(pathToFileURL(small), 50)).resolves.toBe(
        '<h1>Hi</h1>',
      ),
      expect(readLimitedFile(pathToFileURL(big), 50)).rejects.toBeInstanceOf(
        SourceTooLargeError,
      ),
    ]);
  } finally {
    setTimeout(() => rmSync(dir, { recursive: true, force: true }), 500);
  }
});
