import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { EventEmitter } from "node:events";
import { createSafeWebhookSend } from "../src/webhook.js";
import { StateStore } from "../src/store.js";
import { JobManager } from "../src/jobs.js";
import { EventService } from "../src/events.js";
import { createBridgeHandler } from "../src/mcp.js";
import {
  publicAddress,
  callbackUrl,
  safeWebhookSend,
  signedPost,
} from "../src/webhook.js";

class Fake {
  listeners = [];
  exits = [];
  requests = [];
  count = 0;
  early = false;
  thread = { id: "thread-1", turns: [] };
  addMessageListener(f) {
    this.listeners.push(f);
    return () => {};
  }
  addExitListener(f) {
    this.exits.push(f);
    return () => {};
  }
  async start() {}
  respond() {}
  respondError() {}
  emit(m) {
    this.listeners.forEach((f) => f(m));
  }
  complete(status = "completed") {
    const turn = { id: `turn-${this.count}`, status, items: [] };
    this.thread.turns.push(turn);
    this.emit({
      method: "turn/completed",
      params: { threadId: "thread-1", turn },
    });
  }
  async request(method, params) {
    this.requests.push({ method, params });
    if (method === "account/read") return { account: { type: "chatgpt" } };
    if (method === "model/list") return { data: [{ id: "fixture", model: "fixture", displayName: "Fixture", hidden: false, isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "default" }], defaultReasoningEffort: "medium" }], nextCursor: null };
    if (method === "config/read") return { config: {} };
    if (
      method === "thread/start" ||
      method === "thread/read" ||
      method === "thread/resume"
    )
      return { thread: this.thread };
    if (method === "turn/start") {
      this.count++;
      if (this.early) this.complete();
      return { turn: { id: `turn-${this.count}`, status: "inProgress" } };
    }
    if (method === "turn/interrupt") {
      this.complete("interrupted");
      return {};
    }
  }
}
function fixture(maxTurns = 8) {
  const store = new StateStore(
    path.join(mkdtempSync(path.join(tmpdir(), "bridge-events-")), "state.json"),
  );
  const fake = new Fake();
  const manager = new JobManager(fake, { store, maxTurns });
  let offset = 0,
    status = 200;
  const posts = [];
  const send = async (url, body, headers) => {
    posts.push({ url, body, headers });
    const value = JSON.parse(body);
    return {
      status,
      body: JSON.stringify(
        value.type === "verification" ? { challenge: value.challenge } : {},
      ),
    };
  };
  const events = new EventService(
    store,
    (id) => manager.get(id),
    send,
    () => Date.now() + offset,
  );
  return {
    store,
    fake,
    manager,
    events,
    posts,
    send,
    clock: () => Date.now() + offset,
    advance: (n) => (offset += n),
    setStatus: (n) => (status = n),
  };
}
function subscription(task_id, ttlMs = 60_000) {
  return {
    name: "codex.task_changed",
    arguments: { task_id },
    delivery: {
      mode: "webhook",
      url: "https://example.com/callback",
      secret: "whsec_" + randomBytes(32).toString("base64"),
    },
    ttlMs,
  };
}

