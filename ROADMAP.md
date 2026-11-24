# Roadmap

[Original Polish project notes](docs/pl/ROADMAP.md)

## Implemented

- **0.1**: Linux Electron browser with HTTP/HTTPS, WebContentsView tabs, persistent history/bookmarks/settings, controlled popups and downloads. Embedded Kubo, private Unix-socket RPC, IPFS/IPNS, shared origin, streaming/ranges, pins/statistics and actual P2P transfer tests. Linux DEB/ZIP packaging.
- **0.2**: trusted-interface file/folder import to IPFS, streamed multipart RPC, pinned CID results, bookmarks, per-file copy/open actions and error/cancellation handling. Perun branding throughout browser chrome and Linux desktop packaging. One-command source installer.
- **0.3**: eight interface languages (English, Polish, Spanish, French, Chinese, Portuguese, German, Russian), automatic system-UI language selection with English fallback, persistent manual preference, translated native menus/dialogs, and the supplied 28-link IPFS start collection. English public documentation with preserved Polish originals.

## Validation and practical limits

Run the checks listed in README and CONTRIBUTING. Unit tests cover address routing, SQLite persistence, installer behavior, translation completeness/placeholders, locale selection and catalog URLs. Integration tests exercise real Kubo startup, CID/IPNS retrieval, identity persistence, byte ranges, streaming imports, invalid inputs and actual two-node P2P exchange. Playwright uses local HTTP/HTTPS/IPFS/IPNS fixtures and tests isolation, shared storage, tabs, downloads, imports, localization and the packaged application.

An untrusted HTTPS fixture is first rejected; trust is added only by the test harness. No sandbox/CORS/TLS bypass belongs in production. Headless testing requires Xvfb and a working sandbox. The DEB includes Electron's original root-owned SUID helper; installed-system validation is distinct from unpacked-package smoke tests. Real apt installation cannot be claimed tested when administrative privileges were unavailable.

The installer has been exercised through a clean source build and an authenticated clone from GitHub, including automatic verified Node provisioning. Installer unit tests mock sudo; they do not prove real apt installation. Catalog links are stored and routed as provided; tests do not require or prove public CID availability. The 10 GB target remains soft and manual pins remain protected.

## Next

1. Validate installation/removal on clean Ubuntu/Debian systems and broaden AppArmor/Wayland coverage.
2. Broaden media, large-transfer/cancellation, public IPNS/DNSLink and real-world IPFS application compatibility tests.
3. Review translations with native speakers, including regional variants and Chromium/OS-native dialogs.
4. Reconcile manual pin metadata after hard crashes between RPC and SQLite; investigate reliable child cleanup after browser crashes.
5. Measure cache behavior before considering stricter retention policies. Do not promise strict 10 GB enforcement through StorageMax/GC alone.
6. Prepare signed/versioned binary releases when distribution is explicitly requested. Repository visibility remains a separate owner-controlled decision.

## Out of scope

Accounts, device sync, encrypted P2P profiles, CRDT, wallets, search engines, extensions, automatic manifest replication, PubSub, publishing APIs for websites, automatic updates and non-Linux ports are not implemented. File imports are a trusted browser-interface feature, not a website API.

Current 0.3 validation: strict typecheck and lint pass; 33 unit, 4 real-Kubo integration and 6 Playwright scenarios pass. The language scenario covers system selection, all eight languages, native menu labels, catalog routing and persisted preferences. No public catalog availability or installed-system apt test is claimed.

## 0.4

- Japanese and Korean (ten UI languages total), with catalog and settings translations.
- Dedicated general-settings dialog behind a gear button; language and tab-restoration controls moved off the start page.
- Address-adjacent page-settings dialog: checked root pin/unpin, persistent scoped zoom/audio, reset, copy/bookmark and permission information. Views are hidden while trusted dialogs are open; stale target actions are rejected.
- Directories without index.html now use safe RPC-backed listings, including nested/empty folders, encoded filenames and HEAD. This fixes opening the wrapping directory of an imported text file.

