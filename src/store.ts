import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  emptyEvents,
  eventStateSchema,
  type EventState,
} from "./event-state.js";
import { makePrivate } from "./private-files.js";
import type { Settings, TurnModelEvidence } from "./models.js";
import { settingsSchema, evidenceSchema } from "./models.js";

export const STATE_VERSION = 3;


export { type WakeIntent } from "./wake-state.js";
import { wakeSchema, conversationUrl, type WakeIntent } from "./wake-state.js";

export type PersistedJob = {
  thread_settings?: Settings | null;
  model_evidence?: TurnModelEvidence[];
  job_id: string;
  thread_id: string | null;
  workspace: string;
  authorization?: {
    user_authorized: true;
    basis: string | null;
    recorded_at: string;
    source: "client-attested-explicit-user-opt-in";
  };
  turn_id: string | null;
  status: string;
  final_message: string | null;
  latest_diff: string | null;
  files_changed: string[];
  commands_executed: string[];
  command_evidence?: Array<{
    command: string;
    status: string;
    exit_code?: number;
  }>;
  error: string | null;
  updated_at: string;
  /** Added in v0.2. Older state files omit this and migrate to revision 0. */
  revision?: number;
  validation?: PersistedValidation[];
  warnings?: string[];
  activity?: string | null;
  completion_report_injected?: boolean;
  turn_count?: number;
  historical_turn_count?: number;
  requests?: Record<
    string,
    { hash: string; hash_version?: 2 | 3; turn_id: string | null; previous_turn_id?: string | null; wake?: "browser" | "none" | "events" }
  >;
  stopped?: boolean;
  wake?: {
    enabled: boolean;
    conversation_url: string | null;
    conversation_id?: string | null;
    host_session_id?: string | null;
    binding_source?: "direct" | "session" | "recovered" | "marker";
    binding_marker: string;
  };
  deadline?: number | null;
};

export type PersistedValidation = {
  kind: string;
  command: string;
  status: string;
  exit_code?: number;
  output_tail?: string;
};