test("callback pins validated address, rechecks DNS and rejects redirects", async () => {
  let address = "8.8.8.8",
    lookups = 0,
    dials = 0;
  const seen = [];
  const resolve = async () => {
    lookups++;
    return [{ address, family: 4 }];
  };
  const dial = (url, options, onResponse) => {
    dials++;
    seen.push({ url, options });
    const req = new EventEmitter();
    req.end = () => {
      options.lookup("example.com", {}, (err, ip) => {
        assert.equal(ip, "8.8.8.8");
      });
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = 302;
        response.resume = () => {};
        onResponse(response);
      });
    };
    req.destroy = (e) => req.emit("error", e);
    return req;
  };
  const send = createSafeWebhookSend(resolve, dial);
  await assert.rejects(
    send("https://example.com/callback", "{}", {}),
    /redirect_blocked/,
  );
  assert.equal(dials, 1);
  assert.equal(seen[0].url.hostname, "example.com");
  assert.equal(seen[0].options.agent, false);
  address = "127.0.0.1";
  await assert.rejects(
    send("https://example.com/callback", "{}", {}),
    /unsafe_address/,
  );
  assert.equal(dials, 1);
  assert.equal(lookups, 2);
  const mixed = createSafeWebhookSend(
    async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
    dial,
  );
  await assert.rejects(
    mixed("https://example.com", "{}", {}),
    /unsafe_address/,
  );
});
test("payload limit and eight-attempt retry bound", async () => {
  const f = fixture();
  const t = await ready(f);
  await f.events.subscribe(subscription(t.job_id, 86400000));
  const sub = f.store.eventState().subscriptions[0];
  await assert.rejects(
    signedPost(sub, "evt_large", { data: "x".repeat(262144) }, f.send),
    /payload_too_large/,
  );
  assert.equal(f.posts.length, 1);
  await f.manager.submit(t.job_id, "work", "r");
  f.fake.complete();
  f.setStatus(503);
  for (let i = 0; i < 8; i++) {
    await f.events.drain();
    f.advance(301000);
  }
  assert.equal(f.store.eventState().outbox[0].attempts, 8);
  assert.equal(f.store.eventState().outbox[0].state, "abandoned");
});
test("concurrent duplicates start one turn; stale event revision cannot start another", async () => {
  const f = fixture();
  const t = await ready(f);
  await Promise.all([
    f.manager.submit(t.job_id, "work", "same-event", t.revision),
    f.manager.submit(t.job_id, "work", "same-event", t.revision),
  ]);
  assert.equal(f.fake.count, 1);
  f.fake.complete();
  await assert.rejects(
    f.manager.submit(t.job_id, "work", "new-id-old-event", t.revision),
    /Stale/,
  );
  assert.equal(f.fake.count, 1);
});
test("uncertain submission never adopts previous completion or replays", async () => {
  const f = fixture();
  const t = await ready(f);
  await f.manager.submit(t.job_id, "first", "r1");
  f.fake.complete();
  const original = f.fake.request.bind(f.fake);
  f.fake.request = async (method, p) => {
    if (method === "turn/start") throw Error("connection lost");
    return original(method, p);
  };
  await assert.rejects(f.manager.submit(t.job_id, "second", "r2"));
  const other = new Fake();
  other.thread = f.fake.thread;
  const restart = new JobManager(other, {
    store: new StateStore(f.store.filePath),
  });
  await restart.initialize();
  assert.equal(restart.get(t.job_id).status, "recovery_required");
  await restart.submit(t.job_id, "second", "r2");
  assert.equal(other.count, 0);
  await assert.rejects(restart.submit(t.job_id, "third", "r3"), /bloqueado/);
});
test("input-required event and exact local reply correlation", async () => {
  const f = fixture();
  const t = await ready(f);
  await f.events.subscribe(subscription(t.job_id));
  await f.manager.submit(t.job_id, "work", "r");
  f.fake.emit({
    id: "q1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "i",
      questions: [{ id: "choice", question: "Which option?" }],
    },
  });
  assert.equal(f.manager.get(t.job_id).status, "input_required");
  assert.equal(
    f.store.eventState().outbox.at(-1).event.data.reason,
    "input_required",
  );
  await assert.rejects(
    f.manager.respondInput(t.job_id, "wrong", { choice: { answers: ["A"] } }),
    /matching/,
  );
  await assert.rejects(
    f.manager.respondInput(t.job_id, "q1", { fake: { answers: ["A"] } }),
    /question/,
  );
  await f.manager.respondInput(t.job_id, "q1", { choice: { answers: ["A"] } });
  assert.equal(f.manager.get(t.job_id).status, "running");
});
test("finite ttl, revocation and limit event", async () => {
  const f = fixture(1);
  const t = await ready(f);
  const p = subscription(t.job_id);
  const s = await f.events.subscribe({ ...p, ttlMs: null });
  assert.ok(s.refreshBefore);
  await assert.rejects(f.events.subscribe({ ...p, ttlMs: -1 }));
  await f.manager.submit(t.job_id, "work", "r");
  f.fake.complete();
  assert.equal(f.manager.get(t.job_id).status, "limit_reached");
  assert.equal(
    f.store.eventState().outbox.at(-1).event.data.reason,
    "limit_reached",
  );
  const revoked = new EventService(
    f.store,
    () => {
      throw Error("access revoked");
    },
    f.send,
  );
  await revoked.drain();
  assert.equal(f.store.eventState().outbox[0].state, "abandoned");
  assert.equal(f.posts.length, 1);
});
async function ready(f) {
  return f.manager.create(process.cwd());
}

