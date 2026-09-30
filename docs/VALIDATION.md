# Validation record

## Live tunnel and ChatGPT connection, 2026-09-30

Created the dedicated Codex MCP Bridge tunnel through the official Platform UI, associated with the intended ChatGPT workspace. Existing unrelated tunnels and credentials were not reused or changed. The actual key-creation summary showed **exactly Tunnels Read and Use**, every other category **None**, and expiration **Never**, explicitly requested by the operator. A first key that could not be saved was revoked before replacement. The replacement was saved through a local masked prompt, outside the repository, with user/SYSTEM ACLs. No secret was printed. No billing activation, payment method, credit purchase or inference API request occurred.

Executed the authenticated branch of `scripts/connect-chatgpt.ps1`: profile creation, `doctor` and official managed runtime connection passed. Runtime control-plane health was `polling`, with zero consecutive failures; bridge `/readyz` reported ChatGPT authentication and protocol `2026-07-28`. The client's startup probe negotiated the same protocol and bridge version 0.5.0. Its detailed MCP health reports `same_child_evidence_unavailable` for HTTP transport; that field alone is not treated as a failure or proof of tool discovery.

The connection script now emits compact status instead of the client's full embedded log tail and fails if readiness or remote identity verification is missing. PowerShell parsing, `-PrepareOnly`, and a second complete connection run passed; the existing managed runtime and health endpoint were reused. The runtime key's ACL contains only the current user and SYSTEM, with inheritance disabled. An exact-value scan confirmed the runtime key was absent from the official client's log.

Created and connected the private ChatGPT plugin through its official UI. Its app details show all five tools and the **codex.task_changed** event. The tunnel recorded successful remote request/response exchanges, with no dispatcher failures. This establishes real remote discovery, not event-triggered execution.

Initial acceptance attempt in Chat mode, with the UI explicitly selecting **GPT-5.6 Sol**: ChatGPT called the live model catalog and created task `7fe53be8-0a16-4517-a350-b8f2b96f9fff`, thread `01a0ef67-a3df-7121-b79c-7305952efe01`, revision 4. It reported no callable event-subscription capability and correctly stopped before the first submit. Durable bridge evidence confirms status ready, turn count zero, no subscription and no event.

A separate Work-mode attempt, UI-selected **GPT-6 Sol**, explicitly requested the host Events capability rather than an ordinary bridge tool. It read the live catalog and created task `cff59d10-a7c0-411f-9455-47a42247d9b6`, thread `01a0ef6b-360b-7412-a1bf-a3b1a7c9efe6`, revision 4. It likewise reported the host subscription capability unavailable and stopped before submitting. Read-back through the official Codex app `read_thread` interface confirmed both final responses. Bridge persistence independently confirms both tasks remain ready, zero turns, zero subscriptions and zero outbox entries. The disposable repository still contains no test files.

These are observed limits of the two tested conversation hosts, not a claim that MCP Events is universally unavailable or that the server lacks event methods. The official documentation describes subscription and event-triggered responses, and ChatGPT's plugin UI discovered the event successfully. No hidden endpoint, model API call, synthetic subscription, polling fallback or browser-driven follow-up was used to make the acceptance test appear successful. Chrome was used for the explicitly authorized connection setup and initial test launch; neither the bridge nor its orchestration transport depends on browser automation.

**Acceptance remains blocked at subscription, before turn one.** No live ChatGPT webhook, callback verification, event-triggered task read, second turn, event-run model, write-tool confirmation or chat-lifecycle subscription survival was verified. The model names above are UI selections; no event run occurred, so they are not asserted as actual event-execution models. Existing real two-model App Server results below remain separate evidence.

## Windows operational resilience, 2026-09-30

Added an authenticated loopback operator-control endpoint on port 18888 for headless operation. Its bearer token is generated locally, stored under `%LOCALAPPDATA%\CodexMcpBridge` with inheritance disabled and access limited to the current user/SYSTEM, stripped from the Codex child environment, and never exposed through MCP or the Secure MCP Tunnel. Browser-origin requests are rejected. The CLI exposes only status, exact task inspection, exact approval/input correlation and graceful stop; there is no generic shell or approve-all operation.

