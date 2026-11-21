# Security

Perun is a hobby browser project, not an audited security product. Please report suspected vulnerabilities privately to the repository owner rather than posting exploit details in a public issue. If GitHub private vulnerability reporting is enabled, use the repository's Security tab.

## Deliberate shared-origin behavior

Every IPFS/IPNS application uses `p2p://shared`. They can read and modify each other's localStorage/IndexedDB and exchange BroadcastChannel messages. This is an explicit architectural choice, **not isolation between content authors**. Do not store secrets in that origin. The browser's trusted interface and HTTP/HTTPS origins remain separate.

## Security boundaries

Untrusted content runs without Node integration or browser-chrome access, with Chromium sandboxing, context isolation and web security enabled. Sensitive permissions are denied. Administrative Kubo RPC is accessible only to the privileged process through a Unix socket in a private application repository. Imported content is public and unencrypted; native file/folder selection is available only through trusted browser chrome.

Do not disable sandboxing, CORS, CSP or certificate validation to work around a website or test issue. Local HTTPS fixture exceptions belong only in the test harness. Do not expose RPC over LAN or a public endpoint. Build scripts verify pinned downloads; review downloaded source code and package origin before installing.

## Public repository preparation

Local profiles, databases, private keys, tokens, environment files, build outputs and dependencies must not be committed. Repository history is retained; removing a file from the current tree does not remove it from old commits. If an actual credential is ever committed, revoke it rather than relying on a later deletion.
