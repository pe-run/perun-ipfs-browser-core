import { t } from '../../shared/i18n';
import { constants } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { validCID } from '../../shared/address';
export type ImportMode = 'files' | 'directory';
export interface ImportResult {
  cid: string;
  url: string;
  names: string[];
  files: { name: string; url: string }[];
}
async function* entries(
  path: string,
  name: string,
  depth = 0,
): AsyncGenerator<{ path: string; name: string; directory: boolean }> {
  if (depth > 128) throw Error(t('deepDirectory'));
  const info = await lstat(path);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
    throw Error(t('unsupportedFile', { name }));
  yield { path, name, directory: info.isDirectory() };
  if (info.isDirectory()) {
    const dir = await opendir(path);
    for await (const child of dir)
      yield* entries(
        join(path, child.name),
        `${name}/${child.name}`,
        depth + 1,
      );
  }
}
export async function importToKubo(
  socket: string,
  paths: string[],
  mode: ImportMode,
  signal: AbortSignal,
): Promise<ImportResult> {
  if (!paths.length || paths.some((p) => !isAbsolute(p)))
    throw Error(t('chooseFiles'));
  if (mode === 'directory' && paths.length !== 1)
    throw Error(t('chooseDirectory'));
  const names = paths.map((p) => basename(p));
  if (new Set(names).size !== names.length) throw Error(t('duplicateNames'));
  for (const path of paths) {
    const info = await lstat(path);
    if (mode === 'directory' ? !info.isDirectory() : !info.isFile())
      throw Error(t('invalidFileType'));
  }
  const boundary = `perun-${randomUUID()}`;
  async function* body() {
    for (let i = 0; i < paths.length; i++)
      for await (const entry of entries(paths[i], names[i])) {
        signal.throwIfAborted();
        yield Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodeURIComponent(entry.name)}"\r\nContent-Type: ${entry.directory ? 'application/x-directory' : 'application/octet-stream'}\r\n\r\n`,
        );
        if (!entry.directory) {
          const file = await open(
            entry.path,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          try {
            if (!(await file.stat()).isFile()) throw Error(t('fileChanged'));
            yield* file.createReadStream({ autoClose: false, signal });
          } finally {
            await file.close();
          }
        }
        yield Buffer.from('\r\n');
      }
    yield Buffer.from(`--${boundary}--\r\n`);
  }
  const query = new URLSearchParams({
    recursive: 'true',
    'wrap-with-directory': String(mode === 'files'),
    pin: 'true',
    'cid-version': '1',
    progress: 'false',
    'stream-channels': 'true',
  });
  const req = request({
    socketPath: socket,
    path: `/api/v0/add?${query}`,
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    signal,
    timeout: 120000,
  });
  req.on('timeout', () => req.destroy(Error(t('importTimeout'))));
  const response = new Promise<import('node:http').IncomingMessage>(
    (resolve, reject) => {
      req.once('response', resolve);
      req.once('error', reject);
    },
  );
  // Attach both consumers immediately, so upload and response failures cannot be unhandled.
  const read = async () => {
    const res = await response;
    let last: { Hash?: string; Name?: string } | undefined;
    for await (const line of createInterface({
      input: res,
      crlfDelay: Infinity,
    })) {
      if (!line) continue;
      const record = JSON.parse(line) as {
        Hash?: string;
        Name?: string;
        Message?: string;
      };
      if (record.Message || res.statusCode !== 200)
        throw Error(record.Message || `Kubo RPC ${res.statusCode}`);
      if (record.Hash) last = record;
    }
    if (res.trailers['x-stream-error'])
      throw Error(res.trailers['x-stream-error']);
    if (!res.complete || !last?.Hash || !validCID(last.Hash))
      throw Error(t('importIncomplete'));
    const expectedName = mode === 'files' ? '' : names[0];
    if (last.Name !== expectedName) throw Error(t('missingRoot'));
    return {
      cid: last.Hash,
      url: `ipfs://${last.Hash}/`,
      names,
      files:
        mode === 'files'
          ? names.map((name) => ({
              name,
              url: `ipfs://${last.Hash}/${encodeURIComponent(name)}`,
            }))
          : [],
    };
  };
  try {
    const [result] = await Promise.all([
      read(),
      pipeline(Readable.from(body()), req),
    ]);
    return result;
  } catch (error) {
    req.destroy();
    throw error;
  }
}