0.4 validation: strict typecheck/lint, 38 unit tests, 4 Kubo integration tests and 7 Playwright scenarios pass. The new browser regression imports a text file, opens the wrapping-directory listing and follows its link; verifies root pin/unpin, ten languages in settings, scoped isolated zoom/audio, stale-target/input rejection, persistence and reset. The reported public CID itself was not required or fetched; the equivalent directory/file layout is tested locally. DEB and ZIP are rebuilt.

## 0.5

- Localized browser information and the actual running version on the start page, sourced from app.getVersion().
- 122 distinct IPFS/IPNS links in 17 categories: 94 supplied additions plus all 28 earlier resources. Localized category filter/counts and source-status notes; optional domain metadata.
- Original Polish descriptions preserved with English translations for new contributed metadata. Other locales fall back to English for untranslated metadata; all ten UI languages retain localized browser/category/status text.
- No live availability claims, automatic fetching, pinning or replacement of supplied addresses.

0.5 validation: strict typecheck/lint, 41 unit tests, 4 real-Kubo integration tests and 7 Playwright scenarios pass. Catalog tests verify all 122 distinct URLs, exact category counts, preserved earlier entries, status/domain metadata and metadata fallback. Packaged-app tests verify the displayed runtime version and link count; UI tests exercise category filtering and IPNS routing without requiring public reachability. DEB and ZIP rebuilt.

## 0.6

- Native window-title link previews using Electron update-target-url, including reverse mapping to original IPFS/IPNS URLs. Leaving links, navigation, layout changes and window blur restore the product name; background tabs cannot override the active preview.
- Nine requested starter bookmarks and start-page bookmark shortcuts. A one-time transactional migration also covers existing profiles, preserves existing bookmark titles and never restores examples after deletion.

0.6 validation: strict typecheck/lint, 44 unit tests, 4 real-Kubo integration tests and 8 Playwright scenarios pass. The new browser scenario hovers real HTTP, IPFS and IPNS links and start-page bookmarks, verifies native title destinations and reset behavior. Unit tests cover preview filtering/mapping and bookmark persistence without reseeding. Linux DEB and ZIP rebuilt; packaged launch tested outside the source tree. No installed-system apt test is claimed.

## 0.7

- Per-tab start-page visibility, preserved when switching tabs, closing adjacent tabs and dismissing settings.
- Always-visible bookmarks bar, active-page star feedback and immediate save/delete/import refresh. Current-tab clicks and modifier/middle-click new tabs; no duplicate URL rows.
- Live audit of all 122 submitted IPFS/IPNS resources using an isolated online Kubo node. Exact-path metadata checks, content sampling/directory listing for reachable candidates, and two attempts on failures. 34 resources passed; 88 excluded from the displayed collection. Original descriptions are archived and empty categories hidden. Timestamped JSON audit report and repeatable maintenance script provided.
- Eight starter HTTPS destinations checked separately, with HTTP protection responses recorded honestly; saved user bookmarks and pins are not removed.

0.7 validation: strict typecheck and lint pass; 45 unit tests, 4 real-Kubo integration tests and 10 Playwright scenarios pass. New browser regressions cover returning to start-page tabs, closing adjacent tabs, persistent bookmarks-bar rendering, star feedback/idempotence, navigation from the bar, toolbar link previews, restart persistence and deletion. Catalog tests match the recorded complete audit and require content samples or directory listings for every displayed entry. The live audit reached 26 peers during content verification; 34 entries passed (27 samples, 7 listings). Packaged-app launch was tested outside the repository. DEB/ZIP rebuilt; no installed-system apt test claimed.

## 0.8

- Compact toolbar sized from its actual DOM height, with bounded trusted IPC controlling view placement; removes the reserved empty band.
- Bookmark manager accessible from the bar or a bookmark's context click. Edit names, delete bookmarks, create/rename/delete folders and move bookmarks between folders and the root bar.
- Single-level persistent folders, safe additive SQLite migration and ON DELETE SET NULL to preserve contents when deleting folders. Star re-saves preserve custom names and grouping.
- All manager controls localized in the ten supported languages; websites remain hidden while the trusted manager is open.

