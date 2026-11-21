import { execFile } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const releaseDir = '/tmp/perun';

export async function prefixArtifact(artifact: string) {
  const filename = basename(artifact);
  if (filename.startsWith('perun-')) return artifact;
  const renamed = join(dirname(artifact), `perun-${filename}`);
  await rename(artifact, renamed);
  return renamed;
}

export async function publishLocalArtifacts(artifacts: string[]) {
  await mkdir(releaseDir, { recursive: true, mode: 0o755 });
  const directory = await lstat(releaseDir);
  if (!directory.isDirectory() || directory.uid !== process.getuid?.()) {
    throw Error(
      `Expected a directory owned by the current user at ${releaseDir}`,
    );
  }

  const output = resolve('out/make/source');
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(join(releaseDir, '.build-'));
  try {
    const { stdout } = await exec('npm', [
      'pack',
      '--dry-run',
      '--ignore-scripts',
      '--json',
    ]);
    const [{ version, files }] = JSON.parse(stdout) as Array<{
      version: string;
      files: Array<{ path: string }>;
    }>;
    const sourceName = `perun-ipfs-browser-${version}-source.tar.gz`;
    const sourceArchive = join(output, sourceName);
    // npm always includes the compiled main entry and omits the npm lockfile.
    const paths = new Set(
      files
        .map(({ path }) => path)
        .filter((path) => !path.startsWith('.vite/')),
    );
    paths.add('package-lock.json');
    paths.add('.gitignore');
    const list = join(staging, 'files');
    await writeFile(list, [...paths].join('\0') + '\0');
    const packed = join(staging, sourceName);
    await exec('tar', [
      '-czf',
      packed,
      '--no-recursion',
      '--transform',
      `s,^,perun-ipfs-browser-${version}/,`,
      '--null',
      '-T',
      list,
    ]);
    await copyFile(packed, sourceArchive);
    for (const artifact of [...artifacts, sourceArchive]) {
      const name = basename(artifact);
      const stagedFile = join(staging, name);
      await copyFile(artifact, stagedFile);
      await rename(stagedFile, join(releaseDir, name));
    }
    console.log(`Release files copied to ${releaseDir}`);
    return sourceArchive;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) await publishLocalArtifacts([]);
