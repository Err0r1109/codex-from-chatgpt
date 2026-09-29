import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodexAppServer } from "../src/codex-app-server.js";
import { ModelCatalog } from "../src/models.js";
import { JobManager } from "../src/jobs.js";
import { StateStore } from "../src/store.js";
const workspace = process.argv[2];
if (!workspace) throw Error("Disposable workspace argument required");
process.env.CODEX_WORKSPACE_ROOT = path.dirname(workspace);
const dir = mkdtempSync(path.join(tmpdir(), "bridge-real-recovery-"));
const state = path.join(dir, "state.json");
const report = {};
let a = new CodexAppServer({ spawnOptions: { windowsHide: true } });
try {
  await a.start();
  await new ModelCatalog(a).list();
  let m = new JobManager(a, { store: new StateStore(state) });
  const task = await m.create(workspace);
  await m.submit(
    task.job_id,
    "Wait for 90 seconds using the shell. Do not edit any files.",
    "recovery-first",
  );
  report.before = m.get(task.job_id);
  await a.stop();
  a = new CodexAppServer({ spawnOptions: { windowsHide: true } });
  const calls = [];
  const req = a.request.bind(a);
  a.request = async (method, params) => {
    calls.push(method);
    return req(method, params);
  };
  m = new JobManager(a, { store: new StateStore(state) });
  await m.initialize();
  report.after = m.get(task.job_id, { detail: "debug" });
  report.calls = calls;
  assert.equal(report.after.thread_id, report.before.thread_id);
  assert.ok(calls.includes("thread/read"));
  assert.ok(!calls.includes("turn/start"));
  assert.ok(
    ["interrupted", "recovery_required", "completed", "running"].includes(
      report.after.status,
    ),
  );
  if (report.after.status === "running") await m.interrupt(task.job_id);
  report.passed = true;
  console.log(JSON.stringify(report));
} finally {
  await a.stop();
  writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  console.log("REPORT " + path.join(dir, "report.json"));
}
