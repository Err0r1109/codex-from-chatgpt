# Validation record

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
