# Perun IPFS Browser

<img src="resources/branding/perun.svg" width="96" height="96" alt="Perun IPFS Browser logo">

A Linux desktop browser with Chromium and a bundled Kubo node. Browse **HTTP, HTTPS, IPFS and IPNS** from the same address bar. IPFS content is fetched through your own node, without a public gateway.

[Polska dokumentacja / Polish documentation](docs/pl/README.md) · [Architecture](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Features

- Tabs, back/forward navigation, reload/stop, controlled popups and native download dialogs.
- Persistent SQLite history/settings, JSON bookmarks in ~/.perun/bookmarks.json, and optional tab restoration.
- Bundled Kubo: automatic startup/shutdown, private Unix-socket RPC, persistent PeerID.
- IPFS/IPNS streaming, MIME detection, index.html directories and single byte ranges.
- Import files or folders into IPFS, pin them locally, copy their addresses and open them in new tabs.
- Browser information and the actual running version on the start page, plus a curated IPFS/IPNS collection filtered by a recorded P2P availability check.
- English, Polish, Spanish, French, Chinese, Portuguese, German, Russian, Japanese and Korean. The primary system UI language is selected automatically; unsupported languages fall back to English. Use the **⚙ Settings** button to choose a language; the preference survives restart. Regional variants map to the base language (e.g. pt-BR → Portuguese).

## Requirements

Linux **x86_64** with Electron's desktop libraries (GTK, NSS, libgbm, ALSA), an X11/Wayland display, and sufficient disk space for application data and IPFS blocks. Ubuntu/Debian are the initial installation targets. Development requires **Node 24 LTS**, npm and tar. Tests also use OpenSSL and Xvfb. DEB packaging requires dpkg, RPM requires rpmbuild, and AppImage requires appimagetool on PATH. The DEB and RPM declare runtime library dependencies.

## Install from GitHub

For a **public repository**, with `git`, `curl`, `xz-utils`, `dpkg` and `sudo` installed:

```bash
bash -c 'script=$(curl -fsSL https://raw.githubusercontent.com/pe-run/perun-ipfs-browser-core/main/scripts/install.sh) && bash -c "$script"'
```

The installer downloads the current `main`, provisions verified Node 24 if needed, runs `npm ci`, builds the DEB with Kubo, and calls `sudo apt-get install --reinstall`. Build steps run as your ordinary user; only package installation uses sudo. Building takes several minutes and needs internet access. You do not need to install Node or Kubo yourself.

For a **private repository**, use GitHub CLI signed in to an account with repository access:

```bash
bash -c 'script=$(gh api repos/pe-run/perun-ipfs-browser-core/contents/scripts/install.sh -H "Accept: application/vnd.github.raw") && bash -c "$script"'
```

Run **Perun IPFS Browser** from your application menu or use `ipfs-browser`. Uninstall with `sudo apt remove ipfs-browser`; your profile is retained. Re-running the installer rebuilds the current source. There is no automatic updater.

## Build and run from source

```bash
git clone https://github.com/pe-run/perun-ipfs-browser-core.git
cd perun-ipfs-browser-core
nvm install
nvm use
npm ci
npm run kubo:download
npm start
```

```bash
npm run make
# Build only a single format:
npm run make -- --targets deb
npm run make -- --targets rpm
npm run make -- --targets appimage
# Unpacked Linux application:
./out/ipfs-browser-linux-x64/ipfs-browser
# Install the generated DEB (adjust the version if necessary):
sudo apt install ./out/make/deb/x64/perun-ipfs-browser_0.17.12_amd64.deb
```

`npm run package` creates the unpacked application; `npm run make` creates DEB, RPM, AppImage and ZIP files under `out/make`. Official Kubo **0.43.1** is pinned and SHA-256 verified by `scripts/download-kubo.mjs`, including cached archives. The application never downloads Kubo at runtime. The npm lockfile records dependencies. The current Forge 8 template uses `.mts` configuration files.

For RPM builds, install the package providing `rpmbuild` (for example `rpm` on Ubuntu or `rpm-build` on Fedora). For AppImage builds, use the official [appimagetool](https://github.com/AppImage/appimagetool/releases) executable (tested with 1.9.1), saved as `appimagetool` on PATH. The maker can run that tool in extraction mode, so FUSE is not needed at build time.

Install the RPM with `sudo dnf install ./out/make/rpm/x64/<file>.rpm` on Fedora. For AppImage, make the file executable and launch it. If FUSE is unavailable, use its `--appimage-extract-and-run` option. AppImage needs Chromium's user-namespace sandbox to be available on the host. The RPM configures a root-owned SUID sandbox helper on installation.

To run the installer against a local checkout without modifying that checkout:

```bash
bash scripts/install.sh --source .
# Build without installing or invoking sudo:
bash scripts/install.sh --source . --build-only /tmp/perun-packages
```

### Linux sandbox

Sandboxing remains enabled. Systems that restrict unprivileged user namespaces may need a properly installed SUID sandbox helper. The DEB includes the original Electron helper as root-owned mode **4755**. When installing a ZIP manually, have an administrator place the application in a trusted, administrator-owned directory and configure its helper appropriately. Do not run the browser as root or disable its sandbox.

For headless tests, use Xvfb and a correctly configured development and packaged Electron sandbox. On AppArmor-restricted hosts, an administrator may need to configure a compatible installed SUID helper. Packaging preserves Electron's original helper; no host-specific symlinks belong in distributed artifacts. Installing the DEB on a clean machine remains a separate validation step; see the roadmap.

## Usage and local data

Use the address bar for `https://example.org`, `http://localhost:PORT`, `ipfs://CID/path` or `ipns://NAME/path`. Ctrl+L focuses the address, Ctrl+T creates a tab, Ctrl+W closes it, Alt+Left/Right navigates history, and Ctrl+R reloads. The star bookmarks the current page; Copy copies the original public address. The start page provides history, bookmarks, statistics and imports. The **⚙ Settings** button opens general preferences (language, tab restoration and **Clear browsing data**), independently of the visited page. If the IPFS node fails to start, **Restart node** appears next to its status. The **Page settings** button next to the address opens settings for the current address: IPFS/IPNS pin status and pin/unpin actions, page zoom, audio muting, copy, bookmark, and reset of zoom/audio preferences. Sensitive permissions remain blocked. Closing either dialog returns to the previous page or start screen.

All managed runtime data is under `~/.perun/`. Electron's `userData` and `sessionData` both point to `~/.perun/profile`, preserving the complete Chromium profile structure. SQLite metadata, Chromium site data, and the `profile/ipfs` block repository remain separate within that root. The browser never uses `~/.ipfs`. Closing the application stops its node.

### Add files to IPFS

Choose **Add files to IPFS** for one or more files, or **Add folder to IPFS**. The trusted browser interface opens a native picker, streams content to Kubo, pins it, and saves the result as a bookmark. File selections use a wrapping directory to preserve names, with individual copy/open buttons for files. Folder imports preserve nested and empty folders; the chosen folder name is not an extra level under its CID.

Folder imports include **hidden files**. Symbolic links and special files are rejected. Files with duplicate names from different directories must be imported separately or through their common folder. Canceling the picker adds nothing. Closing the application interrupts active imports; partial blocks can remain in the cache after an error.

Imported data is **not encrypted**. Anyone who learns its CID may retrieve it while a provider is available. A local pin does not keep content online after you close the browser unless another node retains it. Web pages have no file-import API, Node access, browser-chrome IPC, or Kubo RPC access.

### File addresses and directory addresses

An imported file such as `ipfs://CID/ipfs_links.txt` is inside the wrapping directory `ipfs://CID/`. Both addresses work: the former opens the file, the latter displays directory contents unless an index.html is present. File links preserve names and relative navigation; nested directories include a parent link that stays within the content root. Empty folders are displayed as empty, not as errors. Generated directory pages escape filenames and disable scripts using their own strict CSP; they have no privileged APIs. Missing files and real Kubo failures still return error responses.

### Per-page preferences

Zoom (50–200%) and audio preferences are saved by HTTP/HTTPS origin or IPFS/IPNS content root. Different CIDs can have different zoom/audio settings. Electron's official isolated zoom mode prevents one content root from changing another tab's zoom; it does **not** change shared IPFS/IPNS storage or Same-Origin Policy. Reset only restores zoom/audio defaults; it does not clear site data or remove pins. Page actions validate the current tab and URL snapshot so an outdated panel cannot modify a different page. Pinning protects the whole CID root, including sibling files in its directory.

## Important limitations

- **All IPFS and IPNS pages share the `p2p://shared` origin and site storage.** Unrelated authors can read or overwrite each other's localStorage/IndexedDB. Do not keep secrets there. HTTP/HTTPS sites and browser UI remain separate.
- Relative paths and explicit `/ipfs/CID/...` or `/ipns/NAME/...` paths work. Root-relative `/style.css` paths cannot identify a content root and are not rewritten. The browser does not spoof `window.location`.
- IPFS workers and Service Workers are disabled. Directories open `index.html` when present; otherwise a script-free listing shows files and subfolders (up to 5000 entries). The start-page collection uses the supplied descriptions and URLs; public availability and compatibility are not guaranteed. Links do not preload or automatically pin their contents.
- **10 GB is a soft storage target**, not a strict unpinned-cache limit. Kubo GC never removes protected pins, so the repository may exceed it. There is no custom LRU policy.
- Only single byte ranges are supported. MIME detection without a file extension is heuristic. Media codecs and DRM depend on Electron.
- Sensitive permissions are denied. There is no per-site permission editor, password manager, extension support, sync or updater. Tab restoration saves URLs, not the entire navigation stack.
- External Kubo/OS diagnostics may remain in their original language; browser-owned UI, status labels and dialogs are localized.

## Tests

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run package
xvfb-run -a npm run test:e2e
```

Tests use local HTTP/HTTPS/IPFS/IPNS fixtures. Integration tests start independent Kubo nodes and verify actual P2P transfer, identity persistence, streamed imports, ranges and error handling. Playwright covers browser behavior, shared storage, isolation, imports, language selection/persistence and the packaged application. Public catalog pages are not required for tests. HTTPS fixture trust exists only in the test harness, after first checking rejection of an untrusted certificate; production has no TLS bypass. Installer tests mock sudo; a real `apt install` needs administrative privileges. Test traces and screenshots are written to `test-results`.

## Logo and translations

The original logo is `resources/branding/perun.svg`. UI and favicon use SVG; Linux window and desktop icons use the committed 512×512 PNG. Refresh it after editing SVG with `python3 scripts/render-icon.py` (maintenance-only prerequisites: Python GI and librsvg/GdkPixbuf). Normal builds do not need those tools.

Translations are in `src/shared/locales/*.json`; all languages use the same keys and placeholders. The original 28 fully translated start-page entries remain in `src/shared/catalog.json`. The 94 added entries are in `src/shared/catalog-additions.json`, with the supplied Polish descriptions and English translations; other interface languages fall back to English for these contributed descriptions. Categories, provenance/status notes, the browser description and version label are localized in all ten languages. `src/shared/catalog.ts` combines the archived collections and displays entries in the audited availability list plus the independently published forum link. See [CONTRIBUTING.md](CONTRIBUTING.md) for validation requirements.

## Start-page collection

The start page displays `app.getVersion()` from the running Electron application, not a separate hardcoded version. The original collection has 122 distinct supplied addresses across 17 possible categories. Only resources reached during the latest recorded audit are displayed, and empty categories are hidden. The original descriptions remain in the source files for future rechecks.

Where supplied, a domain is displayed as metadata, not substituted for the IPFS/IPNS address. Status notes distinguish repository-manifest snapshots, documentation/repository references, the supplied Distributed Press index, and earlier resources. These are **collection notes, not live verification**: snapshots can be old, mutable IPNS records can change, and availability can change after the recorded check. DeFi entries are static UI snapshots, not promised live or current applications. No links are prefetched or automatically pinned. The archived supplied URLs retain their exact spelling; unsupported or unreachable names are excluded from the displayed collection.

## License

MIT; see [LICENSE](LICENSE). Bundled Electron/Chromium and Kubo retain their own licenses, included in application packages. The logo and source assets are distributed with this repository.

Hover over a link to see its destination in the native window title. IPFS/IPNS targets use their public addresses; leaving the link restores the browser name. The start page shows your bookmarks, including the starter collection. Default examples are created when the favorites file is missing. Removing individual bookmarks or renaming them is preserved; deleting the entire file restores the default examples on the next launch. No bookmarked site is fetched automatically.

Returning to a start-page tab immediately restores its start screen, including when a neighboring tab is closed. Settings remain separate.

Maintainers can rerun the live P2P check with `npm run catalog:audit` (online access and the downloaded Kubo binary required). It updates `docs/catalog-audit.json` and `src/shared/catalog-availability.json` only after a complete audit. Each failed retrieval is retried once, with a 25-second timeout per RPC. Checks retrieve a content sample or directory listing; they do not download entire archives or certify every subresource, script or future IPNS update. Timeouts mean unavailable during this check, not permanently gone. The audit does not change your saved bookmarks or pins.

The current audited collection displays **34 of the 122 submitted resources**; 88 failed resolution or content retrieval during the recorded check and are excluded. The report contains all outcomes, retry counts and errors. The eight HTTPS starter sites were also checked; Reuters returned HTTP 401 and IMDb HTTP 202, so those reachable but protected sites remain bookmarks without a page-rendering guarantee (see `docs/bookmarks-audit.json`).

The bookmarks bar remains visible below the address bar on every tab. Click the address-bar star to save the current page: it fills when the address is already saved, and repeated clicks do not create duplicates. Normal bookmark clicks open in the current tab; Ctrl/Cmd-click or middle-click opens a new tab. Use **☰ Manage bookmarks** on the bar, or right-click a bookmark, to edit its name, choose a folder or delete it. Clicking a folder on the bar opens a native dropdown list of its bookmarks, without opening the manager. When the bar is too narrow, the remaining bookmarks and folders move behind the **»** button at its right end. Choosing an entry opens it in the current tab; Ctrl/Cmd+selection opens a new tab. Arrow Down on a focused folder opens its list, and Escape dismisses it. Empty folders show a disabled empty-folder message. Create or rename folders there; deleting a folder moves its bookmarks back to the main bar. Folders currently have one level. Deletion also remains available through History and bookmarks. The bar, start-page shortcuts and star refresh after saves, imports and deletions, and saved bookmarks survive restart.

The toolbar height follows its actual content, so the browsing area starts immediately below the bookmark row without a reserved empty band. Folder assignments and edited titles persist in the favorites JSON file and survive upgrades and restarts. Saving an already bookmarked page with the star preserves its custom name and folder.

## Favorites file

Bookmarks and folders are stored together in **`~/.perun/bookmarks.json`**, not in the live SQLite bookmark tables. The file is created automatically with grouped defaults and private permissions (0600; new `.perun` directories use 0700). Every edit is written immediately through a synced temporary file and atomic rename. No save is deferred until shutdown.

Every bookmark and folder has an `order` field (zero-based; bookmarks are numbered separately on the bar and in each folder). New bookmarks appear first on the bar, new folders last, and a bookmark moved to another folder goes first there. In **☰ Manage bookmarks**, change the **Position** number and save to reorder bookmarks or folders; hand-edited `order` values are honoured and renumbered on the next launch, and files without them keep their previous layout. Deleting `bookmarks.json` restores the default collection on the next launch. An existing valid JSON file with empty arrays remains empty. History, settings, tab restoration and pin metadata stay in SQLite.

Close the browser before editing or replacing the file manually; external changes are read at startup. Invalid JSON, unsupported schema versions, duplicate URLs, unsafe protocols or invalid folder references produce a startup error and are never overwritten automatically. Fix the file or move it aside to restore defaults. Checks cover metadata structure, not public-site reachability.

```json
{
  "version": 1,
  "bookmarks": [
    { "url": "https://github.com/", "title": "GitHub", "folderId": 1 }
  ],
  "folders": [{ "id": 1, "title": "Development" }]
}
```

Use `folderId: null` for the main bookmarks bar. Files are limited to 16 MiB and 50,000 entries in each list. Automated/custom test profiles selected through `IPFS_BROWSER_PROFILE` isolate this file under `<profile>/bookmarks.json` so tests never touch the user's favorites. Normal application launches always use the home directory.

Folder-list navigation is separate from editing: use **☰ Manage bookmarks** to create/rename/delete folders and organize entries. Native-menu E2E tests use Python 3 and system libX11/libXtst to send real keyboard events inside Xvfb; no Python packages are required.

## Website icons

Tabs, bookmarks, the start-page collection and folder dropdowns show a small icon next to each name. HTTP/HTTPS pages use Chromium's favicon notifications, including `rel="icon"`, `rel="shortcut icon"`, relative/CDN URLs and inline `data:` images. Before a page is visited, the browser tries the saved site's conventional `/favicon.ico`. ICO, PNG, SVG and other Chromium-supported image formats are decoded as images and normalized to 16×16 PNG. Missing, invalid or protected icons retain a default web icon. IPFS, IPNS and internal p2p:// addresses use the same local turquoise cube icon, without fetching a website icon through Kubo.

The normalized cache is stored per HTTP origin in the profile's SQLite settings, separately from `~/.perun/bookmarks.json`. Cached icons survive restarts; a changed declared icon URL triggers a new lookup. Background favicon requests can contact bookmarked origins and declared icon hosts; no public favicon proxy is used, no site HTML is loaded in the background, and application favicon requests omit cookies and referrers. Each icon response is limited to 512 KiB with a four-second timeout. Only validated 16×16 PNG data reaches the native menus; remote SVG/ICO decoding stays in Chromium's sandboxed image renderer. Cached icons remain available when a refresh fails.

## Profile directory

```text
~/.perun/
├── bookmarks.json
├── profile/
│   ├── browser.sqlite       # history, settings, favicon cache, pin metadata
│   ├── ipfs/                # blocks, pins and persistent Kubo identity
│   ├── Partitions/          # browsing/interface cookies and website storage
│   └── …                    # Chromium caches and other profile files
├── logs/
├── crashes/
└── tmp/
```

Perun opens its current profile directly and creates missing directories with mode 0700. Older pre-release profile locations are left untouched.

Electron session, logs, crash and temporary paths are configured before readiness; `TMPDIR` also points inside `.perun` for child processes. Saved downloads remain at the location chosen in the download dialog, and installed application binaries remain managed by the Linux package manager.

`IPFS_BROWSER_PROFILE=/absolute/path` uses an isolated root with a flat Chromium/SQLite/Kubo profile and its own `bookmarks.json`, `logs`, `crashes` and `tmp`.

## Kubo Unix-socket recovery

Version 0.15.1 creates a fresh private `rpc-<random>.sock` for every daemon start. A stale legacy `rpc.sock` or a socket left by SIGKILL cannot block the next start or be mistaken for the new daemon. The repository, keys, PeerID and blocks are preserved. Live API listeners are detected before configuration changes; Perun refuses to start another node against that repository and never deletes a live socket. The official `ipfs/api` marker identifies the current endpoint.

Close other Perun windows before restarting. If a previously orphaned Kubo process still owns the normal profile, stop that specific node using the bundled CLI:

```bash
IPFS_PATH="$HOME/.perun/profile/ipfs" /usr/lib/ipfs-browser/resources/ipfs shutdown
```

For a source checkout use `resources/kubo/ipfs` instead of the installed path. Custom profiles use their own `<profile>/ipfs` directory. This stops the node without resetting its repository. A connection-refused result means no API listener is present; upgrade to 0.15.1 to bypass the abandoned socket.

Imported IPFS files and folders are automatically bookmarked in **myIPFS**. Names use the selected filenames; missing names fall back to the last 12 CID characters, and duplicate filenames gain a CID suffix. Reimporting an existing bookmark preserves its edited name and location. Bookmarks remain in `~/.perun/bookmarks.json`.

## Local files

Paste a local address such as `file:///home/user/Documents/` into the address bar to browse a directory. Open a listed file in the same tab and follow its relative links. Remote pages cannot open local files. Local pages run with Chromium web security.
