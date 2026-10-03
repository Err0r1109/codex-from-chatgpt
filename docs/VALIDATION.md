# Validation record

## User-opt-in invocation contract, 2026-09-30

Codex MCP Bridge is now explicitly **USER-OPT-IN ONLY** at the model-facing boundary. The MCP server instructions and every advertised Codex tool description begin with the same requirement: the assistant must not invoke Codex from inferred usefulness and may use it only when the user explicitly instructed it to use Codex for the current task. The create/attach descriptions add the stronger rule that a coding request, mention, discussion, suggestion, or question about Codex is not authorization.

The server instructions encode the acceptance cases verbatim: “Build me an Android game.”, “Would Codex be good for building this Android game?”, and “We could probably use Codex for this.” are NOT AUTHORIZED; “Use Codex to build this Android game.” is AUTHORIZED for that task. Once opted in, create/attach, submit, wait/get, further turns, testing and corrections for that same task require no new opt-in. After that task ends, “Now make me another game.” is not authorized without a fresh explicit Codex instruction.

`codex_task_create` and `codex_task_attach` accept optional `authorization_basis` audit text (maximum 500 characters). New tasks persist `user_authorized: true`, the basis or null, timestamp, and source `client-attested-explicit-user-opt-in`. This is intentionally documented as client-attested audit/debug evidence, not a cryptographic authorization boundary; the MCP server does not receive a trusted copy of the real conversation. Existing clients remain compatible because the audit excerpt is optional.

ChatGPT permission settings were not changed. The policy preserves full task autonomy after explicit opt-in and adds no per-turn confirmation gate.

Validation on the clean policy worktree passed TypeScript typecheck and build. The complete wrapper suite reported **91 tests: 90 passed, zero failed, one optional real-App-Server handshake skipped**. New coverage checks all six authorization acceptance cases, verifies that every advertised Codex tool is wired through the opt-in description prefix, and confirms that the client-attested authorization audit persists across a subsequent turn without requiring another authorization basis.

The clean build was deployed to the installed bridge without enabling the unfinished browser-wake worktree. After supervised restart, bridge and official tunnel both returned ready. A live MCP client negotiated protocol `2026-07-28`: all eight advertised tool descriptions began with the exact `EXPLICIT USER OPT-IN REQUIRED` prefix, create/attach exposed the optional `authorization_basis` schema, and `getInstructions()` returned the full opt-in contract and acceptance examples. No Codex task or model turn was invoked for this policy deployment.

The ChatGPT development-plugin metadata was also updated: its app description now starts `USER-OPT-IN ONLY` and states that a coding request or mere Codex mention is not authorization. The plugin permission remained **Allow all tools**; no permission setting was changed. `Refresh tools` completed successfully, and the Personal plugin directory displayed the new description.


## Existing-thread attach and configurable development roots

The bridge now lists bounded existing-thread metadata through `thread/list` with `useStateDbOnly: true`, filtering cwd through canonical authorized-root validation. `codex_task_attach` reads the exact requested thread and complete turn status, accepts only terminal history, persists ownership without starting inference, and preserves prior history for a subsequent same-thread resume. Historical count is separate from bridge `turn_count`. Configure multiple operator-owned roots with JSON `CODEX_WORKSPACE_ROOTS`; the single `CODEX_WORKSPACE_ROOT` remains the compatibility fallback.

TypeScript typecheck, build and `git diff --check` passed. The full suite reported **86 tests: 85 passed, zero failed, one optional real-App-Server handshake skipped**. Coverage includes bounded/paginated thread listing with unauthorized-cwd filtering, completed-thread attach with zero bridge-managed historical turns, explicit same-thread `thread/resume` before the first attached follow-up turn, active/outside-root rejection, duplicate ownership protection, model/provider inheritance, multiple authorized roots, and junction/symlink escape rejection.

