import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BrowserWakeService } from "../src/browser-wake.js";
import type { BrowserData, LbbClient } from "../src/lbb-client.js";
import { StateStore, type PersistedJob } from "../src/store.js";
import { wakeMessage } from "../src/wake-state.js";

const url = "https://chatgpt.com/c/123e4567-e89b-42d3-a456-426614174000";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const epoch = "a".repeat(32), operation = "b".repeat(32);
class FakeLbb implements LbbClient {
  calls: { name: string; args: BrowserData }[] = [];
  receipts = new Map<string, BrowserData>();
  draft = ""; sent: string[] = []; currentUrl = url; connected = true; busy = false;
  wrongUrl = false; renderDelayed = false; reveal = true; userHeading = true;
  incomplete = false; tabLost = false; searchOpen = false; resultCount = 1;
  fail: "none" | "beforeSend" | "uncertainSend" | "afterSend" | "afterAppend" | "beforeAppend" | "afterOpen" = "none";
  hook: ((name: string, args: BrowserData) => void) | undefined;
  closed = false;
  searchMarker = ""; bindingMissing = false;
  stamp = { tabId: 7, sessionEpoch: epoch, documentEpoch: epoch, observationId: epoch };
  observe(): BrowserData {
    if (this.tabLost) return { error: "TAB_NOT_FOUND" };
    const shown = this.reveal ? this.sent : [];
    const text = (this.searchMarker && !(this.bindingMissing && this.currentUrl !== "https://chatgpt.com/") ? this.searchMarker + "\n" : "") + shown.map(s => `${this.userHeading ? "You said:" : "Assistant said:"}\n${s}`).join("\n");
    const isSearch = this.currentUrl === "https://chatgpt.com/";
    return { url: this.wrongUrl ? "https://chatgpt.com/c/00000000-0000-0000-0000-000000000000" : this.currentUrl,
      coherent: true, changedDuringCollection: false, stateStamp: this.stamp,
      completeness: Object.fromEntries(["url", "text", "controls", "blocks"].map(p => [p, { scanComplete: !this.incomplete, truncated: false }])),
      controls: isSearch ? (this.searchOpen ? [
        { ref: "searchbox", role: "textbox", label: "Search…", disabled: false },
        ...Array.from({ length: this.resultCount }, (_, i) => ({ ref: `result${i}`, role: "option", label: "Observed result", disabled: false })),
      ] : [{ ref: "search", role: "button", label: "Search", disabled: false }]) : [
        { ref: "composer", role: "textbox", label: "Ask ChatGPT", disabled: false },
        { ref: "share", role: "button", label: "Share", disabled: this.busy },
        { ref: "regen", role: "button", label: "Regenerate response", disabled: false },
        ...(this.busy ? [{ ref: "stop", role: "button", label: "Stop generating", disabled: false }] : []),
      ],
      text: { value: text, scanTruncated: false, contains: { present: shown.length > 0, determinate: true } },
      blocks: shown.flatMap((s, i) => [ { sourceOrder: i * 2, role: "heading", text: this.userHeading ? "You said:" : "Assistant said:" }, { sourceOrder: i * 2 + 1, text: s } ]),
    };
  }
  async call(name: string, args: BrowserData): Promise<BrowserData> {
    this.calls.push({ name, args }); this.hook?.(name, args);
    if (name === "browser_status") return { connected: this.connected, mode: "action" };
    if (name === "browser_observe") { const o = this.observe(); if (o.text && args.text?.contains) o.text.contains = { present: String(o.text.value).includes(args.text.contains), determinate: true }; return o; }
    if (name === "browser_operation") return this.receipts.get(args.clientRequestId) ?? { code: "RECEIPT_UNKNOWN" };
    let result: BrowserData = { url: this.currentUrl, operationId: operation, stateStamp: this.stamp, tabId: 7 };
    if (name === "browser_open_tab") { this.currentUrl = args.url; this.tabLost = false; }
    if (name === "browser_click") {
      if (args.ref === "search") this.searchOpen = true;
      else this.currentUrl = url;
    }
    if (name === "browser_type") {
      if (args.ref === "searchbox") {
        this.searchMarker = args.text;
        result.write = { writeVerified: true, charsWritten: args.text.length, contentLength: args.text.length, contentHash: digest(args.text) };
      } else {
        if (args.text && this.fail === "beforeAppend") return this.notSent(args.clientRequestId);
        assert.equal(args.mode, "append", "Composer is never replaced");
        this.draft += args.text;
        result.write = { writeVerified: true, charsWritten: args.text.length, contentLength: this.draft.length, contentHash: digest(this.draft) };
      }
    }
    if (name === "browser_press") {
      if (this.fail === "beforeSend") return this.notSent(args.clientRequestId);
      if (this.fail === "uncertainSend") {
        const r = { receipt: { actionState: "unknown", dispatch: "unknown" } };
        this.receipts.set(args.clientRequestId, r); throw new Error("Connection lost before outcome known");
      }
      this.sent.push(this.draft); this.draft = "";
      if (this.renderDelayed) this.reveal = false;
    }
    result.url = this.currentUrl;
    const receipt = { actionState: "executed", dispatch: "sent", result };
    const r = { ...result, receipt };
    this.receipts.set(args.clientRequestId, r);
    if ((name === "browser_press" && this.fail === "afterSend") || (name === "browser_type" && args.text && this.fail === "afterAppend") || (name === "browser_open_tab" && this.fail === "afterOpen")) throw new Error("Reply lost after effect");
    return r;
  }
  notSent(id: string): BrowserData {
    const r = { receipt: { actionState: "not_started", dispatch: "not_sent", safeToRetry: true, safeToRetryReason: "no_requested_effect_dispatched" } };
    this.receipts.set(id, r); return r;
  }
  async close() { this.closed = true; }
}
function fixture(explicitUrl = true) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "wake-fixture-")), "state.json");
  const store = new StateStore(file, { enforcePrivateAcl: false });
  const task = randomUUID(), binding = `CW-BIND-${randomUUID()}`;
  const job: PersistedJob = { job_id: task, thread_id: "thread", turn_id: "turn", workspace: process.cwd(),
    status: "running", final_message: null, latest_diff: null, files_changed: [], commands_executed: [], error: null,
    updated_at: new Date().toISOString(), revision: 1,
    wake: {
      enabled: true,
      binding_marker: binding,
      conversation_url: explicitUrl ? url : null,
      conversation_id: explicitUrl ? url.slice("https://chatgpt.com/c/".length) : null,
      host_session_id: "session-fixture",
      binding_source: explicitUrl ? "direct" : "session",
    },
    requests: { request: { hash: "hash", hash_version: 3, turn_id: "turn", wake: "browser" } } };
  store.save([job]); job.status = "completed"; job.revision = 2; store.save([job]);
  const lbb = new FakeLbb();
  let paused = false, now = Date.now();
  const make = (s = store) => new BrowserWakeService(s, lbb, { paused: () => paused, now: () => now,
    authorize: async id => { assert.equal(id, task); }, pin: (id, pinned) => { assert.equal(id, task); job.wake!.conversation_url = pinned; s.save([job]); } });
  return { store, lbb, job, make, setPaused: (p: boolean) => { paused = p; }, advance: (ms = 3600001) => { now += ms; } };
}