0.8 validation: strict typecheck/lint pass; 47 unit tests, 4 real-Kubo integration tests and 11 Playwright scenarios pass. New tests cover migration of the original two-column bookmark schema, persisted folder/title edits, invalid names/folders, folder deletion preserving contents, right-click editing, star re-save preserving grouping, restart, deletion and bounded toolbar IPC. The browser test compares the active WebContentsView's top bound with the measured header and verifies removal of the 148px reserved band. Linux DEB/ZIP built, and packaged launch tested outside the repository; no installed-system apt test claimed.

## 0.9

- Favorites and single-level folders moved to `~/.perun/bookmarks.json`; SQLite retains history/settings/pins and untouched legacy bookmark rows.
- One-time migration preserves existing favorites. Deleting the JSON file restores defaults at next launch, without importing the archive again. Existing empty files (valid empty collections) stay empty.
- Versioned schema, URL/folder validation, private permissions, synced atomic replacement and in-memory rollback on write failure. Invalid documents are preserved and reported at startup.
- Explicit test profiles isolate favorites files; no tests touch the real home favorites file.

0.9 validation: strict typecheck/lint pass; 52 unit tests, 4 real-Kubo integration tests and 12 Playwright scenarios pass. File tests cover real JSON persistence/manual edits, one-time legacy folder/title migration, valid empty collections, deletion while open without exit-time resurrection, default reset, private permissions, invalid/unsafe documents staying untouched and rollback/temporary-file cleanup after replacement failure. The new browser regression reads the saved JSON, deletes it between launches and verifies that the nine defaults and empty folders are recreated. DEB/ZIP rebuilt and packaged launch verified outside the source tree; no installed-system apt test claimed.

## 0.10

- Clicking a bookmarks-bar folder opens a native navigation-only dropdown, with current-tab selection, Ctrl/Cmd new-tab selection, keyboard opening/dismissal and a localized empty state.
- Bookmark/folder editing stays in Manage bookmarks. Main validates folder/position arguments and builds native menus from the saved collection without exposing new website privileges.
- New Linux/Xvfb regression uses real X11 keyboard input to select from Electron menus, including modifier navigation and Escape; existing manager tests now access folders through the manager explicitly.

0.10 validation: strict typecheck/lint, 52 unit tests, 4 real-Kubo integration tests and 13 Playwright scenarios pass. The native-menu regression opens real Electron popups above the browsing view and selects entries with X11/XTest keyboard events inside Xvfb; verifies current-tab navigation, Ctrl new-tab selection, Arrow Down opening, Escape dismissal, empty-folder state, invalid IDs/coordinates and separate management. Linux DEB/ZIP rebuilt and packaged launch verified; no installed-system apt test claimed.

## 0.11

- Website icons beside tab/bookmark/catalog names and inside native folder menus. Chromium discovers declared favicon variants; conventional `/favicon.ico` is the initial fallback. ICO, PNG, SVG and inline data images supported by sandboxed Chromium decoding.
- Separate bundled defaults for HTTP(S), IPFS and IPNS. P2P icon display requires no network retrieval.
- Persistent normalized 16×16 PNG cache in profile settings, bounded anonymous favicon requests, stale-result rejection and shutdown cancellation. Favorites JSON remains unchanged.

0.11 validation: strict typecheck/lint, 54 unit tests, 4 real-Kubo integration tests and 14 Playwright scenarios pass. Local favicon fixtures cover conventional PNG-in-ICO, shortcut-icon PNG, declared SVG, inline data SVG, actual rendered pixel color, persistent PNG cache after restart with unavailable icon endpoints, default IPFS/IPNS separation and invalid PNG rejection. Native folder tests verify nonempty icons. Unit tests bound PNG dimensions/size and restrict accepted page origins. Linux DEB/ZIP rebuilt and packaged launch tested outside the repository; no installed-system apt test claimed.