type PersistedState = {
  version: number;
  jobs: PersistedJob[];
  events?: EventState;
  wakes?: WakeIntent[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return value === null ? null : typeof value === "string" ? value : null;
}

function optionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function validValidation(value: unknown): value is PersistedValidation {
  if (!isObject(value)) return false;
  return (
    typeof value.kind === "string" &&
    value.kind.length > 0 &&
    typeof value.command === "string" &&
    value.command.length > 0 &&
    typeof value.status === "string" &&
    value.status.length > 0 &&
    (value.exit_code === undefined ||
      (typeof value.exit_code === "number" &&
        Number.isInteger(value.exit_code))) &&
    (value.output_tail === undefined || typeof value.output_tail === "string")
  );
}

function validJob(value: unknown): value is PersistedJob {
  if (!isObject(value)) return false;
  if (value.thread_settings != null && !settingsSchema.safeParse(value.thread_settings).success) return false;
  if (value.model_evidence !== undefined && !evidenceSchema.safeParse(value.model_evidence).success) return false;
  return (
    typeof value.job_id === "string" &&
    value.job_id.length > 0 &&
    (value.thread_id === null ||
      (typeof value.thread_id === "string" && value.thread_id.length > 0)) &&
    typeof value.workspace === "string" &&
    value.workspace.length > 0 &&
    (value.authorization === undefined ||
      (isObject(value.authorization) &&
        value.authorization.user_authorized === true &&
        optionalNullableString(value.authorization.basis) &&
        typeof value.authorization.recorded_at === "string" &&
        value.authorization.recorded_at.length > 0 &&
        value.authorization.source === "client-attested-explicit-user-opt-in")) &&
    (value.turn_id === null || typeof value.turn_id === "string") &&
    typeof value.status === "string" &&
    nullableString(value.final_message) === value.final_message &&
    nullableString(value.latest_diff) === value.latest_diff &&
    Array.isArray(value.files_changed) &&
    value.files_changed.every((item) => typeof item === "string") &&
    Array.isArray(value.commands_executed) &&
    value.commands_executed.every((item) => typeof item === "string") &&
    nullableString(value.error) === value.error &&
    typeof value.updated_at === "string" &&
    (value.revision === undefined ||
      (typeof value.revision === "number" &&
        Number.isInteger(value.revision) &&
        value.revision >= 0)) &&
    (value.validation === undefined ||
      (Array.isArray(value.validation) &&
        value.validation.every(validValidation))) &&
    (value.warnings === undefined ||
      (Array.isArray(value.warnings) &&
        value.warnings.every((item) => typeof item === "string"))) &&
    optionalNullableString(value.activity) &&
    (value.completion_report_injected === undefined ||
      typeof value.completion_report_injected === "boolean") &&
    (value.turn_count === undefined ||
      (Number.isInteger(value.turn_count) && Number(value.turn_count) >= 0)) &&
    (value.historical_turn_count === undefined ||
      (Number.isInteger(value.historical_turn_count) && Number(value.historical_turn_count) >= 0)) &&
    (value.stopped === undefined || typeof value.stopped === "boolean") &&
    (value.wake === undefined || (
      isObject(value.wake) &&
      typeof value.wake.enabled === "boolean" &&
      optionalNullableString(value.wake.conversation_url) &&
      optionalNullableString(value.wake.conversation_id) &&
      optionalNullableString(value.wake.host_session_id) &&
      (value.wake.binding_source === undefined || ["direct", "session", "recovered", "marker"].includes(String(value.wake.binding_source))) &&
      typeof value.wake.binding_marker === "string" &&
      /^CW-BIND-[0-9a-f-]{36}$/.test(value.wake.binding_marker) &&
      (value.wake.conversation_url === null || typeof value.wake.conversation_url === "string" && conversationUrl.test(value.wake.conversation_url)) &&
      (value.wake.conversation_id === undefined || value.wake.conversation_id === null || /^[0-9a-f-]{36}$/i.test(String(value.wake.conversation_id))) &&
      (value.wake.host_session_id === undefined || value.wake.host_session_id === null || String(value.wake.host_session_id).length <= 512)
    )) &&
    (value.deadline === undefined ||
      value.deadline === null ||
      (typeof value.deadline === "number" &&
        Number.isFinite(value.deadline))) &&
    (value.requests === undefined ||
      (isObject(value.requests) &&
        Object.values(value.requests).every(
          (r) =>
            isObject(r) &&
            typeof r.hash === "string" &&
            (r.hash_version === undefined || r.hash_version === 2 || r.hash_version === 3) &&
            (r.wake === undefined || r.wake === "browser" || r.wake === "none" || r.wake === "events") &&
            (r.turn_id === null || typeof r.turn_id === "string") &&
            optionalNullableString(r.previous_turn_id),
        )))
  );
}

function defaultState(): PersistedState {
  return { version: STATE_VERSION, jobs: [] };
}

function assertUnambiguousJobs(jobs: PersistedJob[]): void {
  const jobIds = new Set<string>();
  const threadIds = new Set<string>();
  for (const job of jobs) {
    if (jobIds.has(job.job_id))
      throw new Error(`state ambiguo: job_id duplicado (${job.job_id})`);
    jobIds.add(job.job_id);
    if (job.thread_id !== null) {
      if (threadIds.has(job.thread_id))
        throw new Error(
          `state ambiguo: thread_id duplicado (${job.thread_id})`,
        );
      threadIds.add(job.thread_id);
    }
  }
}

export function defaultStateFile(): string {
  return path.join(os.homedir(), ".codex-agent-mcp", "state.json");
}

export class StateStore {
  readonly filePath: string;
  private readonly enforcePrivateAcl: boolean;
  private diagnostic: string | null = null;
  private jobs: PersistedJob[] = [];
  private events: EventState = emptyEvents();
  private readonly listeners = new Set<() => void>();
  private wakes: WakeIntent[] = [];

  jobsSnapshot(): PersistedJob[] { return structuredClone(this.jobs); }
  wakeIntents(): WakeIntent[] { return structuredClone(this.wakes); }
  updateWake(id: string, change: (wake: WakeIntent) => void): void {
    const next = this.wakes.map((wake) => structuredClone(wake));
    const wake = next.find((entry) => entry.id === id);
    if (!wake) throw new Error("Wake intent not found");
    change(wake);
    this.publish(this.jobs, this.eventState(), next);
  }
  hasActiveSubscription(taskId: string): boolean { return this.events.subscriptions.some((sub) => sub.taskId === taskId && sub.expiresAt > Date.now()); }

  eventState(): EventState {
    return structuredClone(this.events);
  }
  onCommit(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  updateEvents(change: (state: EventState) => void): void {
    const next = this.eventState();
    change(next);
    this.publish(this.jobs, next);
  }

  constructor(
    filePath = process.env.CODEX_AGENT_STATE_FILE ?? defaultStateFile(),
    options: { enforcePrivateAcl?: boolean } = {},
  ) {
    this.filePath = path.resolve(filePath);
    // Runtime callers never disable this. The option exists so high-write unit
    // fixtures can test state semantics without spawning icacls.exe per save.
    this.enforcePrivateAcl = options.enforcePrivateAcl ?? true;
  }

  getDiagnostic(): string | null {
    return this.diagnostic;
  }

  load(): PersistedJob[] {
    this.diagnostic = null;
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (error) {
      if (isObject(error) && error.code === "ENOENT") return [];
      this.diagnostic = `No se pudo leer el state local ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`;
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        !isObject(parsed) ||
        typeof parsed.version !== "number" || ![1, 2, STATE_VERSION].includes(parsed.version) ||
        !Array.isArray(parsed.jobs)
      ) {
        throw new Error(
          `versión o forma no soportada (se esperaba version=${STATE_VERSION})`,
        );
      }
      const jobs = parsed.jobs.filter(validJob);
      if (jobs.length !== parsed.jobs.length) {
        throw new Error(
          "uno o más jobs persistidos no tienen un schema válido",
        );
      }
      assertUnambiguousJobs(jobs);
      this.events =
        Number(parsed.version) === 1
          ? emptyEvents()
          : eventStateSchema.parse(parsed.events);
      const wakes = Number(parsed.version) === 3 ? parsed.wakes : [];
      this.wakes = wakeSchema.array().parse(wakes ?? []);
      this.jobs = jobs;
      return jobs;
    } catch (error) {
      this.diagnostic = `State local corrupto o incompatible en ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`;
      return [];
    }
  }

  save(jobs: PersistedJob[]): void {
    if (this.diagnostic)
      throw new Error("Refusing to overwrite unreadable state");
    const next = this.eventState();
    const reasons: Record<string, string> = {
      completed: "turn_completed",
      awaiting_approval: "approval_required",
      input_required: "input_required",
      failed: "failed",
      interrupted: "interrupted",
      recovery_required: "recovery_required",
      limit_reached: "limit_reached",
    };
    for (const job of jobs) {
      const key = JSON.stringify([
        job.status,
        job.turn_id,
        job.status === "awaiting_approval" ? job.revision : null,
      ]);
      if (next.transitions[job.job_id] === key) continue;
      next.transitions[job.job_id] = key;
      const reason = reasons[job.status];
      if (!reason) continue;
      const event = {
        eventId: `evt_${randomUUID()}`,
        name: "codex.task_changed" as const,
        timestamp: new Date().toISOString(),
        cursor: null,
        data: {
          task_id: job.job_id,
          revision: job.revision ?? 0,
          status: job.status,
          reason,
          ...(job.turn_id ? { turn_id: job.turn_id } : {}),
        },
      };
      const selected = Object.values(job.requests ?? {}).find(r => r.turn_id === job.turn_id)?.wake;
      if (selected === "browser" || selected === "none") continue;
      for (const sub of next.subscriptions.filter(
        (s) => s.taskId === job.job_id && s.expiresAt > Date.now(),
      )) {
        next.outbox.push({
          subscriptionId: sub.id,
          event,
          attempts: 0,
          nextAttempt: Date.now(),
          state: "pending",
        });
      }
    }
    const wakes = this.wakeIntents();
    for (const job of jobs) {
      const reason = reasons[job.status];
      if (!reason || !job.turn_id) continue;
      const request = Object.values(job.requests ?? {}).find((entry) => entry.turn_id === job.turn_id);
      const transport: "events" | "browser" = request?.wake === "events" ? "events" : "browser";
      if (transport === "browser" && (request?.wake !== "browser" || !job.wake?.enabled)) continue;
      const revisionSensitive = reason === "approval_required" || reason === "input_required";
      if (wakes.some((wake) =>
        wake.task_id === job.job_id &&
        wake.turn_id === job.turn_id &&
        wake.reason === reason &&
        (!revisionSensitive || wake.revision === (job.revision ?? 0))
      )) continue;
      if (transport === "events" || job.stopped) continue;
      wakes.push(wakeSchema.parse({
        id: `wake_${randomUUID()}`,
        task_id: job.job_id,
        turn_id: job.turn_id,
        revision: job.revision ?? 0,
        reason,
        status: job.status,
        conversation_url: job.wake?.conversation_url ?? null,
        binding_source: job.wake?.binding_source ?? (job.wake?.conversation_url ? "recovered" : job.wake?.host_session_id ? "session" : "marker"),
        binding_marker: job.wake?.binding_marker ?? "",
        transport: "browser",
        state: "pending",
        stage: "queued",
        attempts: 0,
        operation_id: null,
        retry_at: Date.now(),
        deadline: Date.now() + 24 * 60 * 60 * 1000,
        created_at: new Date().toISOString(),
        actions: [],
        tab_creations: 0,
      }));
    }
    for (const wake of wakes) {
      const job = jobs.find(j => j.job_id === wake.task_id);
      if (!["delivered", "cancelled"].includes(wake.state) && (!job || job.stopped || !job.wake?.enabled || job.turn_id !== wake.turn_id || job.status !== wake.status)) {
        if (wake.stage === "dispatched") {
          wake.state = "uncertain"; wake.detail = "Already dispatched; reconcile acceptance only";
        } else { wake.state = "cancelled"; wake.detail = "Stopped, disarmed or superseded"; }
      }
    }
    this.publish(jobs, next, wakes);
  }

  private publish(jobs: PersistedJob[], events: EventState, wakes = this.wakeIntents()): void {
    if (this.diagnostic)
      throw new Error("Refusing to overwrite unreadable state");
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true });
    if (this.enforcePrivateAcl) makePrivate(directory, true);
    try {
      if (!statSync(directory).isDirectory()) {
        throw new Error("la ruta de state no es un directorio");
      }
    } catch (error) {
      throw new Error(
        `No se puede preparar el state local: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const payload: PersistedState = { version: STATE_VERSION, jobs, events, wakes };
    assertUnambiguousJobs(jobs);
    wakeSchema.array().parse(wakes);
    const temporary = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      if (process.platform === "win32" && this.enforcePrivateAcl) makePrivate(temporary);
      const fd = openSync(temporary, "r+");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, this.filePath);
      if (process.platform !== "win32") {
        const dir = openSync(directory, "r");
        try {
          fsyncSync(dir);
        } finally {
          closeSync(dir);
        }
      }
      // chmod is intentional even after replacement: it also repairs an existing
      // state file that had been created with broader permissions.
      chmodSync(this.filePath, 0o600);
      this.jobs = structuredClone(jobs);
      this.events = structuredClone(events);
      this.wakes = structuredClone(wakes);
    } catch (error) {
      try {
        // Best effort only; the original state remains untouched if rename failed.
        unlinkSync(temporary);
      } catch {
        // Ignore cleanup failure and preserve the original diagnostic.
      }
      throw new Error(
        `No se pudo publicar el state local atómicamente: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const listener of this.listeners) listener();
  }
}