test("empty append proof, exact append and rendered user acceptance deliver one bounded envelope", async () => {
  const f = fixture(); await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.state, "delivered");
  assert.deepEqual(f.lbb.sent, [wakeMessage(f.store.wakeIntents()[0]!)]);
  assert.ok(f.lbb.calls.filter(c => c.name === "browser_type").every(c => c.args.mode === "append"));
  assert.equal(f.lbb.calls.filter(c => c.name === "browser_press").length, 1);
  f.advance(); await f.make().tick(); assert.equal(f.lbb.sent.length, 1);
});
for (const mode of ["draft", "busy", "wrongUrl", "incomplete"] as const) test(`${mode} preserves composer and never submits`, async () => {
  const f = fixture();
  if (mode === "draft") f.lbb.draft = "owner draft, untouched";
  else f.lbb[mode] = true;
  await f.make().tick();
  assert.equal(f.lbb.sent.length, 0); assert.equal(f.lbb.draft, mode === "draft" ? "owner draft, untouched" : "");
  assert.notEqual(f.store.wakeIntents()[0]!.state, "delivered");
});
test("offline to online remains durable pending and resumes", async () => {
  const f = fixture(); f.lbb.connected = false; await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.state, "pending");
  const restored = new StateStore(f.store.filePath, { enforcePrivateAcl: false }); restored.load(); f.lbb.connected = true; f.advance(); await f.make(restored).tick();
  assert.equal(restored.wakeIntents()[0]!.state, "delivered");
});
test("delayed render reconciles same send receipt across restart without pressing again", async () => {
  const f = fixture(); f.lbb.renderDelayed = true; await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.state, "uncertain");
  const id = f.store.wakeIntents()[0]!.actions.find(a => a.kind === "send")!.id;
  const restored = new StateStore(f.store.filePath, { enforcePrivateAcl: false }); restored.load(); f.lbb.reveal = true; f.advance(); await f.make(restored).tick();
  assert.equal(restored.wakeIntents()[0]!.state, "delivered");
  assert.equal(f.lbb.calls.filter(c => c.name === "browser_press").length, 1);
  assert.ok(f.lbb.calls.some(c => c.name === "browser_operation" && c.args.clientRequestId === id));
});
test("uncertain submit is not blindly replayed", async () => {
  const f = fixture(); f.lbb.fail = "uncertainSend"; await f.make().tick();
  f.lbb.fail = "none"; f.advance(); await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.state, "uncertain");
  assert.equal(f.lbb.calls.filter(c => c.name === "browser_press").length, 1);
});
test("positive no-dispatch receipt permits a new recorded attempt without appending twice", async () => {
  const f = fixture(); f.lbb.fail = "beforeSend"; await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.stage, "prepared");
  f.lbb.fail = "none"; f.advance(); await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.state, "delivered");
  const sends = f.lbb.calls.filter(c => c.name === "browser_press");
  assert.equal(sends.length, 2); assert.notEqual(sends[0]!.args.clientRequestId, sends[1]!.args.clientRequestId);
  assert.equal(f.lbb.calls.filter(c => c.name === "browser_type" && c.args.text).length, 1);
});
for (const failure of ["afterAppend", "afterSend", "afterOpen"] as const) test(`${failure} reconciles lost response with same receipt`, async () => {
  const f = fixture(); f.lbb.fail = failure; await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.state, "delivered"); assert.equal(f.lbb.sent.length, 1);
  assert.ok(f.lbb.calls.some(c => c.name === "browser_operation"));
});
test("marker in composer or assistant prose is not sent-user-message evidence", async () => {
  const f = fixture(); f.lbb.userHeading = false; await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.state, "uncertain");
  f.advance(); await f.make().tick(); assert.equal(f.lbb.sent.length, 1);
});
test("concurrent user modification before Enter preserves text and prevents send", async () => {
  const f = fixture(); let probes = 0;
  f.lbb.hook = (name, args) => { if (name === "browser_type" && args.text === "" && ++probes === 2) f.lbb.draft += " owner's change"; };
  await f.make().tick(); assert.equal(f.lbb.sent.length, 0); assert.ok(f.lbb.draft.endsWith(" owner's change"));
});
for (const reason of ["pause", "stop", "newer"] as const) test(`${reason} race immediately before Enter suppresses delayed send`, async () => {
  const f = fixture(); let probes = 0;
  f.lbb.hook = (name, args) => {
    if (name === "browser_type" && args.text === "" && ++probes === 2) {
      if (reason === "pause") f.setPaused(true);
      else { if (reason === "stop") f.job.stopped = true; else f.job.turn_id = "newer"; f.store.save([f.job]); }
    }
  };
  await f.make().tick(); assert.equal(f.lbb.sent.length, 0);
  assert.equal(f.store.wakeIntents()[0]!.state, reason === "pause" ? "pending" : "cancelled");
});
test("deadline expires and bounded attempts suppress all writes", async () => {
  const f = fixture(); f.store.updateWake(f.store.wakeIntents()[0]!.id, w => { w.attempts = 32; });
  await f.make().tick(); assert.equal(f.store.wakeIntents()[0]!.state, "cancelled"); assert.equal(f.lbb.calls.length, 0);
});
test("generic marker search pins canonical URL once using observed controls", async () => {
  const f = fixture(false); await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.conversation_url, url); assert.equal(f.job.wake!.conversation_url, url);
  assert.equal(f.store.wakeIntents()[0]!.state, "delivered");
});
for (const count of [0, 2]) test(`marker search ${count} results never picks a conversation`, async () => {
  const f = fixture(false); f.lbb.resultCount = count; await f.make().tick();
  assert.equal(f.lbb.sent.length, 0); assert.equal(f.store.wakeIntents()[0]!.conversation_url, null);
  assert.equal(f.store.wakeIntents()[0]!.state, count === 0 ? "pending" : "blocked");
});
test("shutdown only closes own client and disables further ticks", async () => {
  const f = fixture(); const service = f.make(); await service.stop(); await service.tick();
  assert.equal(f.lbb.closed, true); assert.equal(f.lbb.calls.length, 0);
});

