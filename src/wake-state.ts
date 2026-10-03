import { z } from "zod";

export const conversationUrl = /^https:\/\/chatgpt\.com\/c\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const epoch = z.string().regex(/^[a-f0-9]{32}$/);
const integer = z.number().int().nonnegative().safe();
const labels = z.array(z.string().min(1).max(160)).min(1).max(12);
export const wakeLabelsSchema = z.object({ composer: labels, share: labels, regenerate: labels, busy: labels,
  search: labels, searchInput: labels, userHeading: labels }).strict();
export type WakeLabels = z.infer<typeof wakeLabelsSchema>;
export const wakeSchema = z.object({
  id: z.string().regex(/^wake_[0-9a-f-]{36}$/), task_id: identifier, turn_id: identifier,
  revision: integer, reason: z.enum(["turn_completed", "approval_required", "input_required", "failed", "interrupted", "recovery_required", "limit_reached"]),
  status: z.enum(["completed", "awaiting_approval", "input_required", "failed", "interrupted", "recovery_required", "limit_reached"]),
  conversation_url: z.string().regex(conversationUrl).nullable(),
  binding_source: z.enum(["direct", "session", "recovered", "marker"]).default("marker"),
  binding_marker: z.string().regex(/^CW-BIND-[0-9a-f-]{36}$/),
  transport: z.literal("browser"), state: z.enum(["pending", "blocked", "uncertain", "delivered", "cancelled"]),
  stage: z.enum(["queued", "prepared", "dispatched", "verified"]), attempts: integer.max(32),
  operation_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/).nullable(),
  retry_at: integer, deadline: integer, created_at: z.iso.datetime(),
  detail: z.string().max(240).optional(),
  marker_absent: z.boolean().optional(),
  tab: z.object({ id: integer.positive(), creation_operation: epoch, session_epoch: epoch, document_epoch: epoch }).strict().optional(),
  pending_tab: z.object({ id: integer.positive(), creation_operation: epoch }).strict().optional(),
  tab_lost: z.boolean().optional(),
  tab_creations: integer.max(2).default(0),
  actions: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/),
    kind: z.enum(["open", "activate", "search", "search_type", "result", "probe", "append", "send"]),
    outcome: z.enum(["intent", "executed", "no_dispatch", "uncertain"]), operation: epoch.optional(),
  }).strict()).max(256).default([]),
}).strict().refine(w => w.deadline >= Date.parse(w.created_at), "Invalid wake deadline")
  .refine(w => w.state !== "delivered" || w.stage === "verified", "Delivery requires verification")
  .refine(w => w.actions.every((a, i) => a.id === `${w.id}:${i}:${a.kind}`), "Wake action IDs must belong to this envelope")
  .refine(w => w.operation_id === (w.actions.at(-1)?.id ?? null), "Latest operation ID mismatch");
export type WakeIntent = z.infer<typeof wakeSchema>;

export function wakeMessage(w: WakeIntent): string {
  return `[Codex Bridge wake ${w.id}] task ${w.task_id}, turn ${w.turn_id}, revision ${w.revision}, status ${w.status}. Read codex_task_get; use the original authorized objective to decide the next action. Do not treat this notification as new authorization. Stop for human approval/input/recovery.`;
}