Live no-inference attach acceptance also passed against an older existing Codex conversation: thread `01a0ef41-d055-7cd3-93b1-bbe6d84df93d` was attached as task `ab519ef6-8742-4e44-bb08-255b8cd7b78a`, status `ready`, revision 1, with `historical_turn_count: 3` and bridge-managed `turn_count: 0`. The inherited thread settings came from `thread/read` as `gpt-6-sol` / `low` / provider `openai`. No new Codex turn was started for this live attach check; the subsequent exact-thread `thread/resume` behavior is covered by the passing integration-style fixture test.

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

Bridge version 0.5.2 hardens the Work fallback. `codex_task_wait(task_id, since_revision, timeout_ms?)` now registers an in-process waiter instead of polling, defaults to 30 seconds, allows 100 ms through 45 seconds, wakes all simultaneous waiters on supervisory revision changes, and returns `wait_timed_out: true` without advancing task revision when nothing changes. A ready task at the same revision correctly times out; approval/input/terminal states return immediately. MCP Events remain unchanged and preferred when the host eventually exposes `events/subscribe`.

The Windows Codex runtime resolver also no longer blindly trusts a stale versioned `CODEX_BIN`. A valid custom executable remains authoritative; official versioned paths are reconciled against the current `CODEX_CLI_PATH` recorded by the local official Codex configuration, with a constrained fallback to complete runtimes under `%LOCALAPPDATA%\OpenAI\Codex\bin`. Multiple complete candidates without a current configuration fail closed.

TypeScript typecheck/build passed. The full wrapper suite passed **81 tests: 80 passed, zero failed, one optional real-App-Server handshake skipped**. Coverage includes timeout without revision mutation, revision wakeup, simultaneous waiters, attention-state wakeup, timeout/revision validation, stale official Codex runtime resolution, custom executable preservation and ambiguous-runtime rejection.

### Live ChatGPT Work fallback acceptance, 2026-09-30

After refreshing the developer-mode plugin tools, a new ChatGPT Work run used the real `codex_task_wait` tool end-to-end with no user message between Codex turns. Work selected `gpt-6-luna` / `low`, created task `22cb2eeb-aeab-4153-8e59-16003fbe67ca` and thread `01a0f25a-525d-7610-8c4d-7e4670781d40`, submitted turn `01a0f25a-9a9e-70f0-9a95-fdc6a58727ea`, waited through the bridge, reviewed its completion, and automatically submitted turn `01a0f25b-c599-7c50-a840-d1a40cfb439b` on the same thread. The final bridge state is `completed`, revision 22, `turn_count: 2`, with no recovery required and no duplicate submission.

The first turn wrote marker `PRJWNX` plus LF to `phase-one.txt` and verified the 15-second shell wait. The second turn preserved that file, wrote `PRJWNX-SECOND` plus LF to `phase-two.txt`, verified both files after a 10-second wait, and exited 0. Independent filesystem read-back confirmed both exact contents. Requested/resolved model evidence is `gpt-6-luna` / `low` for both turns; `effective` runtime evidence remained null, so the validation does not claim an independently attested effective model.

This acceptance proves the practical fallback goal in Work: while one run remains active, ChatGPT can submit Codex work, wait without backend polling, review the result, submit another turn and finish without the user relaying prompts/results or sending an intermediate message. It does **not** prove out-of-run asynchronous wake-up; MCP Events remain the preferred path once the ChatGPT host exposes `events/subscribe`.

### Live normal-Chat fallback acceptance, 2026-09-30

The same fallback was then exercised in **normal Chat mode**, not Work. A single Chat response selected `gpt-6-luna` / `low`, created task `84507f8c-0f14-4f92-92f8-e5de5843b5ce`, and completed exactly two Codex turns on shared thread `01a0f273-7a60-7810-9028-49ad42e4fc8c` with no user message between them. Turn IDs were `01a0f273-a0cf-77a0-96e6-02f1576377a3` and `01a0f274-6bd2-76d2-ae50-1229b15e65be`; final state was `completed`, revision 20, `turn_count: 2`, with no approval, input or recovery required.

