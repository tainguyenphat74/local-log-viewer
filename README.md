# Local Log Viewer

A single-user log workspace: a React virtualized viewer, an authenticated gateway, and an outbound-only Linux agent. Logs are read from explicitly approved local folders; the browser never supplies filesystem paths. Node 22, pnpm 10, Linux with /proc are required.

## Run locally

~~~sh
corepack enable
corepack prepare pnpm@10.34.7 --activate
# If corepack is unavailable: npm install -g pnpm@10.34.7
pnpm install --frozen-lockfile
pnpm build

# Prompt without putting the password into shell history:
read -rsp 'Gateway password (12+ characters): ' LOGVIEW_PASSWORD; echo
export LOGVIEW_PASSWORD
pnpm gateway
~~~

Open **http://127.0.0.1:8787** and sign in. The gateway binds only to loopback by default. In another terminal:

~~~sh
# Optional: create isolated, non-sensitive fixture logs in a new temporary directory.
pnpm agent demo
# Approve the printed directory explicitly (or your own intended log directory):
pnpm agent roots add /absolute/path/to/logs "Application logs"
pnpm agent roots list
~~~

Click **Pair agent** in the browser. Run the displayed command on the machine with the logs within two minutes, then **pnpm agent start**. The one-time code is exchanged for credentials stored with mode 0600 in ~/.logview/config.json. Use LOGVIEW_CONFIG for an isolated config location. Treat pairing codes as temporary secrets; avoid terminal recording and shared shell history.

Expand a folder, open files, and use **Earlier / Later**, scrolling, or **Jump to end**. Tabs retain independent scroll, filters and queries during the browser session. **Follow live** follows only the active tab and restores after a temporary disconnect. Search results navigate to byte offsets. Ctrl/Cmd+F focuses search, Escape cancels search, and Space toggles follow outside inputs. Severity filtering applies to loaded lines; search scans the file on the agent.

Multiple roots are saved locally. **pnpm agent roots remove ID** revokes a root from configuration; **restart the running agent to apply local config changes**. Folder show/hide controls in the UI only select already approved roots; remote folder.add cannot grant access. **Revoke** removes an agent's credentials from the gateway and disconnects it. Pair again to restore access.

For frontend development, run the gateway with **LOGVIEW_ORIGIN=http://127.0.0.1:5173 pnpm gateway**, then **pnpm dev** and open port 5173. Vite proxies HTTP and WebSockets to loopback port 8787. Use the built gateway for pairing remote agents.

## Security and privacy

- The gateway terminates TLS and **can see plaintext log contents**. This is TLS-protected relay transport, **not end-to-end encryption**. Host it under your control; do not approve sensitive folders casually.
- Browser auth uses an eight-hour HttpOnly, SameSite=Strict cookie, with Secure on HTTPS. Origin checks protect login and WebSocket upgrades; authenticated HTTP mutations also require a session-bound CSRF header. No auth tokens are stored in URLs or localStorage. Login and pairing claims are limited to ten attempts per minute per TCP peer.
- Agent credentials travel in the outbound WebSocket Authorization header. Pairing codes expire after 120 seconds and can be claimed once. Only credential hashes persist on the gateway; browser sessions and pending pairings are memory-only. Restarting the gateway requires browser login again but agents reconnect.
- Opaque file IDs, canonical root containment, O_NOFOLLOW, regular-file checks and Linux descriptor-path revalidation constrain reads. Symlinks are omitted from directory trees. File operations recheck authorization and containment. These reduce path races; they are not an OS sandbox against a privileged local attacker.
- Reads, searches, queues, connections and message sizes are bounded. Every request is schema-validated and routed using a gateway-generated identifier. Disconnects cancel work and watches. Logs are never persisted by the application or included in operational logs. Browser memory does contain viewed logs.
- Protect agent config and gateway state backups. Passwords come from the environment; no production password is bundled. .env.example is configuration guidance only; shell startup does not automatically load it. Do not commit .env, logs, credentials or build output.

## Deployment

Either run **pnpm build && pnpm gateway** under a process supervisor, or:

~~~sh
# Set LOGVIEW_PASSWORD securely in the environment first.
# Set LOGVIEW_ORIGIN to your exact external HTTPS origin.
docker compose up --build -d
~~~

Compose publishes **127.0.0.1:8787 only**, runs as a non-root user, and persists agent registrations in a named volume. The image uses Node 22 and includes TypeScript tooling for the agent/gateway entry points. The local agent runs separately on the computer that owns the logs; do not mount host log directories into the gateway.

Place an HTTPS reverse proxy in front of the loopback gateway; see [deploy/Caddyfile.example](deploy/Caddyfile.example). Set LOGVIEW_ORIGIN=https://your-hostname exactly, without a path. Forward WebSocket upgrades, preserve the browser Origin header, allow long-lived connections, and disable payload/access logging that could record credentials or content. Browser connections use WSS automatically; the agent requires HTTPS/WSS for any non-loopback gateway. Plain HTTP is allowed only for loopback development. The proxy-to-gateway hop must remain loopback/private and trusted. TLS is not implemented in the Node listener.

This deployment supports one user, one gateway process and at most 20 paired agents. It has no multi-user isolation, SSO, clustering, audit trail, or log retention service. Session state is not shared across replicas. Rate limits use the TCP peer, not untrusted forwarding headers, so users behind one proxy share a limit. Do not expose the gateway's plaintext listener publicly.

## Limits

- UTF-8 newline-delimited text only. Pages normally contain 64 KiB plus complete boundary lines; a line may be at most 256 KiB. An unterminated final line is displayed and replaced as it grows. Invalid UTF-8 is decoded with replacement characters. Search skips oversized lines and reports the count; tail may skip an oversized leading fragment.
- Eight tabs, six chunks per tab; cache eviction is deliberate. Scroll history beyond cached data requires paging again. Tabs/presentation state are not persisted across page reloads. A full agent process restart invalidates opaque file IDs; reopen files from the tree.
- Search stops after 100 results or 15 seconds and reports partial coverage. Queries are at most 256 characters. Regex mode supports **literal alternatives with | and optional ^/$ anchors only**, e.g. ^ERROR|timeout$. No quantifiers, groups, escapes, classes or wildcard syntax; this avoids catastrophic backtracking.
- Polling every 500 ms detects inode replacement, size reduction and modification. A truncate-and-regrow between polls can be indistinguishable from an append. Replaced files must stay under an approved root. Paused and inactive tabs hold no watch subscription.
- Up to 10,000 entries per directory, 50,000 indexed paths per agent, eight active agent operations/watches, twelve pending requests per browser, 128 gateway routes, 1 MiB frames and 2 MiB outbound queues. Slow consumers are disconnected instead of accumulating data. RPC deadlines are 20 seconds.
- Local root changes require an agent restart. Persistent credentials are intended for a trusted personal machine. The agent does not expose any listening port.

## Verify

~~~sh
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:browser
~~~

Tests use temporary fixture directories, including sparse 3–4 GiB files; they do not read host logs. Coverage includes protocol validation, traversal/symlink containment, UTF-8 byte paging, bounded search/cancellation, append/truncate/rotate watching, authentication, pairing expiry/reuse/revocation, origin rejection, cross-browser/cross-agent routing, deadlines, concurrency/frame/backpressure limits and reconnect. The Chromium test starts an actual gateway and outbound agent, pairs through the UI, and exercises the main viewer flows. CI runs these commands on Node 22 Linux.

SPEC.txt is the original design reference. Generated assets, node_modules, runtime state and test reports are ignored by git.