for (const kind of ["open", "append", "send"] as const) {
  for (const when of ["before", "after"] as const) test(`crash ${when} ${kind}: restart inspects durable same ID`, async () => {
    const f = fixture();
    const update = f.store.updateWake.bind(f.store); let injected = false;
    f.store.updateWake = (id, change) => {
      const candidate = structuredClone(f.store.wakeIntents().find(w => w.id === id)!); change(candidate);
      const action = candidate.actions.at(-1);
      if (!injected && action?.kind === kind && action.outcome === (when === "before" ? "intent" : "executed")) {
        injected = true;
        if (when === "before") update(id, change);
        throw new Error("Simulated process loss at durable checkpoint");
      }
      update(id, change);
    };
    await f.make().tick(); assert.equal(injected, true);
    const restored = new StateStore(f.store.filePath, { enforcePrivateAcl: false }); restored.load(); f.advance(); await f.make(restored).tick();
    assert.ok(f.lbb.calls.some(c => c.name === "browser_operation"));
    if (when === "after") { assert.equal(restored.wakeIntents()[0]!.state, "delivered"); assert.equal(f.lbb.sent.length, 1); }
    else { assert.equal(restored.wakeIntents()[0]!.state, "uncertain"); assert.equal(f.lbb.sent.length, 0); }
    assert.ok(f.lbb.calls.filter(c => c.name === "browser_press").length <= 1);
  });
}