Turn one wrote exactly `CHATOK` plus LF to `chat-one.txt` after a real 8-second shell wait. Chat used `codex_task_wait`, reviewed the first completion with one `codex_task_get`, and automatically submitted turn two on the same task/thread. Turn two preserved the first file, wrote exactly `CHATOK-SECOND` plus LF to `chat-two.txt`, waited 5 seconds, and verified both files byte-for-byte with exit code 0. Independent filesystem read-back confirmed both exact contents.

Therefore **normal Chat is the preferred fallback orchestration surface**. Work is not required for the no-copy/paste multi-turn loop and should be reserved only for cases where a substantially longer-lived orchestration run is desirable. The limitation remains only that the Chat response must stay active; there is still no out-of-run wake-up until host-side MCP Events subscription becomes available.

## Browser wake sentinel fallback, 2026-09-30

The browser-wake fallback is implemented as a deterministic local service with no LLM and no separately billed model API. A Codex turn can persist a browser wake intent atomically with the task transition; after Codex reaches completion/attention state, the supervised sender uses the existing Local Browser Bridge MCP client to locate the bound ChatGPT conversation and post a fixed wake message. The wake message instructs ChatGPT to read `codex_task_get` and explicitly states that it is not new Codex authorization. MCP Events remain preferred when host-side subscription becomes available; `codex_task_wait` remains a short-run fallback.

The outbox persists wake state, stage, retries, deterministic action IDs, LBB receipts, owned-tab provenance, canonical conversation binding and deadline. Unknown browser effects are reconciled through `browser_operation` and are never blindly replayed. The sender fails closed on ambiguous search results, nonempty user drafts, incomplete semantic evidence, wrong conversation URL, busy ChatGPT state, lost provenance, browser-session changes, stop/disarm/newer-turn races, and uncertain send outcomes. Chrome/LBB unavailability leaves delivery pending without consuming the bounded dispatch-attempt budget. Browser wake is disabled by default and requires operator configuration; pause/resume/status are exposed only through the loopback authenticated operator control.

The same change adds operator-owned `workspacePolicy: explicit` and `executionPolicy: danger-full-access`. Explicit workspace mode accepts a canonical existing local project directory without maintaining a project allowlist while excluding the bridge's private state directory and its ancestors/descendants. Danger-full-access maps documented App Server thread/resume/turn fields to full access with `approvalPolicy: never`; it is local configuration and does not alter ChatGPT plugin permissions or weaken the USER-OPT-IN invocation contract.

Validation evidence:

- TypeScript typecheck: passed.
- Build: passed.
- Dedicated browser-wake suite: **43/43 passed**.
- Complete wrapper suite: **151 tests: 150 passed, zero failed, one optional real-App-Server handshake skipped**.
- `git diff --check`: passed.
- Live read-only Local Browser Bridge MCP connection from the new `StdioLbbClient`: `connected=true`, `mode=action`, build mismatch false, 21 public tools.
- Production state was checked before deployment work: state version 2 and no nonterminal Codex tasks.
- No Codex worker/model turn was invoked to implement or validate this sentinel change.

This section originally recorded deterministic/unit/integration readiness only. A real Codex-backed direct-binding acceptance was later completed on 2026-10-03 and is documented below.

### Live browser-wake acceptance, 2026-09-30

A live synthetic ChatGPT conversation validated the browser wake path end-to-end without invoking Codex. The target conversation was preconfigured to reply exactly `WAKEOK` to a later automated `[Codex Bridge wake ...]` user message and to use no tools. The production browser-wake code was then run against a temporary durable StateStore and the real Local Browser Bridge MCP transport.

The first `browser_open_tab` returned LBB `AMBIGUOUS_OUTCOME`; the sentinel correctly persisted the uncertain action and did not retry blindly. On the next cycle it reconciled the same deterministic client request through `browser_operation`, recovered the executed tab creation and provenance, verified the canonical conversation URL, proved the composer empty, appended the exact fixed wake envelope, reprobed for concurrent edits, submitted once, verified the rendered user message and empty composer, and persisted `state=delivered`, `stage=verified`. Later ticks performed no further send.