## 0.12

- Consolidated runtime data beneath `~/.perun`: JSON favorites at the root, intact Chromium/SQLite/Kubo profile in `profile`, and dedicated logs/crashes/tmp directories.
- Early Electron userData/sessionData/log/crash/temp setup, including child-process TMPDIR.
- Safe one-time legacy profile rename preserving cookies, storage, history, cached icons and PeerID. Existing destinations remain authoritative; active profiles and unsupported moves are rejected without overwriting data.
- Tests isolate all paths; custom profile roots preserve their flat layout and migrate the former nested favorites file.

- Regression fix: background tabs no longer replace the active origin's favicon candidates during session restoration; switching/closing tabs reapplies the selected tab's candidates.

0.12 validation: strict typecheck/lint, 60 unit tests, 4 real-Kubo integration tests and 16 Playwright scenarios pass. Profile tests cover default/custom roots, intact migration including WAL/cookie/PeerID fixtures, preservation of existing JSON/destination profiles, and active browser/RPC refusal. A real legacy Electron profile is moved in an isolated test home; persistent cookies, localStorage, history, bookmarks and the same real Kubo PeerID survive. Runtime tests assert all managed Electron paths are inside the selected root. The favicon regression deterministically emits a background notification and verifies it cannot overwrite the active cached icon. DEB/ZIP rebuilt and packaged launch verified; no installed-system apt test claimed.

## Perun Protocol v1.0 — implementation plan

1. Reuse multiformats and Kubo Unix RPC: validate bounded raw JSON entries, raw/SHA-256 CIDv1 blocks, two named IPNS keys per local identity.
2. Add a small transport-independent client with local durable cache/outbox, serialized publishing, lazy feed-chain discovery, following and provenance-scoped local votes.
3. Add a real Kubo adapter and tests (including three users, retries, concurrency and restart); retain only current pointers/selected raw blocks.
4. Add a trusted browser protocol panel with identity/profile/post/reply/follow/vote/open/retain/retry controls. Keep keys/RPC outside visited pages.
5. Ship a static IPFS reader using the same validation/discovery code and a bounded native-protocol read adapter; write actions require the trusted panel rather than a fictional website API. Publish reader assets with bundled Kubo.
6. Document protocol, bootstrap/limits/trust/retention, run full regression and rebuild Linux packages.

## 0.13 — Perun Protocol v1.0 delivered

All six steps above are implemented. The reusable client validates and hashes bounded raw entries, maintains the two-IPNS identity/profile/feed model, serializes publication with a durable retry outbox, discovers bounded history incrementally, and computes direct-follow ratings from feed-chain provenance. Native UI supports Genesis, multiple identities, profiles, posts/replies, following, votes, opening entries/profiles, direct block retention and IPNS renewal. Keys remain in Kubo; SQLite persists cache and publication recovery state.

A bundled static reader is built, imported/pinned and opened as actual IPFS HTML/CSS/JavaScript. Its IndexedDB is a disposable cache. Public read responses expose the resolved IPFS path so the reader can verify that IPNS points directly to a raw entry. Reader write links open a reviewed native form and never publish automatically; no website RPC or signing API was introduced. New protocol controls support English/Polish, with English fallback; the static reader is English.

0.13 validation: strict typecheck/lint pass; **75 unit tests, 5 real-Kubo integration tests and 17 Playwright scenarios pass**. Coverage includes three identities/six named keys, raw CID verification, Genesis/profile/history semantics, identical parent/prev, follow-scoped different ratings, changed/withdrawn votes, forged JSON provenance, unavailable history, durable cache, partial/ambiguous IPNS failures, concurrent publication serialization, exact block retention, restart, actual IPFS reader loading, text/XSS safety and review-only intents. The real offline demo was rerun against its persistent scratch profile: identities and history were reused, with ratings +1/-1/0. Existing browser/P2P regressions pass.

