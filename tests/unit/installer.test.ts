import { it, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const installer = resolve('scripts/install.sh');
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'perun-installer-test-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const stub = (name: string, script: string) =>
    writeFileSync(join(bin, name), '#!/bin/bash\nset -e\n' + script, {
      mode: 0o755,
    });
  stub('node', "printf '24\\n'");
  stub('gh', 'exit 1');
  stub(
    'git',
    `target="\${!#}"; mkdir -p "$target"; printf '%s\\n' '{}' > "$target/package-lock.json"; touch "$target/forge.config.mts"; printf '%s\\n' "$*" > "$INSTALL_TEST_GIT"`,
  );
  stub(
    'npm',
    `printf '%s\\n' "$*" >> "$INSTALL_TEST_NPM"; if [[ "$1" == run ]]; then mkdir -p out/make/deb/x64; printf 'fixture package' > out/make/deb/x64/ipfs-browser_0.1.0_amd64.deb; fi`,
  );
  stub(
    'dpkg-deb',
    `case "\${!#}" in Package) echo ipfs-browser;; Architecture) echo amd64;; esac`,
  );
  stub('sudo', `printf '%s\\n' "$*" > "$INSTALL_TEST_APT"`);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    INSTALL_TEST_GIT: join(dir, 'git.log'),
    INSTALL_TEST_NPM: join(dir, 'npm.log'),
    INSTALL_TEST_APT: join(dir, 'apt.log'),
  };
  return {
    dir,
    stub,
    env,
    run: (args: string[] = []) =>
      spawnSync('bash', [installer, ...args], {
        env,
        cwd: dir,
        encoding: 'utf8',
      }),
  };
}
it('clones public HTTPS without GitHub auth, builds without sudo, installs only the resulting DEB', () => {
  const f = fixture();
  try {
    const r = f.run();
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(f.env.INSTALL_TEST_GIT, 'utf8')).toContain(
      'https://github.com/pe-run/perun-ipfs-browser-core.git',
    );
    expect(readFileSync(f.env.INSTALL_TEST_GIT, 'utf8')).not.toContain(
      'gh auth',
    );
    expect(readFileSync(f.env.INSTALL_TEST_NPM, 'utf8')).toContain(
      'ci\nrun make -- --targets deb',
    );
    expect(readFileSync(f.env.INSTALL_TEST_APT, 'utf8')).toMatch(
      /^apt-get install --reinstall -- \/tmp\/perun-install\.[^\n]+\.deb\n$/,
    );
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
it('build-only copies to a relative output directory containing spaces, without sudo', () => {
  const f = fixture();
  try {
    const r = f.run(['--build-only', 'output files']);
    expect(r.status, r.stderr).toBe(0);
    expect(
      readFileSync(
        join(f.dir, 'output files', 'ipfs-browser_0.1.0_amd64.deb'),
        'utf8',
      ),
    ).toBe('fixture package');
    expect(existsSync(f.env.INSTALL_TEST_APT)).toBe(false);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
it('a failed build never invokes apt', () => {
  const f = fixture();
  try {
    f.stub('npm', 'exit 42');
    expect(f.run().status).toBe(42);
    expect(existsSync(f.env.INSTALL_TEST_APT)).toBe(false);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
it('rejects a corrupted Node download before executing npm or sudo', () => {
  const f = fixture();
  try {
    f.stub('node', 'echo 26');
    f.stub(
      'curl',
      `while (($#)); do if [[ "$1" == --output ]]; then printf 'corrupt archive' > "$2"; break; fi; shift; done`,
    );
    const r = f.run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('SHA-256');
    expect(existsSync(f.env.INSTALL_TEST_NPM)).toBe(false);
    expect(existsSync(f.env.INSTALL_TEST_APT)).toBe(false);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
it('rejects unsupported architecture before cloning or building', () => {
  const f = fixture();
  try {
    f.stub(
      'uname',
      `if [[ "$1" == -s ]]; then echo Linux; else echo aarch64; fi`,
    );
    const r = f.run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Linux x86_64');
    expect(existsSync(f.env.INSTALL_TEST_GIT)).toBe(false);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
