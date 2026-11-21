// Live P2P audit: isolated disposable Kubo repository, no public gateways.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const exec = promisify(execFile);
const previousReport = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], 'utf8'))
  : undefined;
const outputFile = process.argv[3] || 'docs/catalog-audit.json';
const repo = await mkdtemp(join(tmpdir(), 'perun-audit-'));
const binary = resolve('resources/kubo/ipfs');
const env = { ...process.env, IPFS_PATH: repo };
let rpc = false;
const cli = async (...args) =>
  (
    await exec(
      binary,
      rpc ? ['--api', `/unix${repo}/api.sock`, ...args] : args,
      { env, timeout: 35000, maxBuffer: 1024 * 1024 },
    )
  ).stdout.trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let daemon;
const report = {
  date: new Date().toISOString(),
  method:
    'Isolated online Kubo: UnixFS stat plus 1 KiB content sample or directory listing; 25s per RPC, two attempts for failures; no HTTP gateways. Availability at check time, not a promise of future availability or full site compatibility.',
  peers: 0,
  results: previousReport?.results.filter((entry) => !entry.available) || [],
};
try {
  await cli('init', '--profile=lowpower');
  const file = join(repo, 'config');
  const config = JSON.parse(await readFile(file, 'utf8'));
  config.Addresses.API = `/unix${repo}/api.sock`;
  config.Addresses.Gateway = '';
  config.Addresses.Swarm = ['/ip4/0.0.0.0/tcp/0', '/ip4/0.0.0.0/udp/0/quic-v1'];
  await writeFile(file, JSON.stringify(config));
  daemon = spawn(binary, ['daemon'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  rpc = true;
  daemon.stdout.on('data', (b) => process.stdout.write(b));
  daemon.stderr.on('data', (b) => process.stderr.write(b));
  for (let i = 0; i < 60; i++) {
    try {
      await cli('swarm', 'peers');
      break;
    } catch {
      if (daemon.exitCode !== null)
        throw Error('Kubo exited: ' + daemon.exitCode);
      await sleep(500);
    }
  }
  await chmod(join(repo, 'api.sock'), 0o600);
  for (let i = 0; i < 30; i++) {
    const peers = await cli('swarm', 'peers');
    report.peers = peers.split('\n').filter(Boolean).length;
    if (report.peers >= 3) break;
    await sleep(1000);
  }
  if (!report.peers)
    throw Error('No P2P peers: audit cannot judge catalog availability');
  const candidates = [
    ...JSON.parse(await readFile('src/shared/catalog-additions.json')),
    ...JSON.parse(await readFile('src/shared/catalog.json')),
  ];
  const entries = previousReport
    ? candidates.filter((entry) =>
        previousReport.results.some((r) => r.url === entry.url && r.available),
      )
    : candidates;
  let next = 0;
  async function check(entry) {
    const path = entry.url.replace(/^(ipfs|ipns):\/\//, '/$1/');
    const result = { url: entry.url, available: false, attempts: 0, error: '' };
    for (let attempt = 0; attempt < 2; attempt++) {
      result.attempts++;
      try {
        const output = await cli('--timeout=25s', 'files', 'stat', path);
        result.type = /Type:\s*(\S+)/.exec(output)?.[1] || 'unknown';
        let contentPath = path;
        if (result.type === 'directory')
          contentPath = path.replace(/\/$/, '') + '/index.html';
        try {
          await cli('--timeout=25s', 'cat', '--length=1024', contentPath);
          result.content = 'sample';
        } catch (error) {
          if (
            result.type !== 'directory' ||
            !/no link named|no such file|not found/i.test(error.stderr || '')
          )
            throw error;
          await cli(
            '--timeout=25s',
            'ls',
            '--resolve-type=false',
            '--size=false',
            path,
          );
          result.content = 'directory-listing';
        }
        result.available = true;
        result.error = '';
        break;
      } catch (e) {
        result.error = (e.stderr || e.message).trim().slice(-1500);
      }
    }
    report.results.push(result);
    console.log(
      `${report.results.length}/${candidates.length} ${result.available ? 'OK' : 'FAIL'} ${entry.url} ${result.error.slice(0, 100)}`,
    );
  }
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      while (next < entries.length) await check(entries[next++]);
    }),
  );
  report.completedAt = new Date().toISOString();
  await writeFile(outputFile, JSON.stringify(report, null, 2) + '\n');
  await writeFile(
    'src/shared/catalog-availability.json',
    JSON.stringify(
      {
        checkedAt: report.completedAt,
        urls: candidates
          .filter((entry) =>
            report.results.some(
              (result) => result.url === entry.url && result.available,
            ),
          )
          .map((entry) => entry.url),
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  daemon?.kill('SIGTERM');
  if (daemon && daemon.exitCode === null)
    await new Promise((r) => daemon.once('exit', r));
  await rm(repo, { recursive: true, force: true });
}
