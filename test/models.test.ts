import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModelCatalog, requireChatGPT } from "../src/models.js";
import { JobManager } from "../src/jobs.js";
import { StateStore } from "../src/store.js";
import { CodexAppServer } from "../src/codex-app-server.js";
import { createHash } from "node:crypto";

const model = (id, efforts, isDefault = false) => ({ id, model: id, displayName: `Test ${id}`, hidden: false, isDefault, defaultReasoningEffort: efforts[0], supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort, description: reasoningEffort })) });
class Fake {
  models = [model("alpha", ["high", "low", "ultra"], true), model("beta", ["medium", "minimal"])];
  auth = "chatgpt";
  listeners = [];
  calls = [];
  turns = [];
  settings = { model: "alpha", effort: "high", modelProvider: "openai" };
  addMessageListener(fn) { this.listeners.push(fn); return () => {}; }
  addExitListener() { return () => {}; }
  async start() {}
  respond() {}
  respondError() {}
  emit(method, params) { this.listeners.forEach(fn => fn({ method, params })); }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === "account/read") return { account: { type: this.auth } };
    if (method === "model/list") return { data: this.models, nextCursor: null };
    if (method === "config/read") return { config: { model: "alpha", model_reasoning_effort: "high" } };
    if (method === "thread/start") {
      this.settings.model = params.model ?? this.settings.model;
      this.settings.effort = params.config?.model_reasoning_effort ?? this.settings.effort;
    }
    if (["thread/start", "thread/resume", "thread/read"].includes(method)) return { thread: { id: "same-thread", turns: this.turns }, ...this.settings, reasoningEffort: this.settings.effort };
    if (method === "turn/start") {
      this.settings = { ...this.settings, ...(params.model ? { model: params.model } : {}), ...(params.effort ? { effort: params.effort } : {}) };
      this.emit("thread/settings/updated", { threadId: params.threadId, threadSettings: this.settings });
      const turn = { id: `turn-${this.turns.length+1}`, status: "completed", items: [] };
      this.turns.push(turn);
      return { turn };
    }
    return {};
  }
}
const fixture = () => {
  const app = new Fake();
  const store = new StateStore(path.join(mkdtempSync(path.join(tmpdir(), "bridge-models-")), "state.json"));
  return { app, store, manager: new JobManager(app, { store }), catalog: new ModelCatalog(app) };
};

test("live catalog refresh, visibility and pagination", async () => {
  const { app, catalog } = fixture();
  assert.equal((await catalog.list()).length, 2);
  app.models.push({ ...model("new", ["max"]), hidden: true, availabilityNux: { message: "catalog hint" } });
  assert.equal((await catalog.list()).at(-1).hidden, true);
  const request = app.request.bind(app);
  app.request = async (method, params) => method === "model/list" ? { data: [app.models[params.cursor ? 1 : 0]], nextCursor: params.cursor ? null : "page-two" } : request(method, params);
  assert.equal((await catalog.list()).length, 2);
});

test("valid/invalid models, efforts, dynamic minimum/maximum and defaults", async () => {
  const { catalog, app } = fixture();
  assert.deepEqual(await catalog.resolve({}), {});
  assert.deepEqual(await catalog.resolve({ model: "default" }), { model: "alpha", reasoning_effort: "high" });
  assert.deepEqual(await catalog.resolve({ model: "Test beta" }), { model: "beta", reasoning_effort: "medium" });
  assert.equal((await catalog.resolve({ model: "alpha", reasoning_effort: "minimum" })).reasoning_effort, "low");
  assert.equal((await catalog.resolve({ model: "alpha", reasoning_effort: "maximum" })).reasoning_effort, "ultra");
  assert.equal((await catalog.resolve({ model: "beta", reasoning_effort: "minimum" })).reasoning_effort, "minimal");
  await assert.rejects(catalog.resolve({ model: "not-advertised" }), /Unsupported Codex model/);
  await assert.rejects(catalog.resolve({ model: "beta", reasoning_effort: "ultra" }), /Unsupported reasoning/);
  assert.deepEqual(await catalog.resolve({ reasoning_effort: "low" }), { reasoning_effort: "low" });
  app.models[0].displayName = "GPT-N-Alpha";
  assert.equal((await catalog.resolve({ model: "Alpha" })).model, "alpha");
  app.models.push({ ...model("alpha-next", ["high"]), displayName: "GPT-Next-Alpha" });
  await assert.rejects(catalog.resolve({ model: "Alpha" }), /Unsupported Codex model/);
});

