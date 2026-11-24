# Architecture

[Polish original](docs/pl/ARCHITECTURE.md)

## Trust boundaries

Electron's main process owns the browser window, WebContentsView tabs, SQLite, the favorites JSON file and the Kubo child process. Browser chrome runs in a separate `persist:interface` session using a local production file (Vite server during development). Its small preload API accepts commands only from the single trusted top-level frame at the expected URL. Sender identity and arguments are validated. Browser chrome cannot navigate to arbitrary websites or open popups.

Untrusted pages use `persist:browsing` without any preload or page-facing IPFS API: `nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`, `webSecurity=true`. Sensitive permissions are denied. HTTP/HTTPS is handled entirely by Chromium, preserving normal origins, CORS, cookies and storage. Popups with supported addresses become tabs, but only after recent user input in that tab (a click or key press grants one popup for five seconds, and a new document resets it); script-only `window.open` is denied, because Electron has no popup blocker of its own. Downloads use an asynchronous native save dialog: the file is written to a temporary file in the profile and moved to the chosen path, so the dialog never blocks the main process (IPC and protocol handlers). There is no production TLS exception or arbitrary external-protocol launcher.

## Modules

- `main/browser/controller.ts`: tabs, Chromium navigation history, browser commands, downloads, imports, persistent settings.
- `shared/address.ts`: CID validation and reversible public/internal address mapping with multiformats. CIDv0 case is preserved.
- `main/ipfs/engine.ts`: the small IPFSEngine boundary, Kubo lifecycle, private RPC, pins and statistics.
- `main/ipfs/protocol.ts`: IPFS/IPNS responses, MIME, directory redirects/index.html, byte ranges, stream cancellation.
- `main/ipfs/import.ts`: streamed multipart RPC imports from native-picker paths; rejects symlinks and special files.
- `main/storage/bookmarks.ts`: authoritative versioned favorites JSON, validated on load/mutation and persisted by atomic replacement.
- `main/storage/store.ts`: SQLite through Node's official `node:sqlite` module, prepared statements and WAL. No native addon ABI rebuild is needed.
- `main/security/policy.ts`: session restrictions and secure preferences.
- `main/security/commands.ts`: the IPC command schema: each action lists its accepted fields and each field has one validator; unknown actions and foreign fields are rejected before the controller runs.
- `shared/i18n.ts`, `shared/locales`: typed dictionaries used by main and renderer. No framework or runtime translation service.
- `shared/catalog.json`: the original 28 entries in ten languages. `shared/catalog-additions.json`: the 94 supplied additions with English/Polish metadata, category, source-status type and optional domain. `shared/catalog.ts` preserves these 122 candidates and filters the displayed collection through `shared/catalog-availability.json`; untranslated contributed descriptions fall back to English explicitly.

## Protocols and the shared origin

`ipfs://CID/path` becomes `p2p://shared/ipfs/CID/path`; IPNS uses `/ipns/NAME/path`. The p2p scheme is registered before app readiness as standard, secure, streaming and Fetch/CORS capable. No bypassCSP or Service Workers. The handler is installed on the persistent browsing session. The address bar, history, bookmarks and browser Copy button map back to the original IPFS/IPNS form.

The browsing session also accepts native IPFS/IPNS URLs for images, CSS, frames and Fetch. The request is routed to the same internal address as a navigation. Root-relative paths use the requesting site's CID or IPNS name, except for explicitly namespaced `/ipfs/` and `/ipns/` paths. Scheme-relative external hosts use HTTPS. Explicit HTTP and HTTPS gateway addresses use the normal web transport. Favicon cache keys include the content root.

All IPFS/IPNS content deliberately shares **p2p://shared**. Unrelated applications can access each other's storage and BroadcastChannel messages. Browser UI and HTTP origins remain outside that origin. Worker CSP prevents worker scope conflicts. Cache API availability follows Chromium; the browser does not implement its own Cache API policy.

Relative links work, directories redirect to a trailing slash, and explicit content-root paths work. `/style.css` has no unambiguous CID and is not globally rewritten. Scripts see their real p2p location. Apps expecting a dedicated host or origin may need adaptation.

