import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { CodexAppServer } from "../src/codex-app-server.js";
import { ModelCatalog } from "../src/models.js";
import { JobManager } from "../src/jobs.js";
import { StateStore } from "../src/store.js";
import { EventService } from "../src/events.js";
import { randomBytes } from "node:crypto";

const root =
  process.env.CODEX_BRIDGE_TEST_ROOT ??
  path.join(os.homedir(), "codex-bridge-disposable");
mkdirSync(root, { recursive: true });
const workspace = mkdtempSync(path.join(root, "two-turn-"));
const stateDir = mkdtempSync(path.join(os.tmpdir(), "bridge-real-state-"));
process.env.CODEX_WORKSPACE_ROOT = root;
writeFileSync(
  path.join(workspace, "package.json"),
  JSON.stringify({
    name: "bridge-disposable",
    private: true,
    type: "module",
    scripts: { test: "node --test" },
  }),
);
writeFileSync(
  path.join(workspace, "math.js"),
  "export function add(a,b) { return a-b; }\n",
);
writeFileSync(
  path.join(workspace, "math.test.js"),
  "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {add} from './math.js'; test('add',()=>assert.equal(add(2,3),5));\n",
);
execFileSync("git", ["init", workspace], { stdio: "pipe" });
execFileSync("git", ["-C", workspace, "add", "."]);
execFileSync(
  "git",
  [
    "-C",
    workspace,
    "-c",
    "user.name=Bridge test",
    "-c",
    "user.email=bridge-test@localhost",
    "commit",
    "-m",
    "Disposable fixture",
  ],
  { stdio: "pipe" },
);
const app = new CodexAppServer({
  rpcTimeoutMs: 30000,
  spawnOptions: { windowsHide: true },
});
const calls = [];
const request = app.request.bind(app);
app.request = async (method, params) => {
  const result = await request(method, params);
  calls.push({
    method,
    thread_id: params?.threadId ?? result?.thread?.id,
    turn_id: params?.turnId ?? result?.turn?.id,
    model: result?.model,
  });
  return result;
};
const report = {
  workspace,
  state_file: path.join(stateDir, "state.json"),
  calls,
};
try {
  await app.start();
  const catalog = await new ModelCatalog(app).list();
  report.catalog = catalog;
  const available = catalog.filter(m => !m.hidden);
  assert.ok(available.length >= 2);
  const combinations = available.slice(0, 2).map(m => ({ model: m.model, reasoning_effort: "minimum" }));
  report.combinations = combinations;
  const store = new StateStore(report.state_file);
  const manager = new JobManager(app, { store, turnTimeoutMs: 300000 });
  await manager.initialize();
  const task = await manager.create(workspace);
  report.task = task;
  console.log(JSON.stringify({ stage: "created", ...task, workspace }));
  const events = new EventService(
    store,
    (id) => manager.get(id),
    async (_url, body) => ({
      status: 200,
      body: JSON.stringify({ challenge: JSON.parse(body).challenge }),
    }),
  );
  await events.subscribe({
    name: "codex.task_changed",
    arguments: { task_id: task.job_id },
    delivery: {
      mode: "webhook",
      url: "https://example.com/test-only",
      secret: "whsec_" + randomBytes(32).toString("base64"),
    },
  });
  async function wait() {
    const start = Date.now();
    while (Date.now() - start < 300000) {
      const s = manager.get(task.job_id, { detail: "debug" });
      if (
        [
          "completed",
          "failed",
          "recovery_required",
          "awaiting_approval",
          "interrupted",
        ].includes(s.status)
      )
        return s;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw Error("Integration timeout");
  }
  await manager.submit(
    task.job_id,
    "Fix add in math.js so the existing test passes. Use login:false for shell calls to avoid a local PowerShell profile changing cwd. Run node --test with the installed Node executable. Change only this disposable repository. Do not commit. Report the test exit code.",
    "real-first",
    task.revision,
    combinations[0],
  );
  report.first = await wait();
  console.log(JSON.stringify({ stage: "first", ...report.first }));
  assert.equal(report.first.status, "completed");
  assert.match(readFileSync(path.join(workspace, "math.js"), "utf8"), /\+/);
  await manager.submit(
    task.job_id,
    "Add a multiply(a,b) export to math.js. Add a separate test asserting multiply(6,7) equals 42, retaining the add test. Run node --test again. Change only this repository. Do not commit.",
    "real-second",
    report.first.revision,
    combinations[1],
  );
  report.second = await wait();
  console.log(JSON.stringify({ stage: "second", ...report.second }));
  assert.equal(report.second.status, "completed");
  assert.equal(report.first.thread_id, report.second.thread_id);
  assert.notEqual(report.first.turn_id, report.second.turn_id);
  const validation = execFileSync(process.execPath, ["--test"], {
    cwd: workspace,
    encoding: "utf8",
  });
  for (const [i, ev] of report.second.model_evidence.entries()) {
    assert.equal(ev.effective?.model, combinations[i].model);
    assert.equal(ev.effective?.reasoning_effort, ev.resolved.reasoning_effort);
    assert.equal(ev.effective?.source, "thread/settings/updated");
  }
  report.independent_test = { exit_code: 0, output: validation };
  assert.equal(calls.filter((c) => c.method === "thread/start").length, 1);
  report.events = store.eventState().outbox.map((d) => d.event);
  await manager.submit(
    task.job_id,
    "Use the shell to wait for 90 seconds and then report done. Make no changes.",
    "real-interrupt",
    report.second.revision,
  );
  await new Promise((r) => setTimeout(r, 1500));
  await manager.interrupt(task.job_id);
  report.interrupted = await wait();
  assert.equal(report.interrupted.status, "interrupted");
  console.log(JSON.stringify({ stage: "interrupt", ...report.interrupted }));
  await app.stop();
  const recoveredApp = new CodexAppServer({
    spawnOptions: { windowsHide: true },
  });
  const recovered = new JobManager(recoveredApp, {
    store: new StateStore(report.state_file),
  });
  try {
    await recovered.initialize();
    report.restart = recovered.get(task.job_id);
    assert.equal(report.restart.thread_id, task.thread_id);
    assert.equal(report.restart.stopped, true);
  } finally {
    await recoveredApp.stop();
  }
  report.passed = true;
} catch (e) {
  report.error = e.stack;
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  await app.stop();
  const target = path.join(stateDir, "integration-report.json");
  writeFileSync(target, JSON.stringify(report, null, 2));
  console.log("REPORT " + target);
}
