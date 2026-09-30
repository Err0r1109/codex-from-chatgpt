# User opt-in contract

Codex MCP Bridge is **USER-OPT-IN ONLY**.

ChatGPT must not invoke any Codex MCP Bridge tool merely because a task involves programming, Codex appears better suited, the task is long/complex, delegation would be convenient, PC access is useful, or Codex was authorized for a previous task.

Authorization exists only when the user explicitly instructs ChatGPT to use Codex for the current task.

## Scope

Explicit examples that authorize the current task:

- "Use Codex."
- "Do it with Codex."
- "Use the Codex MCP Bridge."
- "Have Codex work on this."
- "Continue this task using Codex."

Mere mention, discussion, suggestion, hypothetical language, or a question about Codex is not authorization.

Once explicit opt-in is present, it covers the complete resulting Codex task: create/attach, submit, wait/get, additional turns, testing, debugging and corrections needed to finish that same objective. No additional opt-in prompt is required between those steps.

Authorization ends when the task completes or is stopped, when the user moves to a new objective that is not clearly part of the same assignment, or when a new ChatGPT conversation begins without fresh explicit opt-in.

## Acceptance cases

| User message | Result |
| --- | --- |
| "Build me an Android game." | **NOT AUTHORIZED** |
| "Would Codex be good for building this Android game?" | **NOT AUTHORIZED** |
| "We could probably use Codex for this." | **NOT AUTHORIZED** |
| "Use Codex to build this Android game." | **AUTHORIZED** for that task |
| Follow-up turns/testing/corrections for the explicitly authorized game task | **AUTHORIZED** without another opt-in |
| After that task ends: "Now make me another game." | **NOT AUTHORIZED** until the user explicitly opts in again |

## Enforcement boundary and audit

The primary protection is the MCP/server/tool contract injected into the model context. The server cannot cryptographically verify the real ChatGPT conversation because MCP does not provide a trusted copy of the user's message.

`codex_task_create` and `codex_task_attach` therefore accept an optional `authorization_basis` (maximum 500 characters), intended as a brief excerpt or paraphrase of the explicit user instruction. A created/attached task persists an audit record:

- `user_authorized: true`
- `basis: <excerpt or null>`
- `recorded_at`
- `source: client-attested-explicit-user-opt-in`

This is audit/debug evidence only. It is **not** a cryptographic authorization boundary and must never be described as one. The field remains optional for compatibility with older clients; omission does not weaken or replace the model-facing opt-in contract.

ChatGPT permission settings remain unchanged. Full Access can remain enabled after explicit opt-in so the assistant can autonomously complete that authorized Codex task.
