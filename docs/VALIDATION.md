# Validation record

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

Executed `scripts/connect-chatgpt.ps1` from the machine. Official v0.0.15 runtime/profile inventories are empty for this project; remote inventory requires an admin key. Doctor reports `FAILED_CHECKS tunnel_id`. No runtime key is available and no scope verification has been fabricated. The script now fails closed until actual tunnel-only permission review is recorded and tied to the key hash, then uses official managed runtime commands. The authenticated branch of setup has not yet been exercised.

Official [RBAC](https://developers.openai.com/api/docs/guides/rbac) separates Tunnels Read/Use from Model Capabilities Request; it also documents that Batch Write grants inference. [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) requires a runtime key. These documents do not establish this account's eligibility or charges. No payment, billing activation, API credits or model-inference API request was performed. Actual account permission verification and the decisive ChatGPT Events test remain blocked on Platform authorization. No product limitation on event-triggered continuation has been demonstrated.

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

Official tunnel-client v0.0.15 downloaded from OpenAI. Runtime/profile inventory found no suitable bridge setup. Existing unrelated Local Browser Bridge process was neither reused nor modified. Official remote inventory returned `admin key is required`.

Private operator config, ready server, disposable repository, setup script and acceptance prompt are prepared. Account-side tunnel authorization and ChatGPT plugin connection require the operator. These remain unverified:

- ChatGPT callback verification and actual event delivery.
- Event-triggered read and second programming turn in the original conversation.
- Actual event-run model, host tool confirmations and chat-lifecycle subscription survival.

No evidence yet establishes a product limitation preventing continuation: account setup blocks that test. Synthetic webhook acceptance is never substituted for host execution.