Linux 0.13.0 DEB/ZIP rebuilt. Packaged launch works outside the source tree with bundled Kubo and reader assets; DEB app.asar matches the tested application, and its sandbox helper is root-owned mode 4755. Xvfb tests used the installed system SUID sandbox helper without disabling the sandbox. No installed-system apt test or public-network IPNS availability is claimed. Entry signatures, complete network/reply discovery, distributed multi-device writers and guaranteed historical retention remain outside v1.

## 0.14 — separate the forum from the browser

1. Remove the social panel, social IPC, perun:// intents, automatic social polling and bundled forum assets from Electron. Preserve existing local user data and Kubo keys.
2. Move the reusable protocol and web interface into an independently buildable `forum/` project. Keep protocol tests with the forum; ordinary browser tests remain separate.
3. Replace browser-only write links with web forms. Use the explicitly authorized minimal generic website IPFS API for Perun, and gateway reads/manual raw JSON publication elsewhere. No Helia or administrative RPC access.
4. Keep only an ordinary catalog link to the published forum/Genesis page in the browser. Build/test the static app and browser independently, including a real-browser (non-Electron) forum scenario.

All four correction steps are complete in **0.14.0**. The protocol/model/tests moved into an independently installable `forum/` project. Its static HTML/JS forms implement the complete workflow; other browsers can read through standard gateway paths and download exact manual raw JSON drafts. No Helia or application server was introduced. Electron contains only an ordinary forum/Genesis catalog link and a reusable `window.ipfs` bridge; it has no forum bundle, social panel, social IPC, custom social scheme or background social polling. Former 0.13 user data/keys remain intact.

Generic capabilities validate sender/top-frame/active page, scope keys by site, bound raw blocks to 32 KiB, require native confirmation for mutations, reject denied requests and preserve pre-existing/manual/other-site pins. Private keys and the administrative Unix RPC stay native. This is not strong origin isolation: all P2P pages still share origin, so confirmations remain mandatory and the site's public cache is untrusted. Restored IPFS tabs now wait for Kubo startup rather than loading a transient error page.

0.14 validation: strict typecheck/lint pass. Browser: **64 unit, 5 integration, 17 Playwright scenarios passed**. Independent forum: **14 unit, 1 real-Kubo three-user integration, 1 ordinary Chromium scenario passed**. The real IPFS website test covers the ordinary catalog link, existing Add directory import, three users, replies, follows, differing ratings, changed/withdrawn votes, denied writes, cross-CID key scoping and restart. The ordinary Chromium test has no Perun API and verifies gateway reads and manual post/vote/first-profile JSON. All existing HTTP/HTTPS/storage/P2P/localization/profile regressions pass. Native confirmations are mocked only in the test harness; production has no automatic-approval flag.

Linux 0.14.0 DEB/ZIP and a separate static website ZIP were built. The actual site is pinned in `~/.perun/forum-publisher/ipfs`; its ordinary start-page link was opened from that existing publisher profile and displayed Genesis successfully. Public IPNS/provider reachability and installed-system apt installation were not claimed/tested. A local offline preview command and independent publishing instructions are in forum/README.md.

## 0.15 — self-contained post documents

1. Build one HTML file with inline JS/CSS and hash-based CSP; no asset directory or separate Genesis JSON is required at runtime.
2. Add a bounded HTML entry envelope alongside legacy raw JSON. The first published post is Genesis; its CID is the hash of the entire HTML and is never embedded in itself.
3. Replace the technical console with a post/reply/vote interface. Create identity and maintain prev/IPNS/cache internally; keep manual tools in advanced settings.
4. Extend the generic website capability only as needed for bounded HTML documents and explicit key reuse across independently addressed posts, without exporting keys or silently granting signing access.
5. Test the one-file artifact, first-post Genesis, direct raw-CID navigation, replies/votes, other-browser manual publishing and existing browser regressions; rebuild Linux packages and update docs/catalog.

