import { createHash } from 'node:crypto';
import { mkdir, writeFile, chmod, readFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const version = '0.43.1';
const sha256 =
  '3f2bf974ab2a3ec6d997fac7d8cb46f59983a7cddd0b55ef998e6ce379155fb2';
if (process.platform !== 'linux' || process.arch !== 'x64')
  throw Error('Supported target: linux x64');
let bytes;
try {
  bytes = await readFile('resources/kubo/archive.tar.gz');
} catch {}
if (!bytes || createHash('sha256').update(bytes).digest('hex') !== sha256) {
  const response = await fetch(
    `https://github.com/ipfs/kubo/releases/download/v${version}/kubo_v${version}_linux-amd64.tar.gz`,
  );
  if (!response.ok) throw Error(`Download: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== sha256)
  throw Error('Kubo checksum mismatch');
await mkdir('resources/kubo', { recursive: true });
await writeFile('resources/kubo/archive.tar.gz', bytes);
await mkdir('resources/kubo/staging', { recursive: true });
execFileSync('tar', [
  'xzf',
  'resources/kubo/archive.tar.gz',
  '-C',
  'resources/kubo/staging',
  '--strip-components=1',
  'kubo/ipfs',
  'kubo/LICENSE',
  'kubo/LICENSE-APACHE',
  'kubo/LICENSE-MIT',
]);
for (const file of ['ipfs', 'LICENSE', 'LICENSE-APACHE', 'LICENSE-MIT'])
  await rename(`resources/kubo/staging/${file}`, `resources/kubo/${file}`);
await chmod('resources/kubo/ipfs', 0o755);
console.log(`Verified Kubo ${version} (${sha256})`);