test("confirmed pre-append failure retries without composer replacement", async () => {
  const f = fixture(); f.lbb.fail = "beforeAppend"; await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.stage, "queued"); assert.equal(f.lbb.draft, "");
  f.lbb.fail = "none"; f.advance(); await f.make().tick(); assert.equal(f.store.wakeIntents()[0]!.state, "delivered");
});

test("one sender serializes concurrent ticks", async () => {
  const f = fixture(); const service = f.make(); await Promise.all([service.tick(), service.tick(), service.tick()]);
  assert.equal(f.lbb.sent.length, 1);
});

test("quoted Stop/Thinking prose does not count as a busy control", async () => {
  const f = fixture(); const observe = f.lbb.observe.bind(f.lbb);
  f.lbb.observe = () => { const o = observe(); o.text.value = `Quoted: Stop generating, Thinking\n${o.text.value}`; return o; };
  await f.make().tick(); assert.equal(f.store.wakeIntents()[0]!.state, "delivered");
});

test("deadline passed, persisted pause and task stop cannot produce historical sends", async () => {
  const f = fixture(); f.setPaused(true); await f.make().tick(); assert.equal(f.lbb.calls.length, 0);
  f.job.stopped = true; f.store.save([f.job]); f.setPaused(false); await f.make().tick();
  assert.equal(f.lbb.calls.length, 0); assert.equal(f.store.wakeIntents()[0]!.state, "cancelled");
});