Installed the per-user **Codex MCP Bridge Supervisor** Scheduled Task with an at-logon trigger, limited user privileges, no execution time limit, one-minute restart interval and ten supervisor restart attempts. The supervisor starts a missing bridge and reconnects the official managed tunnel only when its runtime process is absent. A live but temporarily unready tunnel is not killed, leaving ordinary network reconnection to tunnel-client itself.

Live fault injection passed without a Codex turn: killing bridge PID 10868 resulted in supervised replacement PID 13756; killing tunnel runtime PID 12768 resulted in official managed replacement PID 4924, which returned to ready. Deliberate `service.ps1 stop` then remained paused across repeated checks with both bridge and tunnel down; `service.ps1 start` cleared the persistent pause marker and returned the supervisor, bridge and tunnel to ready. The existing ChatGPT plugin/tunnel identity was reused.

Final operational-hardening validation: PowerShell parsing, TypeScript typecheck and build passed; the suite reported **74 tests: 73 passed, zero failed, one optional real-App-Server handshake skipped**. The new operator-control test covers missing authentication, browser-origin rejection, exact inspect/approval/input dispatch and graceful stop. No Codex model turn was used for this hardening work.

## Model selection correction, 2026-09-30

Removed the automatic Luna resolver. `codex_models_list` reads current `model/list`, including hidden/availability metadata; every new task/turn validates explicit model/effort against a fresh catalog. Default, exact efforts, minimum/maximum aliases and same-thread switching are covered. Selection enters the durable idempotency identity. Unknown actual settings remain unknown; the bridge never relabels requested settings as execution evidence.

Baseline for this continuation: clean published `18affc7`; 67 tests passed, one optional real test skipped. The expanded full run passed **73 tests, zero failures/skips** with the real App Server handshake enabled. Coverage includes child credential-isolation and alias ambiguity. Subsequent focused model/events/store checks cover the versioned idempotency hash and migration from old prompt-only records. TypeScript build and PowerShell parse checks passed. The prior 68-test result below refers to the initial implementation.

Real two-model integration, private disposable repository `two-turn-4SUBZG`:

| Turn | Actual model | Actual effort | Protocol result |
| --- | --- | --- | --- |
| `01a0ef41-d966-7912-99ba-8b14c62ed561` | `gpt-6-astra` | `low` | completed, addition fixed, test exit 0 |
| `01a0ef42-d908-7b90-a48a-b8f31d3db37f` | `gpt-6-sol` | `low` | completed, multiplication added, two tests exit 0 |

Both settings pairs came from `thread/settings/updated`, not inference from prompts. Shared thread: `01a0ef41-d055-7cd3-93b1-bbe6d84df93d`; exactly one `thread/start`. Independent Node tests passed. Actual third-turn interruption succeeded. Private report: `%TEMP%\bridge-real-state-sRvLzQ\integration-report.json`.

Fresh recovery test after enforcing ChatGPT login mode: running turn `01a0ef46-4f64-7ad0-89a8-2896508e1d8d` on thread `01a0ef46-464c-77e3-a006-9dedf0852a52` reconciled to interrupted after app-server restart. Only initialize/thread-read were needed; no turn replay. Its unspecified selection inherited the installed Astra/high configuration, reported by thread/start. Private report: `%TEMP%\bridge-real-recovery-s0QClY\report.json`.

The updated real HTTP smoke test negotiated modern MCP and discovered all **five** tools. It read the live catalog, created a real ready thread without a turn, read settings and stopped it. Socket bound only to `127.0.0.1:18887`; health/readiness report ChatGPT authentication.

Before Platform setup, `scripts/connect-chatgpt.ps1` correctly failed closed with `FAILED_CHECKS tunnel_id`. The live tunnel section above supersedes that initial blocker and records the subsequently exercised authenticated path.

