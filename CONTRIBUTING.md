# Contributing

Use Node 24 LTS, npm and the committed lockfile. Keep the application small: prefer official Electron/Kubo APIs and existing maintained libraries. Add a dependency only for a concrete need. Avoid rewriting working modules without a technical reason.

## Development

```bash
nvm install
nvm use
npm ci
npm run kubo:download
npm start
```

Follow the module boundaries in [ARCHITECTURE.md](ARCHITECTURE.md). Build and download scripts must preserve checksum verification and avoid runtime downloads of Kubo. Keep application metadata separate from the IPFS block repository. Never delete user profiles or silently replace their PeerID.

## Required checks

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run package
xvfb-run -a npm run test:e2e
```

Run checks appropriate to the changed behavior. Use local fixtures and report environmental blockers honestly. Never disable the sandbox, CORS or certificate validation to make tests pass. Keep production certificate handling distinct from local test-harness trust.

## Localization

English source strings and complete locale dictionaries live in `src/shared/locales`. Preserve all placeholder names and add the same keys to every language. Avoid translated HTML and use textContent. The Polish documentation originals remain in `docs/pl`; keep user-facing translations intact when revising English documentation.

Catalog URLs must remain explicit IPFS/IPNS addresses and use the normal browser controller. Do not preload or automatically pin catalog contents. Mark availability/compatibility as network-dependent rather than claiming validation from a gateway fetch.

## Security

Keep nodeIntegration=false, contextIsolation=true, sandbox=true and webSecurity=true. Untrusted pages must not receive browser-chrome APIs, raw Electron IPC, unrestricted Kubo RPC or private keys. Validate IPC senders and arguments. Keep the UI separate from the deliberately shared IPFS origin; do not put secrets there. RPC must remain on the private Unix socket. Manual pins are never garbage-collected by application policy. See [SECURITY.md](SECURITY.md).

Do not publish a release or change repository visibility as a side effect of a code change. Include the reason for your change, relevant tests and known limitations in contributions.