test("lost queued owned tab is replaced only once with known canonical URL", async () => {
  const f = fixture(); f.lbb.busy = true; await f.make().tick();
  f.lbb.tabLost = true; f.advance(); await f.make().tick();
  f.lbb.busy = false; f.advance(); await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.state, "delivered");
  assert.equal(f.lbb.calls.filter(c => c.name === "browser_open_tab").length, 2);
});

test("created tab provenance survives missing initial epoch readback without creating another tab", async () => {
  const f = fixture(); const call = f.lbb.call.bind(f.lbb);
  f.lbb.call = async (name, args) => {
    const result = await call(name, args);
    if (name === "browser_open_tab") { delete result.stateStamp; delete result.receipt.result.stateStamp; }
    return result;
  };
  await f.make().tick(); assert.equal(f.store.wakeIntents()[0]!.state, "delivered");
  assert.equal(f.lbb.calls.filter(c => c.name === "browser_open_tab").length, 1);
});

test("sent acceptance with changed nonempty composer never deletes a later owner draft", async () => {
  const f = fixture(); const call = f.lbb.call.bind(f.lbb);
  f.lbb.call = async (name, args) => { const result = await call(name, args); if (name === "browser_press") f.lbb.draft = "new owner draft"; return result; };
  await f.make().tick(); assert.equal(f.store.wakeIntents()[0]!.state, "uncertain");
  assert.equal(f.lbb.draft, "new owner draft"); f.advance(); await f.make().tick();
  assert.equal(f.lbb.sent.length, 1);
  assert.equal(f.store.wakeIntents()[0]!.state, "uncertain");
  assert.equal(f.lbb.draft, "new owner draft");
});

test("search result navigation renders later without clicking the result twice", async () => {
  const f = fixture(false); const call = f.lbb.call.bind(f.lbb); let delay = true;
  f.lbb.call = async (name, args) => { const r = await call(name, args); if (name === "browser_click" && args.ref === "result0" && delay) f.lbb.currentUrl = "https://chatgpt.com/"; return r; };
  await f.make().tick(); assert.equal(f.lbb.sent.length, 0);
  delay = false; f.lbb.currentUrl = url; f.advance(); await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.state, "delivered"); assert.equal(f.lbb.calls.filter(c => c.name === "browser_click" && c.args.ref === "result0").length, 1);
});