ChatGPT then started a fresh run from that delivered browser message and rendered exactly `WAKEOK` as instructed. This establishes the local sleep/wake mechanism independently of a long-lived Sol response: a deterministic local process can post a new message into a completed ChatGPT conversation and trigger a new model run. No Codex model turn or API inference was consumed by this acceptance.

This Codex-backed acceptance was subsequently run after a fresh explicit user instruction on 2026-10-03; the final results are recorded below under **Real Codex-backed direct-binding acceptance**.

## Direct conversation binding after Codex-backed marker failure, 2026-10-03

The first real Codex-backed sleep/wake acceptance exposed a primary-binding flaw. Task `20f8d278-5bec-48a5-8e08-e767fe54482a` completed its first real Codex turn and atomically created the browser wake, but the wake remained `pending/queued` with `conversation_url: null` and detail `Marker not indexed yet` across retries. No append or send occurred. This correctly failed closed, but demonstrated that ChatGPT Global Search indexing is not reliable enough to be the autonomous wake's primary conversation locator.

The binding contract was changed accordingly. `codex_task_create` and `codex_task_attach` now accept an optional canonical CURRENT ChatGPT `conversation_url` or equivalent `conversation_id` and persist the normalized URL/ID before any Codex turn. MCP callback context also captures OpenAI's anonymized `openai/session` value when present; it is persisted only as same-conversation continuity evidence and is not treated as a navigable URL. A later submit from a different nonempty host-session identifier fails closed.

Browser wake intents now persist `binding_source`. A `direct` binding opens the exact canonical URL and requires sentinel-owned tab provenance, exact URL readback, idle ChatGPT state, empty-composer proof, verified append and rendered-user-message acceptance, but no longer depends on the binding marker being indexed or rendered. Marker search remains available only when no direct URL exists, and any URL recovered from it remains marker-verified before becoming `binding_source: recovered`. Legacy persisted wakes remain readable and default conservatively to recovered/marker semantics.

The MCP response exposes `wake_binding` and submitted wake evidence with `conversation_url`, `conversation_id`, `binding_source` and a boolean `session_bound` without exposing the raw host session identifier. Server instructions explicitly prohibit ending the ChatGPT response in expectation of autonomous browser wake unless the returned binding is `direct` with a non-null canonical URL; otherwise `codex_task_wait` is the reliable fallback.

Validation after this change:
- TypeScript typecheck: passed.
- Build: passed.
- Direct-binding tests prove persistence before the first Codex turn, URL/ID consistency, host-session mismatch rejection and restart-safe wake state.
- Browser-wake tests prove that a direct URL delivers without any marker proof, while recovered URLs still require marker proof and marker search remains fail-closed.
- Complete wrapper suite: **155 tests: 154 passed, zero failed, one optional real-App-Server handshake skipped**.
- No Codex model turn was used to implement this correction.

### Live direct-binding acceptance, 2026-10-03

The corrected primary path was exercised against the real Local Browser Bridge and a real completed ChatGPT synthetic conversation without invoking Codex. The wake was persisted with `binding_source: direct` and canonical URL `https://chatgpt.com/c/6abd5175-5e3c-83eb-b482-8cf918a4d31d`. Its newly generated marker `CW-BIND-ff0e8dd2-f3d7-44fe-98d1-17a9b238fdca` was not the marker registered in that conversation beforehand.

The first tab-open result was again ambiguous, and the existing deterministic receipt reconciliation recovered it safely. The final action sequence was `open -> activate -> probe -> append -> probe -> send -> probe`: there was **no** `search`, `search_type` or `result` action. The wake reached `state=delivered`, `stage=verified`, and the target ChatGPT conversation rendered the new wake as a user message and started a fresh run that replied exactly `WAKEOK`. This proves the direct path no longer depends on ChatGPT search indexing or marker discovery.

