import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export function privateSocket(repo: string) {
  const path = join(repo, `rpc-${randomBytes(6).toString('hex')}.sock`);
  if (Buffer.byteLength(path) > 107)
    throw Error('The IPFS repository path is too long for a Unix socket');
  return path;
}
async function listening(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code || '')) resolve(false);
      else reject(error);
    });
    socket.setTimeout(1000, () =>
      socket.destroy(
        Error('Cannot verify whether the existing IPFS socket is active'),
      ),
    );
  });
}
export async function assertRepositoryInactive(
  repo: string,
  configuredAPI?: unknown,
) {
  const addresses = new Set<string>([join(repo, 'rpc.sock')]);
  if (typeof configuredAPI === 'string' && configuredAPI.startsWith('/unix/'))
    addresses.add(configuredAPI.slice(5));
  try {
    const marker = (await readFile(join(repo, 'api'), 'utf8')).trim();
    if (marker.startsWith('/unix/')) addresses.add(marker.slice(5));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const path of addresses)
    if (await listening(path))
      throw Error(
        'The IPFS repository is already used by a running node. Close the other Perun/Kubo instance before starting this profile.',
      );
}
export function kuboFailure(logs: string) {
  const errors = logs
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^Error:|^fatal:/i.test(line));
  return (
    errors.at(-1) ||
    logs.trim().split(/\r?\n/).at(-1) ||
    'Kubo stopped unexpectedly'
  ).slice(-1200);
}
