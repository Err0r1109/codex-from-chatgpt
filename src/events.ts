import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ProtocolError } from "@modelcontextprotocol/server";
import { z } from "zod";
import { StateStore } from "./store.js";
import {
  callbackUrl,
  safeWebhookSend,
  signedPost,
  type WebhookSend,
} from "./webhook.js";
import type { Subscription } from "./event-state.js";

const base = z
  .object({
    name: z.literal("codex.task_changed"),
    arguments: z.object({ task_id: z.string().uuid() }).strict(),
    delivery: z
      .object({
        mode: z.literal("webhook"),
        url: z.string().max(4096),
        secret: z.string().optional(),
      })
      .strict(),
    cursor: z.null().optional(),
    ttlMs: z.number().int().positive().nullable().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const eventDefinition = {
  name: "codex.task_changed",
  description:
    "A durable Codex task state changed. Filter by task ID; read codex_task_get for execution evidence.",
  delivery: ["webhook"],
  inputSchema: {
    type: "object",
    properties: { task_id: { type: "string" } },
    required: ["task_id"],
    additionalProperties: false,
  },
  payloadSchema: {
    type: "object",
    properties: {
      task_id: { type: "string" },
      revision: { type: "integer" },
      status: { type: "string" },
      reason: { type: "string" },
      turn_id: { type: "string" },
    },
    required: ["task_id", "revision", "status", "reason"],
    additionalProperties: false,
  },
};
export class EventService {
  private timer?: NodeJS.Timeout;
  private delivering = false;
  private closed = false;
  private unsubscribeCommit?: () => void;
  private readonly changes = new Map<string, number>();
  constructor(
    readonly store: StateStore,
    private readonly authorizeTask: (id: string) => void | Promise<void>,
    private readonly send: WebhookSend = safeWebhookSend,
    private readonly now = Date.now,
    private readonly owner = "private-operator",
  ) {}

  private identity(p: z.infer<typeof base>): string {
    return `sub_${createHash("sha256")
      .update(
        JSON.stringify([
          this.owner,
          p.delivery.url,
          p.name,
          { task_id: p.arguments.task_id },
        ]),
      )
      .digest("hex")}`;
  }
  async subscribe(params: unknown) {
    const parsed = base.safeParse(params);
    if (!parsed.success)
      throw new ProtocolError(-32602, "Invalid event subscription");
    const p = parsed.data;
    await this.authorizeTask(p.arguments.task_id);
    try {
      callbackUrl(p.delivery.url);
    } catch {
      throw new ProtocolError(-32015, "Callback rejected", {
        reason: "unsafe_callback",
      });
    }
    const secret = p.delivery.secret ?? "";
    const encoded = secret.slice(6);
    const key = Buffer.from(encoded, "base64");
    if (
      !secret.startsWith("whsec_") ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
      key.length < 24 ||
      key.length > 64 ||
      key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
    )
      throw new ProtocolError(-32602, "Invalid signing secret");
    const id = this.identity(p),
      now = this.now();
    const generation = (this.changes.get(id) ?? 0) + 1;
    this.changes.set(id, generation);
    const existing = this.store
      .eventState()
      .subscriptions.find((s) => s.id === id);
    const verified = this.store
      .eventState()
      .subscriptions.find(
        (s) =>
          s.owner === this.owner &&
          s.url === p.delivery.url &&
          s.secret === secret &&
          s.verifiedUntil > now,
      );
    const sub: Subscription = {
      id,
      owner: this.owner,
      taskId: p.arguments.task_id,
      url: p.delivery.url,
      secret,
      expiresAt: now + Math.min(p.ttlMs ?? 86_400_000, 86_400_000),
      verifiedUntil: now + 300_000,
    };
    if (!verified) {
      const challenge = randomBytes(32).toString("hex");
      try {
        const result = await signedPost(
          sub,
          `msg_verification_${randomBytes(16).toString("hex")}`,
          { type: "verification", challenge },
          this.send,
          now,
        );
        const echo: unknown = JSON.parse(result.body).challenge;
        if (
          result.status < 200 ||
          result.status >= 300 ||
          typeof echo !== "string" ||
          Buffer.byteLength(echo) !== Buffer.byteLength(challenge) ||
          !timingSafeEqual(Buffer.from(echo), Buffer.from(challenge))
        )
          throw new Error("challenge_failed");
      } catch (error) {
        const reason =
          error instanceof Error && /timeout|abort/i.test(error.message)
            ? "timeout"
            : "challenge_failed";
        throw new ProtocolError(-32015, "Callback verification failed", {
          reason,
        });
      }
    } else sub.verifiedUntil = verified.verifiedUntil;
    if (existing && existing.secret !== secret) {
      sub.previousSecret = existing.secret;
      sub.rotateUntil = now + 300_000;
    } else if (existing?.previousSecret && (existing.rotateUntil ?? 0) > now) {
      sub.previousSecret = existing.previousSecret;
      sub.rotateUntil = existing.rotateUntil;
    }
    await this.authorizeTask(sub.taskId);
    if (this.changes.get(id) !== generation)
      throw new ProtocolError(-32602, "Subscription superseded or cancelled");
    this.store.updateEvents((s) => {
      s.subscriptions = s.subscriptions.filter((x) => x.id !== id);
      s.subscriptions.push(sub);
    });
    return {
      id,
      refreshBefore: new Date(sub.expiresAt).toISOString(),
      cursor: null,
      truncated: false,
    };
  }
  unsubscribe(params: unknown) {
    const parsed = base.safeParse(params);
    if (!parsed.success) throw new ProtocolError(-32602, "Invalid unsubscribe");
    const id = this.identity(parsed.data);
    this.changes.set(id, (this.changes.get(id) ?? 0) + 1);
    this.store.updateEvents((s) => {
      s.subscriptions = s.subscriptions.filter((x) => x.id !== id);
      for (const d of s.outbox)
        if (d.subscriptionId === id && d.state === "pending")
          d.state = "abandoned";
    });
    return {};
  }
  start(): void {
    this.closed = false;
    this.unsubscribeCommit = this.store.onCommit(() => this.schedule());
    this.schedule();
  }
  stop(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.unsubscribeCommit?.();
  }
  private schedule(): void {
    if (this.closed || this.delivering) return;
    clearTimeout(this.timer);
    const pending = this.store
      .eventState()
      .outbox.filter((x) => x.state === "pending");
    if (!pending.length) return;
    const delay = Math.max(
      0,
      Math.min(...pending.map((x) => x.nextAttempt)) - this.now(),
    );
    this.timer = setTimeout(
      () =>
        void this.drain().catch(() => {
          console.error("Event outbox unavailable; delivery paused");
          this.stop();
        }),
      Math.min(delay, 2_147_000_000),
    );
    this.timer.unref();
  }
  async drain(): Promise<void> {
    if (this.delivering) return;
    this.delivering = true;
    try {
      for (const entry of this.store
        .eventState()
        .outbox.filter(
          (x) => x.state === "pending" && x.nextAttempt <= this.now(),
        )) {
        const sub = this.store
          .eventState()
          .subscriptions.find(
            (s) =>
              s.id === entry.subscriptionId &&
              s.owner === this.owner &&
              s.expiresAt > this.now(),
          );
        let status = 0,
          revoked = !sub;
        if (sub) {
          try {
            await this.authorizeTask(sub.taskId);
          } catch {
            revoked = true;
          }
          if (
            !this.store
              .eventState()
              .subscriptions.some(
                (s) => s.id === sub.id && s.expiresAt > this.now(),
              )
          )
            revoked = true;
          if (!revoked)
            try {
              status = (
                await signedPost(
                  sub,
                  entry.event.eventId,
                  entry.event,
                  this.send,
                  this.now(),
                )
              ).status;
            } catch (error) {
              if (
                error instanceof Error &&
                /unsafe_|redirect_blocked|payload_too_large|response_too_large/.test(
                  error.message,
                )
              )
                status = 400;
            }
        }
        this.store.updateEvents((s) => {
          const current = s.outbox.find(
            (x) =>
              x.event.eventId === entry.event.eventId &&
              x.subscriptionId === entry.subscriptionId,
          );
          if (!current || current.state !== "pending") return;
          current.attempts++;
          current.lastStatus = status;
          const transient =
            status === 0 || status === 408 || status === 429 || status >= 500;
          current.state =
            status >= 200 && status < 300
              ? "delivered"
              : revoked || !transient || current.attempts >= 8
                ? "abandoned"
                : "pending";
          current.nextAttempt =
            this.now() + Math.min(300_000, 1000 * 2 ** current.attempts);
          if (status === 410 || revoked)
            s.subscriptions = s.subscriptions.filter(
              (x) => x.id !== entry.subscriptionId,
            );
          // Keep a bounded receipt tail. Pending deliveries are never pruned.
          const receipts = s.outbox
            .filter((x) => x.state !== "pending")
            .slice(-200);
          s.outbox = [
            ...s.outbox.filter((x) => x.state === "pending"),
            ...receipts,
          ];
        });
      }
    } finally {
      this.delivering = false;
      this.schedule();
    }
  }
}