test("modern discover, events/list, tools/call and create-subscribe-submit eliminates first-turn race", async () => {
  const f = fixture();
  f.fake.early = true;
  const h = createBridgeHandler(f.manager, f.events);
  async function rpc(method, params = {}) {
    const response = await h.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "Mcp-Method": method,
          ...(params.name ? { "Mcp-Name": params.name } : {}),
          "MCP-Protocol-Version": "2026-07-28",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: {
            ...params,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      }),
    );
    const data = await response.json();
    assert.ok(data.result, JSON.stringify(data));
    return data;
  }
  const discovery = await rpc("server/discover");
  assert.ok(discovery.result, JSON.stringify(discovery));
  assert.deepEqual(discovery.result.supportedVersions, ["2026-07-28"]);
  assert.deepEqual(discovery.result.capabilities.events, {});
  assert.ok(discovery.result.capabilities.tools);
  assert.equal(discovery.result.resultType, "complete");
  assert.equal(
    (await rpc("events/list")).result.events[0].name,
    "codex.task_changed",
  );
  const tools = (await rpc("tools/list")).result.tools;
  assert.deepEqual(tools.map((x) => x.name).sort(), [
    "codex_models_list",
    "codex_task_create",
    "codex_task_get",
    "codex_task_stop",
    "codex_task_wait",
    "codex_turn_submit",
  ]);
  const waitTool = tools.find((x) => x.name === "codex_task_wait");
  assert.equal(waitTool.annotations.readOnlyHint, true);
  assert.equal(waitTool.annotations.idempotentHint, true);
  assert.ok(waitTool.inputSchema.required.includes("since_revision"));
  assert.equal((await rpc("tools/call", { name: "codex_models_list", arguments: {} })).result.structuredContent.models[0].model, "fixture");
  const created = (
    await rpc("tools/call", {
      name: "codex_task_create",
      arguments: { workspace: process.cwd() },
    })
  ).result.structuredContent;
  assert.equal(created.status, "ready");
  assert.equal(f.fake.count, 0);
  const waited = await rpc("tools/call", {
    name: "codex_task_wait",
    arguments: {
      task_id: created.task_id,
      since_revision: created.revision,
      timeout_ms: 100,
    },
  });
  assert.equal(waited.result.structuredContent.status, "ready");
  assert.equal(waited.result.structuredContent.wait_timed_out, true);
  const sub = subscription(created.task_id);
  assert.ok((await rpc("events/subscribe", sub)).result.id);
  const submitted = await rpc("tools/call", {
    name: "codex_turn_submit",
    arguments: {
      task_id: created.task_id,
      prompt: "work",
      request_id: "first",
      expected_revision: created.revision,
    },
  });
  assert.equal(submitted.result.structuredContent.status, "completed");
  assert.equal(f.store.eventState().outbox.length, 1);
  await f.events.drain();
  assert.equal(JSON.parse(f.posts[1].body).data.reason, "turn_completed");
  assert.equal(
    (
      await rpc("tools/call", {
        name: "codex_task_get",
        arguments: { task_id: created.task_id },
      })
    ).result.structuredContent.thread_id,
    created.thread_id,
  );
  assert.deepEqual(
    (
      await rpc("events/unsubscribe", {
        ...sub,
        delivery: { mode: "webhook", url: sub.delivery.url },
      })
    ).result.resultType,
    "complete",
  );
  await h.close();
});
test("idempotent submit, mismatched request, stale revision, same thread and persisted limit", async () => {
  const f = fixture(2);
  const task = await ready(f);
  const id = task.job_id;
  await f.manager.submit(id, "one", "r1", task.revision);
  await f.manager.submit(id, "one", "r1", task.revision);
  assert.equal(f.fake.count, 1);
  await assert.rejects(f.manager.submit(id, "different", "r1"), /different/);
  f.fake.complete();
  await assert.rejects(
    f.manager.submit(id, "two", "r2", task.revision),
    /Stale/,
  );
  await f.manager.submit(id, "two", "r2", f.manager.get(id).revision);
  f.fake.complete();
  assert.equal(
    f.fake.requests.filter((x) => x.method === "thread/start").length,
    1,
  );
  assert.ok(
    f.fake.requests
      .filter((x) => x.method === "turn/start")
      .every((x) => x.params.threadId === task.thread_id),
  );
  await assert.rejects(f.manager.submit(id, "third", "r3"), /limit/);
  assert.equal(f.manager.get(id).status, "limit_reached");
  const restart = new JobManager(new Fake(), {
    store: new StateStore(f.store.filePath),
    maxTurns: 2,
  });
  assert.equal(restart.get(id).turn_count, 2);
  await assert.rejects(restart.submit(id, "third", "r3"), /limit/);
  await restart.submit(id, "one", "r1");
});
test("verification signs exact bytes; deterministic refresh, rotation, ttl, expiry and unsubscribe", async () => {
  const f = fixture();
  const t = await ready(f);
  const p = subscription(t.job_id, 60000);
  const s = await f.events.subscribe(p);
  const post = f.posts[0];
  new Webhook(p.delivery.secret).verify(post.body, post.headers);
  assert.equal(JSON.parse(post.body).type, "verification");
  assert.equal((await f.events.subscribe(p)).id, s.id);
  assert.equal(f.posts.length, 1);
  const p2 = {
    ...p,
    delivery: {
      ...p.delivery,
      secret: "whsec_" + randomBytes(32).toString("base64"),
    },
  };
  await f.events.subscribe(p2);
  assert.equal(f.posts.length, 2);
  await f.manager.submit(t.job_id, "one", "r1");
  f.fake.complete();
  await f.events.drain();
  const delivered = f.posts.at(-1);
  new Webhook(p.delivery.secret).verify(delivered.body, delivered.headers);
  new Webhook(p2.delivery.secret).verify(delivered.body, delivered.headers);
  f.advance(120000);
  await f.manager.submit(t.job_id, "two", "r2");
  f.fake.complete();
  await f.events.drain();
  assert.equal(f.store.eventState().outbox.at(-1).state, "abandoned");
  f.events.unsubscribe(p);
  f.events.unsubscribe(p);
  assert.equal(f.store.eventState().subscriptions.length, 0);
});
test("retry uses stable event ID with fresh signature; pending delivery survives restart", async () => {
  const f = fixture();
  const t = await ready(f);
  await f.events.subscribe(subscription(t.job_id));
  await f.manager.submit(t.job_id, "work", "r");
  f.fake.complete();
  f.setStatus(503);
  await f.events.drain();
  const first = f.posts.at(-1);
  assert.equal(f.store.eventState().outbox[0].attempts, 1);
  const store = new StateStore(f.store.filePath);
  store.load();
  assert.equal(store.eventState().outbox[0].state, "pending");
  f.advance(5000);
  f.setStatus(200);
  const events = new EventService(store, () => {}, f.send, f.clock);
  await events.drain();
  const second = f.posts.at(-1);
  assert.equal(first.headers["webhook-id"], second.headers["webhook-id"]);
  assert.equal(first.body, second.body);
  assert.notEqual(
    first.headers["webhook-signature"],
    second.headers["webhook-signature"],
  );
  assert.equal(store.eventState().outbox[0].state, "delivered");
});
test("terminal 410 and 413 do not retry", async () => {
  for (const status of [410, 413]) {
    const f = fixture();
    const t = await ready(f);
    await f.events.subscribe(subscription(t.job_id));
    await f.manager.submit(t.job_id, "work", "r");
    f.fake.complete();
    f.setStatus(status);
    await f.events.drain();
    assert.equal(f.store.eventState().outbox[0].state, "abandoned");
    f.advance(999999);
    await f.events.drain();
    assert.equal(f.posts.length, 2);
  }
});
test("invalid subscription and wrong challenge fail closed without persisting secrets", async () => {
  const f = fixture();
  const t = await ready(f);
  const p = subscription(t.job_id);
  for (const bad of [
    { ...p, name: "other" },
    { ...p, arguments: { task_id: t.job_id, x: 1 } },
    { ...p, delivery: { ...p.delivery, secret: "whsec_a" } },
    { ...p, delivery: { ...p.delivery, url: "http://example.com" } },
  ])
    await assert.rejects(f.events.subscribe(bad));
  const events = new EventService(
    f.store,
    () => {},
    async () => ({ status: 200, body: '{"challenge":"wrong"}' }),
  );
  await assert.rejects(events.subscribe(p), (e) => e.code === -32015);
  assert.equal(f.store.eventState().subscriptions.length, 0);
});
test("public-address policy rejects local, mapped, reserved, multicast and unsafe URLs", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:8.8.8.8",
    "224.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  for (const u of [
    "http://example.com",
    "https://u:p@example.com",
    "https://example.com#fragment",
  ])
    assert.throws(() => callbackUrl(u));
  await assert.rejects(
    safeWebhookSend("https://127.0.0.1", "{}", {}),
    /unsafe_address/,
  );
});
test("approval transition enqueues event, exact request matching, stop interrupts and prevents continuation", async () => {
  const f = fixture();
  const t = await ready(f);
  await f.events.subscribe(subscription(t.job_id));
  await f.manager.submit(t.job_id, "work", "r");
  f.fake.emit({
    id: 88,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "cmd-1",
      command: "echo hi",
    },
  });
  assert.equal(
    f.store.eventState().outbox.at(-1).event.data.reason,
    "approval_required",
  );
  await assert.rejects(
    f.manager.respondApproval(t.job_id, 89, "accept"),
    /no existe/,
  );
  await f.manager.interrupt(t.job_id);
  assert.equal(f.fake.requests.at(-1).method, "turn/interrupt");
  await assert.rejects(f.manager.submit(t.job_id, "again", "r2"), /stopped/);
  assert.equal(
    f.store.eventState().outbox.at(-1).event.data.reason,
    "interrupted",
  );
});