test("child cannot inherit inference/tunnel credentials", async () => {
  const child = new CodexAppServer({ command: process.execPath,
    commandArgs: [path.resolve("test/fixtures/fake-app-server.mjs")],
    spawnOptions: { env: { ...process.env, OPENAI_API_KEY: "synthetic", CONTROL_PLANE_API_KEY: "synthetic", BRIDGE_SECRET: "synthetic", BRIDGE_TEST_NORMAL: "retained" } } });
  try {
    await child.start();
    assert.deepEqual(await child.request("environmentSafety"), { hasInferenceKey: false, hasTunnelKey: false, hasSecret: false, normalValue: "retained" });
  } finally { await child.stop(); }
});

test("reject API auth before thread/turn, including auth change after create", async () => {
  const { app, manager } = fixture();
  app.auth = "apiKey";
  await assert.rejects(manager.create(process.cwd()), /API inference is prohibited/);
  assert.equal(app.calls.some(c => c.method === "thread/start"), false);
  app.auth = "chatgpt";
  const task = await manager.create(process.cwd());
  app.auth = "apiKey";
  await assert.rejects(manager.submit(task.job_id, "hello", "one"), /API inference is prohibited/);
  assert.equal(app.turns.length, 0);
  await assert.rejects(requireChatGPT(app));
});

test("per-turn switch, exact idempotency, actual settings, no rejected work, durable evidence", async () => {
  const { app, store, manager } = fixture();
  const task = await manager.create(process.cwd(), { model: "alpha", reasoning_effort: "maximum" });
  assert.equal(manager.get(task.job_id).thread_settings.reasoning_effort, "ultra");
  await assert.rejects(manager.submit(task.job_id, "hello", "bad", undefined, { model: "beta", reasoning_effort: "ultra" }));
  assert.equal(app.turns.length, 0);
  assert.equal(manager.get(task.job_id).turn_count, 0);
  await manager.submit(task.job_id, "first", "one", undefined, { model: "alpha", reasoning_effort: "minimum" });
  await manager.submit(task.job_id, "first", "one", 0, { model: "alpha", reasoning_effort: "minimum" });
  await assert.rejects(manager.submit(task.job_id, "first", "one", undefined, { model: "beta" }), /different prompt or model/);
  await manager.submit(task.job_id, "second", "two", undefined, { model: "beta", reasoning_effort: "maximum" });
  const state = manager.get(task.job_id);
  assert.equal(state.thread_id, task.thread_id);
  assert.equal(state.model_evidence[0].effective.model, "alpha");
  assert.equal(state.model_evidence[1].effective.model, "beta");
  assert.equal(state.model_evidence[1].effective.reasoning_effort, "medium");
  assert.equal(app.calls.filter(c => c.method === "thread/start").length, 1);
  assert.equal(app.turns.length, 2);
  const restarted = new JobManager(app, { store: new StateStore(store.filePath) });
  assert.deepEqual(restarted.get(task.job_id).model_evidence, state.model_evidence);
  await restarted.submit(task.job_id, "default inherited", "three");
  assert.equal(app.calls.filter(c => c.method === "turn/start").at(-1).params.model, undefined);
  await restarted.submit(task.job_id, '["hello","alpha","low"]', "collision");
  await assert.rejects(restarted.submit(task.job_id, "hello", "collision", undefined, { model: "alpha", reasoning_effort: "low" }), /different prompt or model/);
  const disk = new StateStore(store.filePath);
  const jobs = disk.load();
  jobs[0].requests.legacy = { hash: createHash("sha256").update("legacy prompt").digest("hex"), turn_id: "turn-1" };
  disk.save(jobs);
  const legacy = new JobManager(app, { store: new StateStore(store.filePath) });
  assert.equal((await legacy.submit(task.job_id, "legacy prompt", "legacy")).turn_id, "turn-1");
  await assert.rejects(legacy.submit(task.job_id, "legacy prompt", "legacy", undefined, { model: "alpha" }), /different prompt or model/);
});