Content is retrieved via Kubo `files/stat`, `cat` and `name/resolve`, not an HTTP gateway. Readable streams propagate cancellation without buffering whole files. The RPC inactivity timeout applies to content streams only until the response starts, so a paused video is not cut off. MIME comes from file extensions, then at most 4096 bytes of signature/text inspection. GET, HEAD and single byte ranges (including suffix ranges) are supported; multipart ranges return 416. Directories prefer index.html; when that entry is absent, RPC ls supplies a generated directory listing. Listing names are escaped, href paths are encoded, traversal names are filtered, root listings have no parent link, and a strict script-free CSP is applied. HEAD responses are supported and displayed listings are limited to 5000 entries. Other index/RPC errors are not silently replaced by an empty listing. Kubo resolves IPNS names and DNSLink according to its capabilities.

## Kubo lifecycle and retention

The official Kubo 0.43.1 Linux x64 archive is pinned by SHA-256 in the build download script. The archive cache is verified too. Kubo and its licenses are packaged outside ASAR. Runtime does not download Kubo. Other build targets are explicitly rejected for now.

The application owns `userData/ipfs` (0700), its persistent PeerID/config and `rpc-<random>.sock` (0600, fresh for every start). There is no administrative TCP listener; the HTTP gateway is disabled. New repositories get dynamic swarm ports to avoid port collisions; swarm addresses changed by the user in an existing repository are kept, while the RPC socket and the disabled gateway are enforced on every start. Bitswap and routing remain active. RPC readiness is polled, lifecycle errors are reported, and exit/SIGINT/SIGTERM stops the node (each shutdown step is isolated, so a failing step cannot prevent the final quit), escalating to SIGKILL after eight seconds. SIGKILL of the browser itself or a system crash cannot guarantee child cleanup.

Default StorageMax=10GB, GC watermark=90%, GCPeriod=1h (applied only when the repository does not already set them), daemon --enable-gc. A Kubo process that crashes after having been ready is restarted up to three times (1 s, 5 s, 15 s backoff; the counter resets after a minute of uptime). A failed first start, or a node that exhausted its automatic restarts, shows a **Restart node** button next to the status; it reruns the normal start procedure. This is a **soft repository target**, not an enforced 10 GB unpinned-cache budget. Pinned blocks remain protected and can exceed the target. There is no custom LRU. SQLite records manual pins after successful RPC; Kubo is authoritative. A crash between the pin and metadata write can leave metadata requiring future reconciliation.

## Imports and metadata

Only the trusted UI can invoke importFiles/importDirectory. Native main-process dialogs supply filesystem paths; renderer IPC cannot select arbitrary local paths. Multipart input and NDJSON output are streamed over the Unix socket, requesting pinned CIDv1 content. File selections use a wrapping directory; folder selections preserve their hierarchy. Final CID/root and stream errors are checked. Closing the application aborts active imports. Successful pin metadata is stored in SQLite; the import bookmark is stored in the favorites JSON file. UI receives names/addresses, never local source paths.

The database stores history, restore-tabs preference, previous tab URLs, language preference, and manual pin metadata. History keeps the newest 10,000 visits. **Clear browsing data** in Settings asks for native confirmation, then deletes history plus cookies, site storage, cache and HTTP authentication of `persist:browsing`; bookmarks, settings, site zoom/audio preferences, favicons, pins and IPFS blocks are kept. Chromium stores site data separately; IPFS blocks are in their own subdirectory. The default profile is `~/.perun/profile`. The executable/package identifier remains `ipfs-browser`. Test profiles use `IPFS_BROWSER_PROFILE`; `IPFS_BROWSER_OFFLINE=1` starts offline Kubo and marks traffic statistics unavailable.

## Localization and start page

On first run or in automatic mode, the primary entry from `app.getPreferredSystemLanguages()` selects a supported base language; an unsupported primary UI language falls back to English. Regional variants map to their base language. A manual language or automatic preference persists in SQLite. Language changes refresh chrome, native application-menu labels, dialogs, catalog descriptions and dynamic UI without recreating tabs or changing website origins. Chromium/OS native strings and external diagnostic details may retain their own language.