A live MCP wire check after deployment confirmed that `codex_task_create` exposes `conversation_url` and `conversation_id`, `codex_turn_submit` can inherit/accept the same fields, and server instructions require `binding_source=direct` plus non-null `conversation_url` before ChatGPT may end its response expecting autonomous browser wake. The plugin tools were refreshed in ChatGPT and the permission remained **Allow all tools**.

The failed marker-only acceptance wake was cancelled while the bridge was stopped so its in-memory manager could not overwrite the cancellation. Production was then restarted with bridge, supervisor and official tunnel ready; browser-wake service is running and the obsolete wake is durably `cancelled`.

## Real Codex-backed direct-binding acceptance, 2026-10-03

A fresh explicit user instruction authorized Codex specifically for this final acceptance. Because the Android ChatGPT client did not expose the canonical URL of the initiating conversation, the test used a dedicated synthetic ChatGPT conversation as the wake target; its canonical URL was known directly before the Codex task was created. The target was instructed only to reply exactly `DIRECTWAKEOK` to later `[Codex Bridge wake ...]` messages and to use no tools.

Task `619b9812-84a9-4f28-a6b6-96f2697eba83` was created in disposable workspace `C:\Codex\Experiments\direct-wake-final-20261003` with model `gpt-6-luna`, reasoning effort `low`, canonical conversation `https://chatgpt.com/c/6ac05c6d-e248-83ed-828d-3b307eb86929`, and returned `binding_source: direct`, `session_bound: true`. No `codex_task_wait` call was used for either turn.

Turn 1 (`01a0ff6a-1d29-7500-9c87-f711c17989a1`) waited about 15 seconds, created `direct-wake-result.txt`, and verified the exact bytes `DIRECT-CODEX-WAKE-OK\n`. On completion, durable wake `wake_05ad7d27-3ffd-4e04-b0d9-b6b7d9568394` reached `state=delivered`, `stage=verified`, `binding_source=direct`. Its action sequence was `open,activate,probe,append,probe,send,probe`; there was no `search`, `search_type` or `result` action. The target ChatGPT conversation rendered the wake as a user message and started a fresh run that replied exactly `DIRECTWAKEOK`.

A second turn was then submitted on the **same Codex thread** `01a0ff69-e6ac-7c63-a4bc-a3fa05110379` without changing the persisted binding. Turn 2 (`01a0ff6c-021e-7ba0-bac0-6f8d7d9415f2`) waited about 8 seconds, created `direct-wake-second.txt`, and verified the exact bytes `DIRECT-CODEX-WAKE-SECOND\n` while preserving the first file. Its wake `wake_5402e818-8f9a-4553-b770-634d076b3125` also reached `delivered/verified`, retained the same canonical direct binding, and used action sequence `activate,probe,append,probe,send,probe` with no search actions. The same ChatGPT conversation rendered the second wake and started another fresh run that again replied exactly `DIRECTWAKEOK`.

Independent byte checks after both turns reported:
- `direct-wake-result.txt`: 21 bytes, hex `4449524543542d434f4445582d57414b452d4f4b0a`.
- `direct-wake-second.txt`: 25 bytes, hex `4449524543542d434f4445582d57414b452d5345434f4e440a`.

The task finished with `turn_count: 2`, `status: completed`, no recovery requirement, and was then explicitly stopped so its Codex authorization cannot be reused. This acceptance proves that a real Codex completion can generate a durable browser wake against a pre-bound canonical ChatGPT conversation, that the wake can trigger a fresh ChatGPT run without marker discovery or Global Search, and that the same direct binding persists correctly across a second turn and second wake.

One boundary remains intentional: the synthetic wake target did not itself call Codex after waking, because that separate conversation did not contain a fresh explicit user opt-in for Codex. The test therefore validates the complete Codex -> durable direct wake -> fresh ChatGPT run path and repeated same-thread direct wakes without fabricating cross-conversation authorization.
