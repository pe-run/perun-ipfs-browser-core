#!/usr/bin/env bash
# Build as the invoking user; elevate only the final apt installation.
set -euo pipefail
umask 022
repo='pe-run/perun-ipfs-browser-core'
node_version='24.22.3'
node_sha='4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb'
source_dir=''
output_dir=''
fail() { printf 'Perun: %s\n' "$*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --source|--build-only)
      (($# >= 2)) && [[ -n "$2" ]] || fail "Missing argument for $1"
      if [[ "$1" == '--source' ]]; then source_dir="$2"; else output_dir="$2"; fi
      shift 2 ;;
    --help) printf '%s\n' 'Install: bash scripts/install.sh' '--source DIRECTORY: build a local checkout' '--build-only DIRECTORY: save the DEB without installing'; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
[[ "$(uname -s)" == 'Linux' && "$(uname -m)" == 'x86_64' ]] || fail 'Supported system: Linux x86_64 (Ubuntu/Debian).'
((EUID != 0)) || fail 'Run as an ordinary user, without sudo. Only DEB installation will ask for sudo.'
for tool in git curl tar xz sha256sum dpkg-deb apt-get mktemp; do
  command -v "$tool" >/dev/null || fail "Missing command: $tool. Install git curl xz-utils dpkg and try again."
done
if [[ -z "$output_dir" ]]; then command -v sudo >/dev/null || fail 'sudo is required.'; fi
if [[ -n "$output_dir" ]]; then mkdir -p -- "$output_dir"; output_dir=$(cd "$output_dir" && pwd); fi
work=$(mktemp -d /tmp/perun-install.XXXXXXXX)
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ -n "$source_dir" ]]; then
  source_dir=$(cd "$source_dir" && pwd)
  [[ -f "$source_dir/package-lock.json" && -f "$source_dir/forge.config.mts" ]] || fail 'Invalid source directory.'
  # Isolate npm ci and build outputs from the user's checkout.
  mkdir "$work/source"
  tar -C "$source_dir" --exclude='./.git' --exclude='./node_modules' --exclude='./out' --exclude='./.vite' --exclude='./test-results' --exclude='./playwright-report' --exclude='./resources/kubo/archive.tar.gz' --exclude='./resources/kubo/ipfs' -cf - . | tar -C "$work/source" -xf -
else
  printf 'Downloading %s (main)…\n' "$repo"
  if command -v gh >/dev/null && gh auth status --hostname github.com >/dev/null 2>&1; then
    # Optional authentication also supports the project's private development phase.
    GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c 'credential.helper=!gh auth git-credential' clone --depth 1 --branch main "https://github.com/$repo.git" "$work/source"
  else
    GIT_TERMINAL_PROMPT=0 git -c credential.helper= clone --depth 1 --branch main "https://github.com/$repo.git" "$work/source"
  fi
fi
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" != '24' ]] || ! command -v npm >/dev/null; then
  printf 'Downloading official Node %s and verifying SHA-256…\n' "$node_version"
  archive="$work/node.tar.xz"
  curl --fail --show-error --location --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 300 "https://nodejs.org/dist/v$node_version/node-v$node_version-linux-x64.tar.xz" --output "$archive"
  printf '%s  %s\n' "$node_sha" "$archive" | sha256sum --check --status || fail 'Node SHA-256 mismatch. Installation aborted.'
  mkdir "$work/node"
  tar -xJf "$archive" -C "$work/node" --strip-components=1
  export PATH="$work/node/bin:$PATH"
fi
cd "$work/source"
printf 'Building Perun IPFS Browser (this may take several minutes)…\n'
npm ci
npm run make -- --targets @electron-forge/maker-deb
shopt -s nullglob
packages=("$work/source"/out/make/deb/x64/*.deb)
((${#packages[@]} == 1)) || fail 'Build did not produce exactly one DEB package.'
package="${packages[0]}"
[[ "$(dpkg-deb -f "$package" Package)" == 'ipfs-browser' && "$(dpkg-deb -f "$package" Architecture)" == 'amd64' ]] || fail 'Unexpected DEB package or architecture.'
if [[ -n "$output_dir" ]]; then
  mkdir -p -- "$output_dir"
  cp -- "$package" "$output_dir/"
  printf 'Package ready: %s/%s\n' "$output_dir" "$(basename "$package")"
else
  # apt's _apt account must be able to read the local package.
  chmod 0755 "$work"
  sudo apt-get install --reinstall -- "$package"
  printf 'Perun IPFS Browser installed. Run: ipfs-browser\n'
fi
