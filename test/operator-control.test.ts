import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { startOperatorControl } from "../src/operator-control.js";

test("operator control is local, authenticated and dispatches exact actions", async (t) => {
  const token = "a".repeat(64);
  let stopped = 0;
  const calls: unknown[] = [];
  const jobs = {
    wakeStatus() { return { service: "blocked", pending: 0 }; },
    setWakePaused() { return 0; },
    get(task: string, options: unknown) {
      calls.push(["inspect", task, options]);
      return { status: "ready", revision: 3, task_id: task };
    },
    async respondApproval(task: string, id: string | number, decision: unknown) {
      calls.push(["approve", task, id, decision]);
      return { status: "running", revision: 4, task_id: task };
    },
    async respondInput(task: string, id: string | number, answers: unknown) {
      calls.push(["input", task, id, answers]);
      return { status: "running", revision: 5, task_id: task };
    },
  } as unknown as Parameters<typeof startOperatorControl>[0];
  const control = await startOperatorControl(jobs, {
    port: 0,
    token,
    shutdown: async () => {
      stopped += 1;
    },
  });
  t.after(async () => control.close());

  const base = "http://127.0.0.1:" + control.port;
  const auth = { Authorization: "Bearer " + token };

  let response = await fetch(base + "/status");
  assert.equal(response.status, 401);

  response = await fetch(base + "/status", {
    headers: { ...auth, Origin: "https://example.com" },
  });
  assert.equal(response.status, 403);

  response = await fetch(base + "/status", { headers: auth });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { operator_control: boolean }).operator_control, true);

  const post = (body: unknown) =>
    fetch(base + "/control", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  response = await post({ command: "inspect", task_id: "task-1" });
  assert.equal(response.status, 200);
  await response.json();

  response = await post({
    command: "approve",
    task_id: "task-1",
    request_id: 7,
    decision: "accept",
  });
  assert.equal(response.status, 200);
  await response.json();

  response = await post({
    command: "input",
    task_id: "task-1",
    request_id: "question-1",
    answers: { answer: ["yes"] },
  });
  assert.equal(response.status, 200);
  await response.json();

  assert.deepEqual(calls, [
    ["inspect", "task-1", { detail: "debug" }],
    ["approve", "task-1", 7, "accept"],
    ["input", "task-1", "question-1", { answer: ["yes"] }],
  ]);
  response = await post({ command: "stop" });
  assert.equal(response.status, 202);
  await response.json();
  await delay(25);
  assert.equal(stopped, 1);
});
