# Codex MCP Bridge

Private transport between ChatGPT (orchestrator/reviewer) and local Codex (programmer). The bridge contains no LLM and never chooses the next programming prompt.

> **USER-OPT-IN ONLY.** Codex MCP Bridge belongs to the user, not to the assistant. ChatGPT must never invoke any bridge tool because Codex seems useful, the task is programming-related, complex, long, or suitable for delegation. Use is authorized only when the user explicitly instructs ChatGPT to use Codex for the current task. A coding request, a mention of Codex, a question about Codex, or past authorization is not permission. Once explicitly authorized, the bridge may be used autonomously for the whole resulting Codex task, including follow-up turns, testing and corrections, without additional opt-in prompts.

See [USER_OPT_IN.md](docs/USER_OPT_IN.md) for the exact scope, acceptance examples and audit semantics.

Fork of [joseanu/codex-from-chatgpt](https://github.com/joseanu/codex-from-chatgpt), originally authored by Antonio Ulloa. The upstream MIT [LICENSE](LICENSE) is retained. Keep the `upstream` Git remote.

**Status:** the MCP 2.0 server, durable events and real Codex two-turn workflow are validated locally. The official tunnel is running. ChatGPT host-side `events/subscribe` is still unavailable in the tested Chat/Work surfaces, so true asynchronous wake-up remains unverified. The official-tool fallback `codex_task_wait` is live-validated in normal Chat as well as Work: one Chat response can complete multiple Codex turns on the same thread, review each result and submit the next automatically, with no user message or manual relay between turns. Normal Chat is the preferred fallback path; Work is optional for unusually long orchestration. See [validation evidence](docs/VALIDATION.md).

## Contract

| Tool                                                                | Purpose                                                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex_models_list()` | Live account model catalog: IDs, display names, supported/default reasoning efforts, visibility and availability metadata. |
| `codex_threads_list(limit?, cursor?, workspace?)` | Bounded metadata for existing threads whose canonical cwd is within authorized roots; no history. |
| `codex_task_create(workspace)`                                      | Validate an existing directory under the operator's root, durably prepare a task/thread, return `ready`. No turn starts.                                                  |
| `codex_task_attach(thread_id)` | Attach a completed existing thread as a ready task; history is preserved and counts as zero bridge turns. |
| `codex_turn_submit(task_id, prompt, request_id, expected_revision)` | Start a turn on that thread and return after acceptance. Same ID and prompt never start another turn, including after restart. Different content under the same ID fails. |
| `codex_task_get(task_id, detail?, since_revision?)`                 | Bounded compact, standard or debug evidence. Debug includes actual command statuses/exit codes.                                                                           |
| `codex_task_wait(task_id, since_revision, timeout_ms?)`              | Read-only Chat/Work fallback when Events are unavailable. Waits without backend polling for a supervisory revision change or attention state; default 30 s, maximum 45 s.  |
| `codex_task_stop(task_id)`                                          | Durably stop the task and interrupt its exact active turn. Later submissions are blocked.                                                                                 |

Create → subscribe → submit. Both create and submit accept optional `model` and `reasoning_effort`. Choose model IDs from `codex_models_list`; exact display names and unambiguous single-word names also work. Ambiguous names fail. `minimum`/`maximum` select the lowest/highest advertised effort; unknown future effort labels require an exact selection. Every new submission revalidates against live `model/list`. No model list is hardcoded.

Omitted selection preserves Codex defaults on creation and the current settings on later turns. Explicit model selection with omitted effort uses that model's advertised default. `model: "default"` restores the installed Codex configuration, including its effort. Per-turn overrides use `turn/start` on the same thread and become its subsequent defaults, as documented by App Server.

Use a stable logical request ID, such as `review-TASK-OBSERVED_REVISION`, and ignore handled/outdated event revisions. A retry with a new ID is a new operation. Stale expected revisions fail. The idempotency record includes prompt and model/effort selection; changing any under the same request ID fails. Never infer test success from worker prose: inspect protocol completion, validation and exit codes.

Task reads include durable `model_evidence` per turn: requested selection, resolved arguments, and separately `effective` runtime settings with a protocol source. `thread/settings/updated` confirms overrides; omitted overrides inherit the previously confirmed thread settings. Missing runtime evidence stays null. A `model/rerouted` notification records the actual replacement model without inventing its unreported effort.

`events/list`, `events/subscribe` and `events/unsubscribe` share `/mcp`. Event `codex.task_changed` takes `{ "task_id": "UUID" }`. Payload: task ID, revision, status, reason and optional turn ID; no prompt, transcript, instructions or diff.

When the ChatGPT host does not expose the documented Events subscription capability, keep the same Chat response alive after `codex_turn_submit` and call `codex_task_wait(task_id, since_revision, timeout_ms?)`. This is live-validated in normal Chat and is the preferred fallback; Work can use the same pattern for unusually long runs. The bridge registers an in-process waiter and wakes it when supervisory revision advances or the task reaches an approval/input/terminal state; it does not busy-poll Codex App Server. Use the returned revision for the next wait. A timeout is not a failure and consumes no Codex turn. Once terminal, read `codex_task_get`, review the evidence, and submit the next turn with a fresh request ID and current revision. This fallback uses only ordinary supported MCP tool calls; it does not wake a conversation after its response has ended.

## Run

Set `CODEX_WORKSPACE_ROOTS` to a JSON array of operator-owned development roots, for example `["C:\\Users\\me\\source","D:\\projects"]`. Authorizing broad development roots once means projects underneath need no per-project configuration. The legacy `CODEX_WORKSPACE_ROOT` remains supported when the array is absent. Do not authorize an entire drive or user profile unless that scope is intentional.

Requires Node 20+, installed Codex and its existing ChatGPT login. The bridge checks `account/read` before work and recovery, forces the supported ChatGPT login mode/OpenAI provider, and strips API keys, tokens and tunnel secrets from the child environment. API-key inference is rejected. It retains the installed Codex default unless the caller selects a supported model/effort. No API billing, payment or credits operation is implemented.

```powershell
npm ci
npm run build
npm test
.\scripts\start.ps1
```

On this Windows installation, operator configuration is `%LOCALAPPDATA%\CodexMcpBridge\config.json`, outside authorized workspaces. Health: `http://127.0.0.1:18887/healthz` and `/readyz`. The lock prevents concurrent writers. After abrupt exit, startup removes a stale lock only if its recorded process is absent, then reconciles through app-server; uncertain turns are never replayed.

### Windows autostart and service control

Install the per-user logon supervisor once:

```powershell
.\scripts\service.ps1 install
```

It keeps the bridge available and starts the official managed tunnel runtime if that runtime process is actually absent. A live-but-temporarily-unready tunnel is left to its own reconnect logic instead of being flapped. The Scheduled Task runs with limited user privileges, has no execution time limit, and restarts the supervisor after failure.

Use `service.ps1 status|start|stop|restart|uninstall`. A deliberate `stop` creates a persistent pause marker, stops the supervisor, tunnel and bridge, and therefore is not undone by the watchdog. `start` clears the marker and restores the stack.

For other installations, set these before `npm start`:

| Variable                      | Default / purpose                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `CODEX_WORKSPACE_ROOTS`       | JSON array of operator-authorized development roots. Canonical paths may live under any root; realpath rejects symlink/junction escapes. |
| `CODEX_WORKSPACE_ROOT`        | Legacy single-root fallback when `CODEX_WORKSPACE_ROOTS` is absent; default `~/workspace`. |
| `CODEX_AGENT_STATE_FILE`      | `~/.codex-agent-mcp/state.json`; must be outside the workspace.                                      |
| `HOST`, `PORT`                | `127.0.0.1`, `8787`; executable rejects non-loopback, including the old opt-in.                      |
| `CODEX_BIN`                   | Optional Codex executable. On Windows, stale official versioned paths are reconciled against the current official Codex runtime; ambiguous runtime selection fails closed. |
| `CODEX_AGENT_MAX_TURNS`       | 8, operator-owned and persisted. Reaching it emits `limit_reached`; deliberate new task required.    |
| `CODEX_AGENT_TURN_TIMEOUT_MS` | 1800000. Deadline requests interruption; uncertain terminal outcome becomes recovery-required.       |
| `CODEX_WORKSPACE_POLICY` | `roots` (default) or operator-owned `explicit` for any existing canonical local directory, excluding private state ancestors. This is a cwd guard, not a filesystem sandbox. |
| `CODEX_EXECUTION_POLICY` | `legacy` (default: workspace-write/on-request) or `danger-full-access` (local operator choice only). |
| `CODEX_BROWSER_WAKE` | `0` by default; `1` runs the supervised browser sender and permits optional browser wake requests. |
| `CODEX_LBB_MCP_PATH` | Required absolute operator-owned path to the existing LBB `dist/mcp.js` when wake is enabled. Uses the official MCP v2 stdio client; no new browser backend or listener. |

Browser wake is an explicitly authorized UI fallback, not OpenAI's [MCP Events](https://developers.openai.com/plugins/build/mcp-events) guarantee. A genuine active Events subscription is preferred at submission: the turn persists one transport. Event selection does not claim delivery; existing webhook receipts remain authoritative. With browser selected, the supervised bridge process owns a bounded, serialized outbox in the same atomic state file as task state. The process's exclusive state lock prevents a second sender. Version 2 migration preserves Events subscriptions and outbox; historical completed tasks acquire no browser notifications merely on restart.

Submit with `wake: "browser"` and preferably an exact `conversation_url: "https://chatgpt.com/c/UUID"`. Print the returned unpredictable `CW-BIND-...` marker in a short **started** final reply and **end the response**. A caller-supplied URL is routing data only: before any browser write, the sender must observe that same unpredictable binding marker rendered inside the opened conversation. Without a supplied URL, the sender searches the marker through public ChatGPT Global Search controls in its own tab, accepts one complete unambiguous result, then performs the same in-conversation marker proof before pinning its canonical URL. Search indexing can lag; zero matches retries, ambiguous/incomplete/stale matches block. The host supplies no implicit current-chat metadata. Browser bindings persist across turns; `wake: "none"` disables future browser delivery and suppresses obsolete pending wakes. The notification only tells ChatGPT to read `codex_task_get`: the original objective remains the only authorization for continuation, and approval/input/recovery requires human attention. No Codex output or worker prose is included.

The sender creates a sentinel-owned tab and persists its creation receipt, session/document epoch and canonical URL. It never adopts a user's working tab. Every composer write checks the URL. Idle proof uses coherent, complete semantic controls: enabled first header Share, enabled Regenerate response, enabled Ask ChatGPT composer, and no current Stop/Thinking/Working control. English/Italian default labels are supported; operator-owned `browserWake.labels` can supply arrays for `composer`, `share`, `regenerate`, `busy`, `search`, `searchInput`, and `userHeading` when the UI language differs. Missing or incomplete proof blocks with a specific diagnostic. A zero-character append probes length/hash without reading or deleting a draft. Any unknown nonempty draft blocks. The fixed envelope is appended only after empty proof, its exact length/SHA-256 is verified, and a second zero-append immediately before Enter detects concurrent changes. This is optimistic concurrency, not an atomic UI lock: a human can still race the final proof. The sender never erases a draft or clicks Stop.

Action IDs and prepare/dispatch/verify stages persist before effects. A lost result is reconciled through `browser_operation` with the same ID. A positive no-dispatch receipt permits a recorded new attempt; unknown effects never cause blind replay. Delivery requires the unique fixed wake message rendered outside the composer under an explicit user-message heading and an empty composer, not a click/Enter receipt. UI changes that omit reliable user-message/idle evidence can leave an entry blocked or uncertain. Status distinguishes pending, blocked, uncertain, delivered and cancelled. Newer turns, stop/disarm, 24-hour expiry and a maximum of 32 attempts suppress obsolete sends. Backoff starts at 10 seconds and caps at one hour; at most two tab creations per task are permitted. Chrome availability, login, search delays, UI changes and ambiguity can block this fallback. Login/MFA/CAPTCHA and LBB fences remain human-owned. Delivery and exactly-once web effects are **not guaranteed**. `codex_task_wait` remains available; no token/cost guarantee is implied.

Operator controls: `scripts\control.ps1 wake_status|wake_pause|wake_resume`. Status includes bounded per-wake inspection. Pause persists across restart, and the sender rechecks pause/stop immediately before send. Service shutdown disables dispatch and closes only its own LBB stdio child. It does not stop Chrome, LBB relay/tunnel, or other Codex work.

After reviewing the commit and confirming production is idle, merge these operator-owned fields into `%LOCALAPPDATA%\CodexMcpBridge\config.json` (preserve all existing fields):

```json
{
  "workspacePolicy": "explicit",
  "executionPolicy": "danger-full-access",
  "browserWake": {
    "enabled": true,
    "lbbMcpPath": "C:\\Codex\\Experiments\\local-browser-bridge\\dist\\mcp.js"
  }
}
```

`workspacePolicy: "explicit"` accepts existing canonical absolute local project directories anywhere without a root list, excluding the bridge's private state/credentials directory, its descendants and workspaces containing it. Legacy `roots` is the default. This is a **cwd guard**, not a filesystem sandbox: a full-access process under the same Windows account can read that account's secrets. `executionPolicy: "danger-full-access"` maps documented [App Server](https://developers.openai.com/codex/app-server) fields to danger-full-access/never for thread start/resume and turn start. Legacy workspace-write/on-request remains default. This policy is local operator configuration, never a model-callable approve-all or automatic acceptance of human prompts; global Codex config is untouched.

Review/deployment commands, only when the orchestrator authorizes a production maintenance window:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\control.ps1 wake_pause
# Stop/start the supervised bridge ONLY after checking unrelated work is idle.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1 -Status
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\control.ps1 wake_status
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\control.ps1 wake_resume
```

Development validation: `npm run typecheck`, `npm run build`, `npm test`. Deterministic mock-LBB tests exercise faults and restart stages; they do not establish live ChatGPT acceptance. The orchestrator owns the later live sleep/wake and deployment checks. No blocked current-conversation lookup should be retried through a different route.

The prepared Windows configuration can authorize broad development roots through private `workspaceRoots`, so projects underneath need no per-project setup. Keep configuration/state/tunnel-secret directories outside those roots and avoid authorizing an entire drive or user profile unless that scope is intentional.

## Human approvals/input

No approval MCP tool is exposed. Documented tool annotations are not a server-verifiable human confirmation proof; no live host test established such a boundary here. Model-supplied approval is insufficient.

Human-only operations are available through the local operator console when started interactively, and through the authenticated loopback control CLI when the bridge runs headless:

```powershell
.\scripts\control.ps1 status
.\scripts\control.ps1 inspect TASK_ID
.\scripts\control.ps1 approve TASK_ID REQUEST_ID accept
.\scripts\control.ps1 input TASK_ID REQUEST_ID '{"question_id":{"answers":["answer"]}}'
```

The control endpoint binds only to loopback, rejects browser-origin requests and requires a random token stored in the private runtime directory with user/SYSTEM ACLs. It is not exposed through MCP or the tunnel. Inspect the pending operation first. Quote numeric-looking string request IDs as JSON; numeric/string IDs differ. Structured Codex permission decisions can replace `accept`. Exact pending request and decision-shape validation remain mandatory. There is no approve-all endpoint. Never reuse pre-crash approvals against a new connection.

## ChatGPT / Secure MCP Tunnel

Use the [official Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels); no public inbound listener, browser automation, undocumented endpoint, alternate orchestrator or daemon polling ChatGPT.

The official client is prepared at `%LOCALAPPDATA%\CodexMcpBridge\tunnel`. With the bridge running:

```powershell
.\scripts\connect-chatgpt.ps1
```

The setup script inspects existing official runtimes/profiles, checks bridge readiness and runs `doctor`. Missing authorization returns `PLATFORM_AUTHORIZATION_REQUIRED`, without enabling API services or generating duplicate tunnels. With verified authorization it creates/reuses the private profile and starts the official managed runtime; `tunnel-client runtimes stop codex-bridge` stops it.

The runtime credential is solely for transport and lives outside the repository in `tunnel-runtime-key.txt`. The adjacent `tunnel-authorization.json` records the actual Platform permission review: `tunnelId`, `credentialSha256`, `modelInferenceAllowed: false`, `paidApiActivationRequired: false`, `tunnelsReadUseVerified: true`, and `verificationSource`. It is not self-attesting API proof: populate it only after inspecting the actual account/key permissions. Credential changes invalidate the review. Never probe inference to test permissions. Public RBAC docs separate Tunnels Read/Use from Model Capabilities Request; Batch Write also grants inference and must remain absent. On this installation the actual Platform creation summary confirmed exactly Tunnels Read/Use, every other category None, and expiration Never at the operator's request. No billing activation, payment details or credits were needed. Stop if a future setup requires any of those or inference permissions.

Associate the tunnel with the intended ChatGPT workspace and complete the private plugin connection in Developer Mode. Rescan tools/events, then use [the acceptance prompt](scripts/chatgpt-acceptance.txt). Disposable directory: `%USERPROFILE%\codex-bridge-disposable\chatgpt-acceptance`.

Acceptance requires the first event, after the initial ChatGPT response finished, to cause a task read and second programming turn in the subscribed conversation without another user message. Record actual host model if observable, confirmations and subscription survival. These remain unverified.

## Persistence/security

One atomic JSON document stores tasks, request hashes, quotas/deadlines, evidence, subscriptions and outbox. State and event intent commit together. Temporary files are flushed before replacement; POSIX also flushes the directory. POSIX uses 0700/0600; Windows uses protected user/SYSTEM ACLs. Corrupt/incompatible state blocks work rather than being overwritten. Version-1 state migrates on next write; legacy tasks with unknown counts conservatively consume the quota. Back up before manual state edits.

Subscriptions belong to the private operator's tunnel trust boundary, never caller-asserted identity. Workspace access is rechecked before delivery. Default/max TTL: 24 hours; null still grants a finite TTL. Deterministic refresh, five-minute verification cache and overlapping key rotation. No replay cursors: events created without an active subscription cannot be replayed, but task state remains readable.

Callbacks require HTTPS, public DNS answers, a socket pinned to the validated address, normal hostname TLS verification, no redirects, ten-second deadline and bounded response. Standard Webhooks signs exact bytes. Maximum body: 256 KiB. Event ID/body survive retries/restarts; each attempt gets a fresh signing time/signature. Eight attempts maximum, capped exponential backoff. 410, 413 and other non-transient errors terminate delivery. Events may duplicate/reorder. Unsubscribe cannot recall an already in-flight HTTP request.

Secrets remain in private state, never logs or event payloads. This trusts one local operator and the authorized tunnel; it is not multi-user authentication. Do not expose the listener through another proxy or to untrusted local users.

## Official references

- [MCP Events](https://developers.openai.com/plugins/build/mcp-events)
- [MCP server / confirmation annotations](https://developers.openai.com/plugins/build/mcp-server)
- [ChatGPT connection](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Codex app-server](https://developers.openai.com/codex/app-server)
- [SDK v2 migration](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)
- [Explicit 2026-07-28 support](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)
