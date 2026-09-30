import { createHash } from "node:crypto";
import { StateStore } from "./store.js";
import { conversationUrl, wakeMessage, type WakeIntent, type WakeLabels } from "./wake-state.js";
import type { BrowserData, LbbClient } from "./lbb-client.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const terminal = (w: WakeIntent) => w.state === "delivered" || w.state === "cancelled";
export const defaultLabels = {
  composer: ["Ask ChatGPT", "Chiedi a ChatGPT", "Message ChatGPT", "Invia un messaggio a ChatGPT"],
  share: ["Share", "Condividi"], regenerate: ["Regenerate response", "Rigenera risposta"],
  busy: ["Stop", "Stop generating", "Interrompi", "Interrompi generazione", "Thinking", "Working for", "Ragionamento"],
  search: ["Search", "Search chats", "Cerca", "Cerca nelle chat"],
  searchInput: ["Search", "Search…", "Search...", "Cerca", "Cerca…", "Cerca..."],
  userHeading: ["You said:", "Hai detto:", "You said", "Hai detto"],
};
type Labels = WakeLabels;
class Deferred extends Error {
  constructor(message: string, readonly state: "pending" | "blocked" | "uncertain" = "blocked") { super(message); }
}
function complete(o: BrowserData, part: string): boolean {
  return o.coherent === true && o.changedDuringCollection !== true &&
    o.completeness?.[part]?.scanComplete === true && o.completeness?.[part]?.truncated === false;
}
function controls(o: BrowserData, labels: string[], role?: string): BrowserData[] {
  return (o.controls ?? []).filter((c: BrowserData) => (!role || c.role === role) && labels.some(l => String(c.label).toLowerCase() === l.toLowerCase()));
}
function exactWrite(r: BrowserData, text: string, written: number): boolean {
  const w = r.write ?? r.receipt?.result?.write ?? r.receipt?.evidence?.write ?? r;
  return w.writeVerified === true && w.charsWritten === written && w.contentLength === text.length && w.contentHash === hash(text);
}
function noDispatch(r: BrowserData): boolean {
  const receipt = r.receipt ?? r;
  return receipt.safeToRetry === true && receipt.safeToRetryReason === "no_requested_effect_dispatched" &&
    receipt.actionState === "not_started" &&
    [undefined, "not_sent"].includes(receipt.nativeDispatch ?? receipt.evidence?.nativeDispatch ?? r.nativeDispatch);
}
export type WakeOptions = {
  paused: () => boolean;
  authorize: (id: string) => Promise<void>;
  pin: (task: string, url: string) => void;
  now?: () => number;
  labels?: Labels;
  pollMs?: number;
};

