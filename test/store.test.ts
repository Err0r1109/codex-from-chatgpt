import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import { StateStore } from "../src/store.js";

function stateJob(jobId: string, threadId: string | null) {
  return {
    job_id: jobId,
    thread_id: threadId,
    workspace: process.cwd(),
    turn_id: null,
    status: "completed",
    final_message: null,
    latest_diff: null,
    files_changed: [],
    commands_executed: [],
    error: null,
    updated_at: new Date().toISOString(),
  };
}

test("state store usa escritura atómica y permisos 0600 incluso si el archivo anterior era amplio", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "codex-agent-state-"));
  const file = path.join(directory, "state.json");
  const store = new StateStore(file);
  store.save([stateJob("job-1", "thread-1")]);
  chmodSync(file, 0o644);
  store.save([stateJob("job-1", "thread-1")]);
  if (process.platform === "win32") {
    const acl = execFileSync("icacls.exe", [file], { encoding: "utf8" });
    assert.ok(!acl.includes("(I)"), "State must not inherit public ACLs");
    assert.ok(acl.includes(process.env.USERNAME!));
  } else assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("state ambiguo con job_id o thread_id duplicados se rechaza completo", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "codex-agent-state-"));
  const file = path.join(directory, "state.json");
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      jobs: [stateJob("same", "thread-a"), stateJob("same", "thread-b")],
    }),
  );
  const store = new StateStore(file);
  assert.deepEqual(store.load(), []);
  assert.match(store.getDiagnostic() ?? "", /job_id duplicado/);

  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      jobs: [
        stateJob("job-a", "same-thread"),
        stateJob("job-b", "same-thread"),
      ],
    }),
  );
  assert.deepEqual(store.load(), []);
  assert.match(store.getDiagnostic() ?? "", /thread_id duplicado/);
});

test("version 2 state migrates without inventing historic wake intents", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "codex-agent-state-"));
  const file = path.join(directory, "state.json");
  writeFileSync(file, JSON.stringify({ version: 2, jobs: [stateJob("old-completed", "thread-old")], events: { version: 1, sequence: 0, transitions: {}, subscriptions: [], outbox: [] } }));
  const store = new StateStore(file);
  assert.equal(store.load().length, 1);
  assert.deepEqual(store.wakeIntents(), []);
  store.save(store.load());
  assert.equal(JSON.parse(readFileSync(file, "utf8")).version, 3);
});

test("v2 migration preserves subscriptions, webhook outbox and transition history", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "codex-agent-state-")), "state.json");
  const events = { subscriptions: [{ id: "sub", owner: "fixture", taskId: "old-completed", url: "https://example.com/events", secret: "synthetic-fixture-only", expiresAt: Date.now() + 60000, verifiedUntil: Date.now() + 60000 }],
    transitions: { "old-completed": "historic-transition" }, outbox: [{ subscriptionId: "sub", event: { eventId: "evt", name: "codex.task_changed", timestamp: new Date().toISOString(), cursor: null, data: { task_id: "old-completed", revision: 2, status: "completed", reason: "turn_completed" } }, attempts: 1, nextAttempt: Date.now(), state: "pending" }] };
  writeFileSync(file, JSON.stringify({ version: 2, jobs: [stateJob("old-completed", "thread")], events }));
  const store = new StateStore(file); assert.equal(store.load().length, 1); assert.deepEqual(store.eventState(), events);
  store.updateEvents(() => {}); const restored = new StateStore(file); restored.load();
  assert.deepEqual(restored.eventState(), events); assert.deepEqual(restored.wakeIntents(), []);
});

test("wake outbox corruption fails closed before any writer can overwrite it", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "codex-agent-state-")), "state.json");
  for (const bad of [ { id: "wake_bad" }, { stage: "send-again" }, { deadline: -1 }, { conversation_url: "https://evil.example/" }, { state: "delivered", stage: "queued" } ]) {
    writeFileSync(file, JSON.stringify({ version: 3, jobs: [], events: { subscriptions: [], transitions: {}, outbox: [] }, wakes: [bad] }));
    const store = new StateStore(file); assert.deepEqual(store.load(), []); assert.ok(store.getDiagnostic());
    assert.throws(() => store.save([]), /unreadable/);
  }
});

test("separate approval revisions in the same turn each get their own browser wake", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "codex-agent-state-")), "state.json");
  const store = new StateStore(file);
  const job: any = {
    ...stateJob("approval-task", "approval-thread"),
    turn_id: "approval-turn",
    status: "awaiting_approval",
    revision: 1,
    wake: {
      enabled: true,
      conversation_url: null,
      binding_marker: "CW-BIND-123e4567-e89b-42d3-a456-426614174000",
    },
    requests: {
      request: {
        hash: "fixture",
        hash_version: 3,
        turn_id: "approval-turn",
        wake: "browser",
      },
    },
  };

  store.save([job]);
  assert.deepEqual(store.wakeIntents().map((wake) => wake.revision), [1]);

  job.status = "running";
  job.revision = 2;
  store.save([job]);
  assert.equal(store.wakeIntents()[0]?.state, "cancelled");

  job.status = "awaiting_approval";
  job.revision = 3;
  store.save([job]);
  assert.deepEqual(store.wakeIntents().map((wake) => wake.revision), [1, 3]);
  assert.equal(store.wakeIntents()[1]?.state, "pending");
});