Localized text is inserted as text, never interpreted as HTML. Catalog anchors retain the exact supplied IPFS URLs and open controlled new tabs. They are not prefetched or pinned automatically. Descriptions are collection metadata, not claims of live verification or compatibility.

## Distribution

The installer builds as the invoking ordinary user in an isolated temporary checkout. It can provision pinned, SHA-256 verified Node 24 and calls sudo only for the final DEB installation. Public HTTPS cloning requires no GitHub account; authenticated gh is optional during private development. Source assets include the SVG and PNG logo; the desktop launcher and native window use the PNG. No release upload, visibility change or automatic updater is part of installation.

## References

- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol)
- [Electron system language APIs](https://www.electronjs.org/docs/latest/api/app/#appgetpreferredsystemlanguages)
- [Forge Vite](https://www.electronforge.io/config/plugins/vite)
- [Kubo configuration](https://github.com/ipfs/kubo/blob/v0.43.1/docs/config.md)
- [Kubo RPC](https://docs.ipfs.tech/reference/kubo/rpc/)

## Settings surfaces and per-address preferences

BrowserState includes a settings/site overlay. Main-process layout hides browsing WebContentsViews while a trusted HTML dialog is open, so untrusted content cannot cover it. Closing a dialog restores the prior content/home surface. General settings contain language and tab restoration. Site controls sit next to the address bar and expose checked current-address pinning, zoom, mute, copy and bookmarking. Each mutating site action validates tab ID and public URL, rejecting stale panels.

Zoom/audio preferences persist in SQLite under HTTP(S) origins or IPFS/IPNS roots. New/navigated views apply the saved preferences. WebContents use Electron 45's official isolated zoom mode; changing zoom never changes origins or storage policy. Sensitive permissions are still denied, and no RPC access is exposed to content. Pages have no IPFS API of their own: the generic website IPFS API described for 0.14–0.15 in the roadmap was withdrawn together with the forum. isPinned queries Kubo's authoritative pin set; unavailable nodes are displayed as unavailable rather than unpinned.

Japanese and Korean extend localization to ten languages, including catalog descriptions, settings and directory-listing labels.

The start page receives the running application version through BrowserState from app.getVersion(). It groups available catalog entries into nonempty localized categories and supports category filtering. Domain and status text are inert metadata, not external links or results of live verification. All supplied addresses retain their original spelling, protocol, path and trailing slash; normal browser commands perform navigation. No catalog RPC calls or content prefetching occur at startup.

Link previews use Electron’s native `update-target-url` event on the active browsing WebContents and trusted start-page WebContents. Valid targets are converted to public URLs and displayed with BrowserWindow.setTitle. Navigation, tab/layout changes and blur clear the preview; background tabs cannot change it. No page scripts or additional website IPC are involved. Starter bookmarks are JSON defaults; removing individual entries is preserved, while deleting the file resets to defaults on the next launch.

Each in-memory tab now retains its own home/content state. Switching tabs or closing an adjacent tab derives the visible surface from the newly active tab, rather than unconditionally showing an empty WebContentsView. Settings remain a separate overlay.

The optional `npm run catalog:audit` maintenance command uses a fresh disposable online Kubo repository, private Unix RPC and public P2P retrieval. It resolves/stat-checks exact candidate paths, samples file/index content or lists index-less directories, and retries failures once. Only successful entries enter the start-page allowlist; original descriptions remain archived. `docs/catalog-audit.json` records timestamped failures and timeouts, which do not establish permanent disappearance. The script does not touch browser profiles, bookmarks or pins. No audits or network prefetches run automatically at application startup.

The trusted bookmarks bar occupies the third toolbar row. A ResizeObserver reports the actual header height through a sender-checked, range-checked IPC command (80–240 DIP); main-process layout places browsing views immediately below it. The bar never scrolls: entries that do not fit (root bookmarks first, then folders, in bar order) are hidden and a » button opens them in a native menu, with folders as submenus; the renderer sends only the number of visible entries and main rebuilds the list from the store. While the active tab loads, the address field background fills from left to right as an indeterminate progress bar in six-second cycles (static under reduced motion); no view is drawn over the page. The new-tab button follows the last tab. Bookmark mutations refresh both bar and start-page shortcuts from the JSON-backed store. The star reflects the active public URL and is disabled for empty tabs; repeated star saves preserve the existing title and folder. Bar links are intercepted for checked navigation/current-tab or new-tab actions. Native link previews also handle toolbar links while a browsing view is visible.

Live bookmark/folder data lives in `~/.perun/bookmarks.json` (version 1, `bookmarks` and `folders` arrays). A missing file creates the default collection; existing empty collections remain empty. Production uses Electron's home path; explicit test profiles place the JSON directly under their isolated root. Names, IDs, URLs, uniqueness, folder references, file size and schema version are validated. Writes use a same-directory exclusive 0600 temporary file, fsync and rename; only successful writes update in-memory state. Malformed files remain untouched and cause a visible startup error. There is no exit-time save or external-file watcher. Removing a folder moves its bookmarks to the root bar. Folders remain one level. Each bookmark may carry an optional `description` (shown in the link tooltip) and an optional `shortcutFolderId`: a second folder in which the bookmark also appears in the folder dropdown and manager filter, while its `folderId` (bar or home folder) is unchanged. A shortcut must differ from `folderId`, must reference an existing folder, and is dropped when the bookmark is moved to another folder or when the shortcut folder is deleted. Starter bookmarks use shortcuts so one site can be listed under several topics. The manager is a separate trusted modal overlay: visiting views are hidden while it is open. Right-clicking a bookmark focuses its editable name; folder buttons open native navigation-only dropdown menus. No new website privileges or dependencies are introduced.

Folder dropdowns are Electron Menu popups anchored below their toolbar button. A trusted `openBookmarkFolder` command validates the folder ID and integer anchor coordinates against the current window/header bounds. Main loads entries directly from the favorites store, escapes native mnemonic markers, and navigates only after selection. Ctrl/Cmd selection creates a tab. Empty lists have a localized disabled item. The page view stays visible and the management overlay remains closed. Native menu lifetime is held until dismissal and closed during controller destruction; edits remain in the separate manager.

Website icons use `browser/favicons.ts` for origin-scoped candidate tracking, bounded fetches through the browsing Session, SQLite PNG caching and shutdown cancellation. Only HTTP(S) and bounded image data candidates from Chromium's `page-favicon-updated` event are accepted; immutable/mutable P2P addresses use local defaults. Missing candidates fall back to `/favicon.ico`; Chromium handles favicon discovery rather than a custom HTML parser. Raw responses (512 KiB limit, four-second timeout) go only to the trusted UI image decoder, which draws them into a 16×16 canvas. A sender-checked save command validates the PNG signature, dimensions and size, decodes it through nativeImage and checks the source fingerprint before persisting it. Stale results cannot replace icons for newer candidate URLs. The trusted UI allows image data URLs but does not permit remote image/script sources. Images never execute site JavaScript. Native menus load only validated PNGs or bundled protocol-default PNGs; renderer SVG defaults are bundled with Vite. Website Node/IPC/RPC permissions remain unchanged. Icon completion updates images without resetting bookmark-manager form edits.

`main/storage/profile.ts` prepares the `.perun` root synchronously before Electron readiness. Normal launches use `~/.perun/profile` for userData and sessionData. Favorites, logs, crash dumps and temporary files live under `~/.perun`. Custom roots retain their flat layout. Startup leaves older profile locations untouched.

Favicon candidates are retained per tab and applied to the shared origin cache when that tab is active. Background favicon notifications cannot replace the selected tab's origin candidates during restoration; switching or closing a tab applies the newly selected tab's candidates.

## Startup recovery

Startup probes the legacy/configured/official API-marker Unix endpoints for active listeners before rewriting configuration. Inactive socket files are not deleted; fresh per-run paths avoid stale-bind failures. Each readiness probe targets only the newly assigned endpoint. Spawn failures clear the child reference, and fatal status text extracts the actual error instead of swarm-address noise.
