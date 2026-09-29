# Codex MCP Bridge

Private transport between ChatGPT (orchestrator/reviewer) and local Codex (programmer). The bridge contains no LLM and never chooses the next programming prompt.

Fork of [joseanu/codex-from-chatgpt](https://github.com/joseanu/codex-from-chatgpt), originally authored by Antonio Ulloa. The upstream MIT [LICENSE](LICENSE) is retained. Keep the `upstream` Git remote.

**Status:** the MCP 2.0 server, durable events and real Codex two-turn workflow are validated locally. The real ChatGPT event-triggered continuation test is pending account/tunnel/plugin setup. A webhook acknowledgement alone is not acceptance. See [validation evidence](docs/VALIDATION.md).

## Contract

| Tool                                                                | Purpose                                                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex_models_list()` | Live account model catalog: IDs, display names, supported/default reasoning efforts, visibility and availability metadata. |
| `codex_task_create(workspace)`                                      | Validate an existing directory under the operator's root, durably prepare a task/thread, return `ready`. No turn starts.                                                  |
| `codex_turn_submit(task_id, prompt, request_id, expected_revision)` | Start a turn on that thread and return after acceptance. Same ID and prompt never start another turn, including after restart. Different content under the same ID fails. |
| `codex_task_get(task_id, detail?, since_revision?)`                 | Bounded compact, standard or debug evidence. Debug includes actual command statuses/exit codes.                                                                           |
| `codex_task_stop(task_id)`                                          | Durably stop the task and interrupt its exact active turn. Later submissions are blocked.                                                                                 |

Create → subscribe → submit. Both create and submit accept optional `model` and `reasoning_effort`. Choose model IDs from `codex_models_list`; exact display names and unambiguous single-word names also work. Ambiguous names fail. `minimum`/`maximum` select the lowest/highest advertised effort; unknown future effort labels require an exact selection. Every new submission revalidates against live `model/list`. No model list is hardcoded.

Omitted selection preserves Codex defaults on creation and the current settings on later turns. Explicit model selection with omitted effort uses that model's advertised default. `model: "default"` restores the installed Codex configuration, including its effort. Per-turn overrides use `turn/start` on the same thread and become its subsequent defaults, as documented by App Server.

Use a stable logical request ID, such as `review-TASK-OBSERVED_REVISION`, and ignore handled/outdated event revisions. A retry with a new ID is a new operation. Stale expected revisions fail. The idempotency record includes prompt and model/effort selection; changing any under the same request ID fails. Never infer test success from worker prose: inspect protocol completion, validation and exit codes.

Task reads include durable `model_evidence` per turn: requested selection, resolved arguments, and separately `effective` runtime settings with a protocol source. `thread/settings/updated` confirms overrides; omitted overrides inherit the previously confirmed thread settings. Missing runtime evidence stays null. A `model/rerouted` notification records the actual replacement model without inventing its unreported effort.

`events/list`, `events/subscribe` and `events/unsubscribe` share `/mcp`. Event `codex.task_changed` takes `{ "task_id": "UUID" }`. Payload: task ID, revision, status, reason and optional turn ID; no prompt, transcript, instructions or diff.

## Run

Requires Node 20+, installed Codex and its existing ChatGPT login. The bridge checks `account/read` before work and recovery, forces the supported ChatGPT login mode/OpenAI provider, and strips API keys, tokens and tunnel secrets from the child environment. API-key inference is rejected. It retains the installed Codex default unless the caller selects a supported model/effort. No API billing, payment or credits operation is implemented.

```powershell
npm ci
npm run build
npm test
.\scripts\start.ps1
```

On this Windows installation, operator configuration is `%LOCALAPPDATA%\CodexMcpBridge\config.json`, outside authorized workspaces. Health: `http://127.0.0.1:18887/healthz` and `/readyz`. Type `stop` in the operator console or press Ctrl+C to stop cleanly. The lock prevents concurrent writers. After abrupt exit, startup removes a stale lock only if its recorded process is absent, then reconciles through app-server; uncertain turns are never replayed.

For other installations, set these before `npm start`:

| Variable                      | Default / purpose                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `CODEX_WORKSPACE_ROOT`        | Existing operator-authorized root; default `~/workspace`. Realpath rejects symlink/junction escapes. |
| `CODEX_AGENT_STATE_FILE`      | `~/.codex-agent-mcp/state.json`; must be outside the workspace.                                      |
| `HOST`, `PORT`                | `127.0.0.1`, `8787`; executable rejects non-loopback, including the old opt-in.                      |
| `CODEX_BIN`                   | Installed Codex executable.                                                                          |
| `CODEX_AGENT_MAX_TURNS`       | 8, operator-owned and persisted. Reaching it emits `limit_reached`; deliberate new task required.    |
| `CODEX_AGENT_TURN_TIMEOUT_MS` | 1800000. Deadline requests interruption; uncertain terminal outcome becomes recovery-required.       |

The prepared configuration authorizes only `%USERPROFILE%\codex-bridge-disposable`. Change it deliberately in the private operator config. Never authorize a parent containing bridge source, configuration, state or tunnel secrets.

## Human approvals/input

No approval MCP tool is exposed. Documented tool annotations are not a server-verifiable human confirmation proof; no live host test established such a boundary here. Model-supplied approval is insufficient.

An actual local TTY exposes the small operator console:

```text
inspect TASK_ID
approve TASK_ID REQUEST_ID accept
approve TASK_ID REQUEST_ID decline
input TASK_ID REQUEST_ID {"question_id":{"answers":["answer"]}}
```

Inspect the pending operation first. Quote numeric-looking string request IDs as JSON; numeric/string IDs differ. Structured Codex permission decisions can replace `accept`. Exact pending request and decision-shape validation remain mandatory. There is no approve-all endpoint. Without a TTY there is no approval entry point: launch in a local terminal when human interaction may be needed. Never reuse pre-crash approvals against a new connection.

## ChatGPT / Secure MCP Tunnel

Use the [official Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels); no public inbound listener, browser automation, undocumented endpoint, alternate orchestrator or daemon polling ChatGPT.

The official client is prepared at `%LOCALAPPDATA%\CodexMcpBridge\tunnel`. With the bridge running:

```powershell
.\scripts\connect-chatgpt.ps1
```

The setup script inspects existing official runtimes/profiles, checks bridge readiness and runs `doctor`. Missing authorization returns `PLATFORM_AUTHORIZATION_REQUIRED`, without enabling API services or generating duplicate tunnels. With verified authorization it creates/reuses the private profile and starts the official managed runtime; `tunnel-client runtimes stop codex-bridge` stops it.

The runtime credential is solely for transport and lives outside the repository in `tunnel-runtime-key.txt`. The adjacent `tunnel-authorization.json` records the actual Platform permission review: `tunnelId`, `credentialSha256`, `modelInferenceAllowed: false`, `paidApiActivationRequired: false`, `tunnelsReadUseVerified: true`, and `verificationSource`. It is not self-attesting API proof: populate it only after inspecting the actual account/key permissions. Credential changes invalidate the review. Never probe inference to test permissions. Public RBAC docs separate Tunnels Read/Use from Model Capabilities Request; Batch Write also grants inference and must remain absent. Actual account/key restrictions remain unverified until Platform authorization is available. Stop if access requires billing activation, payment details, credits or inference permissions.

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