Official [RBAC](https://developers.openai.com/api/docs/guides/rbac) separates Tunnels Read/Use from Model Capabilities Request; it also documents that Batch Write grants inference. [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) requires a runtime key. These documents alone do not establish account eligibility or charges. The later live Platform setup above supplies account-specific permission evidence without probing model inference.

Fork and freshly fetched upstream both started at `093bd39ea0770a80612a5184a85b82262759aa00`; no commits needed merging. MIT attribution and upstream remote retained. No architecture imported from the alternative project.

Official migration codemod ran at package root. Manual migration replaced legacy sessions with SDK v2 `createMcpHandler`, strict modern protocol and the documented Events extension. Capabilities were verified on the wire.

## Tests

Original 54-test suite ran before modifications. With its required workspace root configured: 50 passed, one optional real test skipped, three Windows portability failures. They concerned POSIX chmod, separators and privileged symlinks. Fixes retain security assertions using ACL checks and junction fixtures.

Expanded suite retains original coverage and adds modern discovery/tools, first-turn ordering, verification/signing, invalid inputs, callback policy, redirects, DNS pinning/rebinding, TTL/refresh/rotation/expiry, unsubscribe, retry bounds, stable IDs, durable pending delivery, quotas, idempotency, revisions, input/approval correlation and uncertain recovery. Final run: **68 passed, zero failed, zero skipped**, with `CODEX_REAL_APP_SERVER=1 node scripts/test.mjs`. Build/typecheck pass; npm audit reports zero vulnerabilities after the permitted transitive Hono update. PowerShell launcher/setup scripts also passed syntax parsing. This is not a general security certification.

## Real Codex

Installed `codex-cli 0.158.0-alpha.2.1`; `account/read` returned `chatgpt`; `model/list` supplied `gpt-6-luna`, selected dynamically.

Disposable repository: first prompt fixed addition and ran a test. After reviewing completion, a second prompt independently requested multiplication and a new test. Protocol read-back confirmed:

- Shared thread: `01a0ef10-e0e4-7e70-9f21-57bcae41235b`.
- First turn: `01a0ef10-e67d-7030-9cab-bc2b56c9a67c`, completed; test exit 0, one test passed.
- Second: `01a0ef12-7290-7892-99f6-6ca192ecd162`, completed; test exit 0, two tests passed.
- One `thread/start`; distinct programming `turn/start` calls. Independent local tests also exited 0.
- Third turn interrupted through actual `turn/interrupt`, confirmed interrupted. Restart retained thread and stopped state.

Separate recovery test stopped app-server while persisted status was running. Restart used `thread/read`, recovered interrupted on the same thread/turn, and issued no `turn/start`. Thread: `01a0ef14-d85f-77e2-a6c1-cfcc10779548`; turn: `01a0ef14-de87-75e0-8d0a-0db96f98389e`.

The installed PowerShell profile initially changed the worker's directory; exploratory commands failed. Luna recovered with `-NoProfile`. Those failures remain evidence, not passing validation. The unrelated profile was not modified.

## Real HTTP

Socket observed only at `127.0.0.1:18887`; health/readiness work. On-wire discovery advertises `2026-07-28`, complete result, tools and events. Official SDK v2 client pinned to this version negotiated modern, listed all four tools, created an actual thread without starting a turn, read and stopped the ready task.

## ChatGPT acceptance: pending

The live setup section above supersedes the former missing Platform authorization. Official tunnel-client v0.0.15, private runtime/profile, restricted credential and ChatGPT plugin connection are operational. Existing unrelated Local Browser Bridge resources were neither reused nor modified. These remain unverified because neither tested conversation could subscribe:

- ChatGPT callback verification and actual event delivery.
- Event-triggered read and second programming turn in the original conversation.
- Actual event-run model, host tool confirmations and chat-lifecycle subscription survival.

Synthetic webhook acceptance is never substituted for host execution. The bridge is left ready for a ChatGPT host that exposes the documented subscription capability.

## Work fallback while host Events are unavailable

Added bridge version 0.5.1 with read-only `codex_task_wait`. It waits in-memory for up to 20 seconds for a task to complete or enter an attention state; it never polls Codex App Server and never starts a Codex turn. A timeout returns the current compact state with `wait_timed_out: true`, allowing the same ChatGPT Work response to call it again. The normal MCP Events path remains unchanged and preferred when the host eventually exposes `events/subscribe`.

TypeScript typecheck/build passed. The full wrapper suite passed **75 tests: 74 passed, zero failed, one optional real-App-Server handshake skipped**. Coverage includes wait-until-completion, bounded timeout, and the MCP tool surface. No live Codex inference was used to implement or validate this fallback.