0.15 implementation is complete. The independent client builds exactly one HTML file with hashed inline JS/CSS. Newly published documents embed the v1 entry and derive their complete raw CID from public layout/data/code bytes, without self-fetching or embedding their own CID. The first post is Genesis and the founder's first profile; both IPNS pointers target that same HTML file. Replies, votes and profile changes are complete document blocks as well. Legacy JSON decoding remains supported.

The ordinary interface now shows post text and Reply/Like/Dislike/Follow/Share/Save buttons. Profiles are created automatically; protocol identifiers and manual tools are in advanced settings. First publication opens its direct IPFS address. New post stays in the current network. Names use ordinary name: tags. A selected author can continue writing on a reply's independent CID using an explicit native useKey grant; private keys never enter the page and each publication still requires native confirmation. Raw capability bounds increased to 256 KiB while logical entry JSON remains bounded to 32 KiB.

0.15 validation: strict typecheck/lint, 64 browser unit tests, 5 browser integration tests, 17 forum unit tests and the independent real-Kubo integration pass. The ordinary Chrome scenario verifies no asset requests, exact file/CID identity, manual HTML replies/Genesis and offline opening of a downloaded .html file. The actual Electron scenario verifies first-post Genesis, three profiles, replies/votes/follow score, opening a reply directly, continued same-author publication after key reuse, cancellation preserving composition, and restart. The full browser suite also retains HTTP/HTTPS/P2P/profile/bookmark/localization coverage. A final run exposed an existing favicon fixture race after asynchronous session restoration; the test now waits for the background fixture before emitting its event.

The 0.15 Linux DEB/ZIP and separate post.html/new-post.html files are built. The real start-page link was opened against the retained publisher repository and its displayed CID matched the actual HTML bytes. Old keys, pins and sample networks are preserved; maintainer publication archives prior HTML and requires an explicit fresh network when changing a Genesis. These tests establish local operation, not public provider/IPNS reachability or an installed-system apt test.

Final 0.15 regression: all **17 Electron Playwright scenarios pass** after the fixture synchronization correction; the independent Chrome scenario also passes. All 81 unit tests and 6 integration scenarios are green across the browser and forum packages. The DEB app.asar matches the tested application and its sandbox is root-owned mode 4755. Standalone artifacts are `out/forum/post.html` (51,780 bytes) and `out/forum/new-post.html`; both are locally pinned as individual raw blocks.

## 0.15.1 — restart after stale Unix sockets

Replaced the fixed RPC socket with a fresh private per-start address; legacy/crashed socket files are left untouched. Active endpoints from config, legacy rpc.sock and the official API marker are checked before rewriting config, so another daemon is not adopted or terminated. Migration follows the API marker too. Spawn failures no longer leave a child reference that could hang startup/shutdown; fatal status uses the error line rather than swarm-listening output.

Validation includes a real abandoned Unix socket, real Kubo SIGKILL/restart with unchanged PeerID and retained content, active-node/socket/config preservation, a non-Kubo listener and a missing executable with an existing repo. Socket allocation/diagnostic and active-marker migration unit tests were added.

0.15.1 final validation: typecheck/lint, **67 unit tests, 9 real-Kubo integration cases and all 17 Electron Playwright scenarios pass**. The SIGKILL test verifies both PeerID and published file content survive. Linux DEB/ZIP were rebuilt; packaged startup, normal IPFS/IPNS browsing, the single-file forum and profile migration pass without disabling the sandbox.

## 0.15.2 — IPNS reply timeout handling

- Replace the website API's 15-second IPNS deadline with 120 seconds for publication and 60 seconds for resolution (55-second DHT collection). Align the Unix HTTP and cancellation deadlines so they do not interrupt publication early.
- Report which operation timed out, keep failed publication as an error, and preserve the existing forum outbox/retry flow. No offline-success fallback or security changes.
- Regression coverage injects Kubo deadline failures, checks publication deadlines, and verifies that retry releases the serialized writer. Real Kubo tests use local/offline fixtures; they do not prove public DHT reachability or availability of a user's CID.
- Existing immutable forum HTML benefits from the browser API change after upgrading the browser. Improved forum messages apply to newly built HTML documents.