/** Serialized supervised fallback. The bridge's state-file process lock is its single-sender lease. */
export class BrowserWakeService {
  private running = false;
  private stopped = false;
  private timer: NodeJS.Timeout | undefined;
  private inflight: Promise<void> | undefined;
  private readonly labels: Labels;
  private readonly now: () => number;
  constructor(private readonly store: StateStore, private readonly lbb: LbbClient, private readonly options: WakeOptions) {
    this.labels = options.labels ?? defaultLabels; this.now = options.now ?? Date.now;
  }
  status(): object {
    const counts: Record<string, number> = {};
    for (const w of this.store.wakeIntents()) counts[w.state] = (counts[w.state] ?? 0) + 1;
    return { service: this.stopped ? "stopped" : this.options.paused() ? "paused" : "running", counts,
      outbox: this.store.wakeIntents().slice(-20).map(w => ({ id: w.id, task_id: w.task_id, state: w.state, stage: w.stage, detail: w.detail, retry_at: w.retry_at, deadline: w.deadline })) };
  }
  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => { if (!this.running) this.inflight = this.tick().catch(() => { /* Persistence failure remains fail closed. */ }); }, this.options.pollMs ?? 5000);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.inflight;
    await this.lbb.close(); // Only our stdio MCP child, never the relay/Chrome/other workers.
  }
  private current(id: string): WakeIntent { return this.store.wakeIntents().find(w => w.id === id)!; }
  private guard(w: WakeIntent): void {
    if (this.stopped || this.options.paused()) throw new Deferred("Sender stopped or operator paused", "pending");
    const job = this.store.jobsSnapshot().find(j => j.job_id === w.task_id);
    if (!job || job.stopped || !job.wake?.enabled || job.turn_id !== w.turn_id || job.status !== w.status || terminal(this.current(w.id)))
      throw new Deferred("Task stopped, disarmed or superseded");
  }
  async tick(): Promise<void> {
    if (this.running || this.stopped || this.options.paused()) return;
    this.running = true;
    try {
      const w = this.store.wakeIntents().find(w => !terminal(w) && w.retry_at <= this.now());
      if (!w) return;
      if (w.deadline <= this.now() || w.attempts >= 32) {
        this.store.updateWake(w.id, x => { x.state = x.stage === "dispatched" ? "uncertain" : "cancelled"; x.detail = "Wake deadline or retry limit reached"; x.retry_at = Number.MAX_SAFE_INTEGER; });
        return;
      }
      this.store.updateWake(w.id, x => { x.attempts++; x.retry_at = this.now() + Math.min(3600000, 5000 * 2 ** Math.min(x.attempts, 10)); });
      const previousActions = w.actions.length;
      try { await this.deliver(this.current(w.id)); }
      catch (e) {
        const current = this.current(w.id);
        if (!terminal(current)) this.store.updateWake(w.id, x => {
          x.state = x.stage === "dispatched" ? "uncertain" : e instanceof Deferred ? e.state : "pending";
          x.detail = e instanceof Deferred ? e.message : "LBB unavailable; inspect receipt before further actions";
          // Availability checks do not exhaust the dispatch budget while Chrome is offline.
          if (x.state === "pending" && x.actions.length === previousActions) {
            x.attempts = Math.max(0, x.attempts - 1);
            x.retry_at = this.now() + 30000;
          }
        });
      }
    } finally { this.running = false; }
  }
  private invalidateTab(w: WakeIntent, detail: string): void {
    for (const prior of this.store.wakeIntents().filter(p => p.tab?.id === w.tab?.id && p.task_id === w.task_id))
      this.store.updateWake(prior.id, x => {
        delete x.tab;
        delete x.pending_tab;
        x.tab_lost = true;
        if (x.stage === "prepared") x.stage = "queued";
        x.detail = detail;
      });
  }
  private async observe(w: WakeIntent, search = false): Promise<BrowserData> {
    const o = await this.lbb.call("browser_observe", { tabId: w.tab!.id,
      include: ["url", "text", "controls", "blocks"], text: { position: "tail", maxChars: 24000, contains: `[Codex Bridge wake ${w.id}]` } });
    if (o.error || !complete(o, "url")) {
      if (["TAB_NOT_FOUND", "TAB_CLOSED"].includes(o.code ?? o.error) && w.conversation_url)
        this.invalidateTab(w, "Sentinel-owned tab disappeared; reopen the pinned conversation before any further effect");
      throw new Deferred("Login, lost tab, offline or incoherent URL observation", "pending");
    }
    if (search ? !/^https:\/\/chatgpt\.com\/(?:$|c\/[0-9a-f-]{36}$)/.test(o.url) : o.url !== w.conversation_url)
      throw new Deferred("Canonical conversation URL mismatch");
    if (o.stateStamp?.sessionEpoch !== w.tab!.session_epoch) {
      if (w.conversation_url) {
        this.invalidateTab(w, "Browser session changed; old sentinel tab ownership invalidated");
        throw new Deferred("Browser session changed; reopen the pinned conversation", "pending");
      }
      throw new Deferred("Owned tab session changed; ownership cannot be assumed");
    }
    return o;
  }
  private async action(w: WakeIntent, kind: WakeIntent["actions"][number]["kind"], name: string, args: BrowserData, stage?: WakeIntent["stage"], reconciliation = false): Promise<BrowserData> {
    const reconciliationProbe = reconciliation && kind === "probe" && w.stage === "dispatched" && name === "browser_type" && args.text === "" && args.mode === "append";
    if (reconciliation && !reconciliationProbe) throw new Error("Only an empty post-dispatch probe may bypass the pre-send guard");
    if (!reconciliationProbe) this.guard(w);
    // Send follows the immediately preceding URL/hash probe; no intervening UI effect.
    if (["probe", "append"].includes(kind)) await this.observe(w);
    if (!reconciliationProbe) this.guard(w);
    const unresolved = this.current(w.id).actions.find(a => a.outcome === "intent" || a.outcome === "uncertain");
    let id: string;
    let r: BrowserData;
    if (unresolved) {
      if (unresolved.kind !== kind) throw new Deferred(`Unresolved ${unresolved.kind} operation; no new effect permitted`, "uncertain");
      id = unresolved.id;
      r = await this.lbb.call("browser_operation", { clientRequestId: id, includeObservation: true });
    } else {
      id = `${w.id}:${this.current(w.id).actions.length}:${kind}`;
      this.store.updateWake(w.id, x => { x.operation_id = id; if (stage) x.stage = stage; if (kind === "open") x.tab_creations++; x.actions.push({ id, kind, outcome: "intent" }); });
      if (!reconciliationProbe) this.guard(this.current(w.id));
      try { r = await this.lbb.call(name, { ...args, clientRequestId: id }); }
      catch { r = await this.lbb.call("browser_operation", { clientRequestId: id, includeObservation: true }); }
    }
    const receipt = r.receipt ?? r;
    const executed = receipt.actionState === "executed";
    this.store.updateWake(w.id, x => {
      const a = x.actions.find(a => a.id === id)!;
      a.outcome = noDispatch(r) ? "no_dispatch" : executed ? "executed" : "uncertain";
      if (kind === "open" && noDispatch(r)) x.tab_creations--;
      if (kind === "open" && executed) x.tab_lost = false;
      const op = r.operationId ?? receipt.result?.operationId ?? receipt.evidence?.operationId;
      if (typeof op === "string") a.operation = op;
    });
    if (noDispatch(r)) {
      this.store.updateWake(w.id, x => { if (kind === "append") x.stage = "queued"; if (kind === "send") x.stage = "prepared"; });
      throw new Deferred(`${kind}: confirmed no dispatch; safe retry`, "pending");
    }
    if (!executed) throw new Deferred(`${kind}: receipt outcome uncertain`, "uncertain");
    const result = { ...(receipt.evidence ?? {}), ...(receipt.result ?? {}), ...r };
    if (["probe", "append", "send"].includes(kind) && (result.url ?? result.observation?.url) !== w.conversation_url)
      throw new Deferred("Action readback canonical URL mismatch", "uncertain");
    return result;
  }
  private async ownedTab(w: WakeIntent): Promise<WakeIntent> {
    if (w.tab) return w;
    if (w.pending_tab) {
      const o = await this.lbb.call("browser_observe", { tabId: w.pending_tab.id, include: ["url"] });
      if (["TAB_NOT_FOUND", "TAB_CLOSED"].includes(o.code ?? o.error) && w.conversation_url && w.stage === "queued") {
        this.store.updateWake(w.id, x => { delete x.pending_tab; x.tab_lost = true; });
        throw new Deferred("Created owned tab lost; bounded replacement permitted", "pending");
      }
      if (!complete(o, "url") || !o.stateStamp?.sessionEpoch || !o.stateStamp?.documentEpoch ||
        (w.conversation_url ? o.url !== w.conversation_url : o.url !== "https://chatgpt.com/"))
        throw new Deferred("Created owned tab readback pending or URL mismatch", "pending");
      this.store.updateWake(w.id, x => { x.tab = { ...x.pending_tab!, session_epoch: o.stateStamp.sessionEpoch, document_epoch: o.stateStamp.documentEpoch }; delete x.pending_tab; });
      return this.current(w.id);
    }
    const created = w.actions.filter(a => a.kind === "open" && a.outcome === "executed").at(-1);
    if (created && !w.tab_lost) {
      const r = await this.lbb.call("browser_operation", { clientRequestId: created.id, includeObservation: true });
      const evidence = r.receipt?.result ?? r.receipt?.evidence;
      const tabId = evidence?.tabId ?? evidence?.stateStamp?.tabId;
      if (!tabId || !evidence?.operationId) throw new Deferred("Created tab receipt cannot establish provenance", "uncertain");
      this.store.updateWake(w.id, x => { x.pending_tab = { id: tabId, creation_operation: evidence.operationId }; });
      return this.ownedTab(this.current(w.id));
    }
    const previous = this.store.wakeIntents().find(p => p.task_id === w.task_id && p.tab && p.conversation_url === w.conversation_url);
    if (previous?.tab) { this.store.updateWake(w.id, x => { x.tab = previous.tab; }); return this.current(w.id); }
    const creations = this.store.wakeIntents().filter(p => p.task_id === w.task_id).reduce((n, p) => n + p.tab_creations, 0);
    const unresolvedOpen = w.actions.some(a => a.kind === "open" && ["intent", "uncertain"].includes(a.outcome));
    if (creations >= 2 && !unresolvedOpen) throw new Deferred("Owned tab creation limit reached");
    const r = await this.action(w, "open", "browser_open_tab", { url: w.conversation_url ?? "https://chatgpt.com/", active: false });
    const stamp = r.stateStamp ?? r.observation?.stateStamp;
    const op = r.operationId ?? r.receipt?.result?.operationId;
    const tabId = r.tabId ?? stamp?.tabId;
    if (!Number.isSafeInteger(tabId) || !op) throw new Deferred("Tab creation provenance incomplete", "uncertain");
    this.store.updateWake(w.id, x => {
      x.pending_tab = { id: tabId, creation_operation: op };
      if (stamp?.sessionEpoch && stamp?.documentEpoch) { x.tab = { id: tabId, creation_operation: op, session_epoch: stamp.sessionEpoch, document_epoch: stamp.documentEpoch }; delete x.pending_tab; }
    });
    if (!this.current(w.id).tab) return this.ownedTab(this.current(w.id));
    return this.current(w.id);
  }
  private composer(o: BrowserData): BrowserData {
    if (!complete(o, "controls")) throw new Deferred("Incomplete controls; cannot prove composer or response idle");
    const found = controls(o, this.labels.composer).filter(c => c.role === "textbox" && c.disabled === false);
    if (found.length !== 1 || !found[0]?.ref) throw new Deferred("Login or ambiguous Ask ChatGPT composer");
    return found[0];
  }
  private idle(o: BrowserData): BrowserData {
    const composer = this.composer(o);
    const share = controls(o, this.labels.share, "button")[0]; // First exact Share is the header control.
    if (!share || share.disabled !== false || !controls(o, this.labels.regenerate, "button").some(c => c.disabled === false) ||
      (o.controls ?? []).some((c: BrowserData) => ["button", "status", "progressbar"].includes(c.role) && this.labels.busy.some(l => String(c.label).toLowerCase().startsWith(l.toLowerCase()))))
      throw new Deferred("ChatGPT busy or idle evidence unavailable", "pending");
    return composer;
  }
  private async probe(w: WakeIntent, o: BrowserData, expected: string, reconciliation = false): Promise<void> {
    const c = this.composer(o);
    const r = await this.action(w, "probe", "browser_type", { tabId: w.tab!.id, ref: c.ref, text: "", mode: "append" }, undefined, reconciliation);
    if ((r.url ?? r.observation?.url ?? r.receipt?.result?.stateStamp?.url) !== w.conversation_url) throw new Deferred("Probe URL mismatch");
    if (!exactWrite(r, expected, 0)) throw new Deferred(expected ? "Composer changed; preserve draft and do not submit" : "Nonempty or unverified user draft; preserve it");
  }
  private accepted(o: BrowserData, w: WakeIntent): boolean {
    // Blocks/text omit editors in LBB. Require an explicit rendered user heading, never infer speaker from alignment.
    if (!w.marker_absent || o.coherent !== true || o.changedDuringCollection === true) return false;
    const expected = wakeMessage(w), marker = `[Codex Bridge wake ${w.id}]`;
    const tail = String(o.text?.value ?? "");
    if (o.text?.contains?.determinate === true && o.text?.scanTruncated === false &&
      tail.split(marker).length === 2 && this.labels.userHeading.some(h => tail.includes(`${h}\n${expected}`))) return true;
    if (!complete(o, "blocks")) return false;
    const blocks: BrowserData[] = [...(o.blocks ?? [])].sort((a, b) => a.sourceOrder - b.sourceOrder);
    const matches = blocks.filter((b, index) => {
      const heading = blocks.slice(0, index).reverse().find(h => h.role === "heading");
      return b.text === expected && !!heading && this.labels.userHeading.includes(heading.text);
    });
    return matches.length === 1;
  }
  private async pinVerified(w: WakeIntent, url: string): Promise<WakeIntent> {
    const proof = await this.lbb.call("browser_observe", { tabId: w.tab!.id, include: ["url", "text"],
      text: { position: "tail", maxChars: 1000, contains: w.binding_marker } });
    if (proof.error || !complete(proof, "url")) {
      if (["TAB_NOT_FOUND", "TAB_CLOSED"].includes(proof.code ?? proof.error) && w.conversation_url)
        this.invalidateTab(w, "Sentinel-owned tab disappeared while verifying the binding marker");
      throw new Deferred("Binding marker observation unavailable", "pending");
    }
    if (proof.url !== url || proof.text?.contains?.determinate !== true || proof.text.contains.present !== true)
      throw new Deferred("Binding marker not verified in the opened conversation", "pending");
    if (proof.stateStamp?.sessionEpoch && proof.stateStamp.sessionEpoch !== w.tab!.session_epoch) {
      this.invalidateTab(w, "Browser session changed while verifying the binding marker");
      throw new Deferred("Browser session changed; re-open and re-verify the pinned conversation", "pending");
    }
    this.options.pin(w.task_id, url);
    this.store.updateWake(w.id, x => { x.conversation_url = url; });
    return this.current(w.id);
  }
  private async resolve(w: WakeIntent): Promise<WakeIntent> {
    let o = await this.observe(w, true);
    if (w.actions.some(a => a.kind === "result" && a.outcome === "executed")) {
      if (!conversationUrl.test(o.url)) throw new Deferred("Search navigation rendering pending; do not repeat click", "pending");
      return this.pinVerified(w, o.url);
    }
    if (!complete(o, "controls")) throw new Deferred("Incomplete global search controls");
    let inputs = controls(o, this.labels.searchInput, "textbox");
    if (inputs.length === 0) {
      const search = controls(o, this.labels.search, "button");
      if (search.length !== 1) throw new Deferred("Global Search control ambiguous/unavailable");
      await this.action(w, "search", "browser_click", { tabId: w.tab!.id, ref: search[0]!.ref });
      o = await this.observe(w, true); // Deferred React render: read again, never repeat a dispatched click.
      inputs = controls(o, this.labels.searchInput, "textbox");
    }
    if (!complete(o, "controls") || inputs.length !== 1) throw new Deferred("Search textbox rendering pending", "pending");
    if (!this.current(w.id).actions.some(a => a.kind === "search_type" && a.outcome === "executed")) {
      const r = await this.action(w, "search_type", "browser_type", { tabId: w.tab!.id, ref: inputs[0]!.ref, text: w.binding_marker, mode: "replace" });
      if (!exactWrite(r, w.binding_marker, w.binding_marker.length)) throw new Deferred("Search query not verified");
    }
    o = await this.observe(w, true);
    if (!complete(o, "controls") || !complete(o, "text")) throw new Deferred("Search result scan incomplete");
    const options = (o.controls ?? []).filter((c: BrowserData) => c.role === "option");
    const results = options.length ? options : (o.controls ?? []).filter((c: BrowserData) => c.role === "link" && String(c.label).includes(w.binding_marker));
    if (results.length === 0) throw new Deferred("Marker not indexed yet", "pending");
    if (results.length !== 1 || !results[0].ref) throw new Deferred("Marker search ambiguous; no conversation selected");
    if (!String(o.text?.value ?? "").includes(w.binding_marker)) throw new Deferred("Search results do not yet prove the requested binding marker", "pending");
    await this.action(w, "result", "browser_click", { tabId: w.tab!.id, ref: results[0].ref });
    o = await this.observe(w, true);
    if (!conversationUrl.test(o.url)) throw new Deferred("Search navigation not yet a canonical conversation", "pending");
    // A unique search result is only a navigation hint. Pin the task only after
    // the opened conversation itself proves it contains the unpredictable binding marker.
    return this.pinVerified(this.current(w.id), o.url);
  }
  private async deliver(w: WakeIntent): Promise<void> {
    // After dispatch, only reconcile acceptance: a new Codex turn cannot recall an old UI send.
    if (w.stage !== "dispatched") this.guard(w);
    else if (this.stopped || this.options.paused()) throw new Deferred("Sender paused", "pending");
    await this.options.authorize(w.task_id);
    const status = await this.lbb.call("browser_status", {});
    if (status.connected !== true || status.mode !== "action") throw new Deferred("LBB offline or action authority unavailable", "pending");
    if (w.stage === "prepared" && w.actions.filter(a => a.kind === "append").at(-1)?.outcome === "no_dispatch") {
      this.store.updateWake(w.id, x => { x.stage = "queued"; });
      throw new Deferred("Append confirmed not dispatched; retry prepared safely", "pending");
    }
    if (w.stage === "dispatched" && w.actions.filter(a => a.kind === "send").at(-1)?.outcome === "no_dispatch") {
      this.store.updateWake(w.id, x => { x.stage = "prepared"; });
      throw new Deferred("Send confirmed not dispatched; retry prepared safely", "pending");
    }
    const pendingAction = w.actions.find(a => ["intent", "uncertain"].includes(a.outcome));
    if (pendingAction && pendingAction.kind !== "send") {
      const r = await this.lbb.call("browser_operation", { clientRequestId: pendingAction.id, includeObservation: true });
      if (noDispatch(r)) {
        this.store.updateWake(w.id, x => { x.actions.find(a => a.id === pendingAction.id)!.outcome = "no_dispatch"; if (pendingAction.kind === "open") x.tab_creations--; if (pendingAction.kind === "append") x.stage = "queued"; });
        throw new Deferred("Previous operation definitively not dispatched", "pending");
      }
      if (r.receipt?.actionState !== "executed") throw new Deferred("Previous operation still uncertain", "uncertain");
      if (pendingAction.kind === "append" && !exactWrite(r, wakeMessage(w), wakeMessage(w).length)) throw new Deferred("Append receipt incomplete", "uncertain");
      if (pendingAction.kind === "open") {
        const evidence = r.receipt.result ?? r.receipt.evidence;
        const stamp = evidence?.stateStamp;
        const tabId = evidence?.tabId ?? stamp?.tabId;
        if (!evidence?.operationId || !tabId) throw new Deferred("Open receipt provenance incomplete", "uncertain");
        this.store.updateWake(w.id, x => { x.pending_tab = { id: tabId, creation_operation: evidence.operationId }; });
      }
      this.store.updateWake(w.id, x => { x.actions.find(a => a.id === pendingAction.id)!.outcome = "executed"; });
      w = this.current(w.id);
    }
    w = await this.ownedTab(w);
    // A caller-supplied canonical URL is only a routing hint. Before any write,
    // prove the unpredictable binding marker is actually rendered in that conversation.
    if (w.conversation_url && w.stage !== "dispatched") {
      w = await this.pinVerified(w, w.conversation_url);
      // Read first: a busy conversation must not repeatedly steal foreground focus.
      this.idle(await this.observe(w));
    }
    // Activates only the sentinel-owned tab; necessary for native actions, never adopts a user tab.
    if (w.stage !== "dispatched") await this.action(w, "activate", "browser_switch_tab", { tabId: w.tab!.id, focusWindow: true });
    if (!w.conversation_url) w = await this.resolve(w);
    let o = await this.observe(w);
    const message = wakeMessage(w);
    if (w.stage === "dispatched") {
      const send = w.actions.filter(a => a.kind === "send").at(-1);
      if (send) {
        const receipt = await this.lbb.call("browser_operation", { clientRequestId: send.id, includeObservation: true });
        if (noDispatch(receipt)) {
          this.store.updateWake(w.id, x => { x.actions.find(a => a.id === send.id)!.outcome = "no_dispatch"; x.stage = "prepared"; x.state = "pending"; });
          throw new Deferred("Send definitively not dispatched; retry permitted", "pending");
        }
      }
      if (!this.accepted(o, w)) throw new Deferred("Submission unconfirmed; same receipt only, no resubmit", "uncertain");
      // Rendered unique user-message evidence proves the send happened even if the action receipt was lost.
      if (send) this.store.updateWake(w.id, x => { x.actions.find(a => a.id === send.id)!.outcome = "executed"; });
      w = this.current(w.id);
      await this.probe(w, o, "", true);
      this.store.updateWake(w.id, x => { x.stage = "verified"; x.state = "delivered"; x.detail = "Rendered sent user message and empty composer reconciled without another submission"; });
      return;
    }
    this.idle(o);
    if (w.stage === "queued") {
      if (o.text?.contains?.determinate !== true || o.text.contains.present !== false) throw new Deferred("Cannot prove wake marker absent before submission");
      this.store.updateWake(w.id, x => { x.marker_absent = true; });
      await this.probe(w, o, "");
      o = await this.observe(w); const composer = this.idle(o);
      const r = await this.action(w, "append", "browser_type", { tabId: w.tab!.id, ref: composer.ref, text: message, mode: "append" }, "prepared");
      if (!exactWrite(r, message, message.length)) throw new Deferred("Append unverified; preserve composer", "uncertain");
      w = this.current(w.id);
    }
    // Restart reconciliation above established the exact prepared append receipt.
    o = await this.observe(w); const composer = this.idle(o);
    await this.probe(w, o, message);
    this.guard(this.current(w.id));
    await this.action(w, "send", "browser_press", { tabId: w.tab!.id, ref: composer.ref, key: "Enter" }, "dispatched");
    o = await this.observe(w); // Acceptance can render later; the next cycle verifies without pressing again.
    if (!this.accepted(o, this.current(w.id))) throw new Deferred("Waiting for rendered sent user message", "uncertain");
    await this.probe(this.current(w.id), o, "");
    this.store.updateWake(w.id, x => { x.stage = "verified"; x.state = "delivered"; x.detail = "Rendered unique user message and empty composer verified"; });
  }
}
