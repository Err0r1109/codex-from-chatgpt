import { z } from "zod";

export const subscriptionSchema = z.object({
  id: z.string(),
  owner: z.string(),
  taskId: z.string(),
  url: z.string(),
  secret: z.string(),
  expiresAt: z.number(),
  verifiedUntil: z.number(),
  previousSecret: z.string().optional(),
  rotateUntil: z.number().optional(),
});
export const eventSchema = z.object({
  eventId: z.string(),
  name: z.literal("codex.task_changed"),
  timestamp: z.string(),
  cursor: z.null(),
  data: z.object({
    task_id: z.string(),
    revision: z.number().int(),
    status: z.string(),
    reason: z.string(),
    turn_id: z.string().optional(),
  }),
});
export const eventStateSchema = z.object({
  subscriptions: z.array(subscriptionSchema),
  outbox: z.array(
    z.object({
      subscriptionId: z.string(),
      event: eventSchema,
      attempts: z.number().int().nonnegative(),
      nextAttempt: z.number(),
      state: z.enum(["pending", "delivered", "abandoned"]),
      lastStatus: z.number().optional(),
    }),
  ),
  transitions: z.record(z.string(), z.string()),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
export type BridgeEvent = z.infer<typeof eventSchema>;
export type EventState = z.infer<typeof eventStateSchema>;
export function emptyEvents(): EventState {
  return { subscriptions: [], outbox: [], transitions: {} };
}