Validation: typecheck/lint, 67 browser unit tests, 9 browser integration tests, 17 forum unit tests, 1 forum integration test, and the Electron forum end-to-end scenario pass. Linux DEB/ZIP build completed. Public-network reproduction of the reported URL remains unverified.

## Forum publication diagnostics

The standalone HTML now reports each actual transport operation, per-step/total
elapsed time, and a bounded expandable activity log. It marks pending replies as
unconfirmed, disables duplicate submit during work, reports partial author refresh
failures, renders refreshed authors incrementally, and delays automatic refresh
while composing or immediately after an operation. Existing immutable HTML does
not acquire updated JavaScript automatically. Browser capabilities remain unchanged.

## 0.15.3 — default website publishing permission

Website IPFS mutations now proceed without native confirmation dialogs by explicit owner request. Sender/active-tab checks, input bounds, web-key namespaces and protection of unrelated pins remain. Known web keys can be rebound using useKey without a dialog; private keys and non-web keys remain inaccessible. Online IPNS publication with zero connected peers fails immediately with actionable diagnostics and preserves the locally saved post. DHT publication failure remains a failure, never silently treated as global availability. The standalone HTML no longer asks readers to look for confirmation dialogs.

0.15.3 validation: strict typecheck/lint, 67 browser unit tests, 9 integration tests (including zero-peer rejection with retained data), 19 forum unit tests and the standalone Chromium scenario pass. All 17 browser E2E scenarios pass, including publishing with confirmation dialogs configured to throw. Public DHT propagation and the user-provided CID remain unverified.

## 0.15.4 — imported IPFS bookmarks

Automatic import bookmarks now use a reusable myIPFS folder, filenames with CID suffixes for name collisions, and a CID-suffix fallback when no name exists. Folder and bookmark are written atomically to bookmarks.json. Reimport preserves existing user edits and folder choices.

0.15.4 validation: typecheck/lint, 68 unit tests, 9 integration tests, and the Electron file/directory import scenario pass. Tests cover myIPFS reuse, CID fallback, duplicate names, persisted JSON, and preservation of edited bookmarks. Linux packaging is built from the checked source.

## 0.15.5 — shared IPFS/IPNS icon

IPNS and internal p2p:// addresses use the same turquoise cube as IPFS in tabs, bookmarks, start-page links and native folder menus. Protocol labels and URLs remain distinct.

0.15.5 validation: typecheck/lint and 68 unit tests pass. The Electron favicon scenario confirms that IPFS/IPNS use the same image while retaining distinct protocol labels. Linux DEB/ZIP packages include the shared assets.

## Forum separation

The standalone forum and its site API were removed from the browser source tree. Existing browser profiles and Kubo repositories are retained.

## 0.18.0 — robustness, privacy and toolbar fixes

- Script-driven popups are blocked: a tab may open one popup per recent click or key press.
- Downloads no longer freeze the main process: the save dialog is asynchronous and the file is moved from a profile temporary file after the choice.
- **Restart node** recovers from a failed first Kubo start or exhausted automatic restarts.
- Shutdown isolates each cleanup step, so a failure cannot leave the application running.
- **Clear browsing data** (history, cookies, site storage, cache) with native confirmation; history is capped at 10,000 visits.
- The legacy unscoped `pin`/`unpin` commands were removed; pinning uses the page-scoped `sitePin`/`siteUnpin` commands.
- Documentation no longer describes the withdrawn website IPFS API as present.
- The bookmarks bar no longer scrolls; entries that do not fit open from a **»** menu.
- Page loading is shown by the address field filling up in six-second cycles instead of a spinner over the page.
- The new-tab **+** button sits right after the last tab.

0.18.0 validation: typecheck/lint, 76 unit tests, 12 real-Kubo integration tests and 23 Playwright scenarios pass on Node 24. Linux DEB and ZIP were built; the packaged-app smoke test, RPM and AppImage were not run in this environment (no root-owned SUID sandbox helper, rpmbuild or appimagetool).
