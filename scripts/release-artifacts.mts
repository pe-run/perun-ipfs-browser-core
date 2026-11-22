import { rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export async function prefixArtifact(artifact: string) {
  const filename = basename(artifact);
  if (filename.startsWith('perun-')) return artifact;
  const renamed = join(dirname(artifact), `perun-${filename}`);
  await rename(artifact, renamed);
  return renamed;
}