test("real relay-accepted no-native-dispatch evidence permits safe retry", async () => {
  const f = fixture(); f.lbb.notSent = id => { const r = { receipt: { actionState: "not_started", dispatch: "sent", safeToRetry: true, safeToRetryReason: "no_requested_effect_dispatched", evidence: { nativeDispatch: "not_sent" } } }; f.lbb.receipts.set(id, r); return r; };
  f.lbb.fail = "beforeSend"; await f.make().tick(); assert.equal(f.store.wakeIntents()[0]!.stage, "prepared");
  f.lbb.fail = "none"; f.advance(); await f.make().tick(); assert.equal(f.lbb.sent.length, 1); assert.equal(f.store.wakeIntents()[0]!.state, "delivered");
});
test("hours offline availability checks do not exhaust the dispatch budget", async () => {
  const f = fixture(); f.lbb.connected = false;
  for(let i=0;i<40;i++){await f.make().tick();f.advance(30001);}
  assert.equal(f.store.wakeIntents()[0]!.state,"pending"); assert.equal(f.store.wakeIntents()[0]!.attempts,0);
  f.lbb.connected=true;await f.make().tick();assert.equal(f.store.wakeIntents()[0]!.state,"delivered");
});
test("a stale unique search result cannot bind a conversation missing the marker", async () => {
  const f=fixture(false);f.lbb.bindingMissing=true;await f.make().tick();assert.equal(f.job.wake!.conversation_url,null);assert.equal(f.lbb.sent.length,0);
});
test("already dispatched wake is reconciled after task progresses, not resent or recalled", async () => {
  const f=fixture();f.lbb.renderDelayed=true;await f.make().tick();f.job.turn_id="next-turn";f.job.status="running";f.store.save([f.job]);
  assert.equal(f.store.wakeIntents()[0]!.state,"uncertain");f.lbb.reveal=true;f.advance();await f.make().tick();assert.equal(f.store.wakeIntents()[0]!.state,"delivered");assert.equal(f.lbb.sent.length,1);
});

test("direct create-time canonical URL does not depend on marker indexing", async () => {
  const f = fixture(true);
  f.lbb.bindingMissing = true;
  await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.binding_source, "direct");
  assert.equal(f.store.wakeIntents()[0]!.state, "delivered");
  assert.equal(f.lbb.sent.length, 1);
  assert.equal(f.lbb.calls.some(c => c.name === "browser_click" && c.args.ref === "search"), false);
});

test("recovered canonical URL still requires marker proof before writing", async () => {
  const f = fixture(true);
  const wakes = f.store.wakeIntents();
  f.store.updateWake(wakes[0]!.id, w => { w.binding_source = "recovered"; });
  f.lbb.bindingMissing = true;
  await f.make().tick();
  assert.equal(f.lbb.sent.length, 0);
  assert.equal(f.store.wakeIntents()[0]!.state, "pending");
});

test("browser session restart before send invalidates the old owned tab and recovers on a bounded replacement", async () => {
  const f = fixture(); f.lbb.busy = true; await f.make().tick();
  assert.equal(f.lbb.sent.length, 0);
  assert.ok(f.store.wakeIntents()[0]!.tab);
  f.lbb.stamp = { ...f.lbb.stamp, sessionEpoch: "c".repeat(32), documentEpoch: "c".repeat(32), observationId: "c".repeat(32) };
  f.lbb.busy = false; f.advance(); await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.state, "pending");
  assert.equal(f.store.wakeIntents()[0]!.tab, undefined);
  assert.equal(f.lbb.sent.length, 0);
  f.advance(); await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.state, "delivered");
  assert.equal(f.lbb.sent.length, 1);
  assert.equal(f.lbb.calls.filter(c => c.name === "browser_open_tab").length, 2);
});

test("browser session restart after dispatch reopens only to reconcile and never sends twice", async () => {
  const f = fixture(); f.lbb.renderDelayed = true; await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.stage, "dispatched");
  assert.equal(f.store.wakeIntents()[0]!.state, "uncertain");
  assert.equal(f.lbb.sent.length, 1);
  f.lbb.stamp = { ...f.lbb.stamp, sessionEpoch: "d".repeat(32), documentEpoch: "d".repeat(32), observationId: "d".repeat(32) };
  f.lbb.reveal = true; f.advance(); await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.tab, undefined);
  assert.equal(f.lbb.sent.length, 1);
  f.advance(); await f.make().tick();
  assert.equal(f.store.wakeIntents()[0]!.state, "delivered");
  assert.equal(f.lbb.sent.length, 1);
  assert.equal(f.lbb.calls.filter(c => c.name === "browser_press").length, 1);
});
