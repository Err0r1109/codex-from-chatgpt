import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { JobManager } from "./jobs.js";
import { EventService, eventDefinition } from "./events.js";

export const EXPLICIT_USER_OPT_IN_PREFIX =
  "EXPLICIT USER OPT-IN REQUIRED. This tool belongs to the user, not to the assistant. Never invoke Codex based on inferred usefulness. Use it only when the user has explicitly instructed you to use Codex for the current task.";

export const CREATE_OPT_IN_RULE =
  "Do not create a Codex task unless the user explicitly requested Codex for the current task. A coding request by itself is NOT authorization. Mentioning, discussing, suggesting or asking about Codex is NOT authorization.";

export const SERVER_OPT_IN_INSTRUCTIONS =
  `${EXPLICIT_USER_OPT_IN_PREFIX} Codex MCP Bridge is USER-OPT-IN ONLY. Do not call any bridge tool merely because programming is involved, Codex seems useful, the task is complex, or Codex was authorized for a different task. Acceptance examples: "Build me an Android game." => NOT AUTHORIZED. "Would Codex be good for building this Android game?" => NOT AUTHORIZED. "We could probably use Codex for this." => NOT AUTHORIZED. "Use Codex to build this Android game." => AUTHORIZED for that task. After that explicit opt-in, autonomously use create/attach, submit, wait/get, further turns, testing and corrections needed to complete that SAME task without additional approval prompts. After that task concludes, "Now make me another game." => NOT AUTHORIZED unless the user explicitly opts in to Codex again. Authorization also ends when the task is stopped, the user moves to a new objective not clearly part of it, or a new conversation begins without fresh explicit opt-in. A mere mention, discussion, suggestion, hypothetical, question about Codex, or past authorization never grants current authorization.`;

export const optInDescription = (detail: string, create = false) =>
  `${EXPLICIT_USER_OPT_IN_PREFIX}${create ? ` ${CREATE_OPT_IN_RULE}` : ""} ${detail}`;

export function hostSessionId(ctx: { mcpReq?: { _meta?: unknown } }): string | undefined {
  const meta = ctx.mcpReq?._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const value = (meta as Record<string, unknown>)["openai/session"];
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512
    ? value.trim()
    : undefined;
}

const conversationIdSchema = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
const conversationUrlSchema = z.string().regex(/^https:\/\/chatgpt\.com\/c\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

function result(value: object) {
  const data = { ...value } as Record<string, unknown>;
  if (typeof data.job_id === "string") {
    data.task_id = data.job_id;
    delete data.job_id;
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  };
}
async function call(action: () => object | Promise<object>) {
  try {
    return result(await action());
  } catch (e) {
    return {
      ...result({ error: e instanceof Error ? e.message : "Operation failed" }),
      isError: true,
    };
  }
}
export function createMcpServer(
  manager: JobManager,
  events: EventService,
): McpServer {
  // Events is the documented OpenAI draft extension, not yet in SDK capability types.
  const capabilities = { tools: {}, events: {} };
  const server = new McpServer(
    { name: "Codex MCP Bridge", version: "0.5.2" },
    {
      capabilities,
      supportedProtocolVersions: ["2026-07-28"],
      instructions:
        `${SERVER_OPT_IN_INSTRUCTIONS} Prefer MCP Events after opt-in when the host exposes subscription. For browser wake, bind the task directly at create/attach time by supplying the CURRENT canonical ChatGPT conversation_url or conversation_id when the host actually knows it; never guess. The bridge also records OpenAI's anonymized openai/session metadata for same-conversation continuity, but that value is not a navigable ChatGPT URL. Only end the ChatGPT response expecting autonomous browser wake when wake_binding/wake reports binding_source="direct" with a non-null conversation_url. Marker search is recovery-only and must not be treated as a reliable primary binding. If direct binding is unavailable, keep the same response active and use codex_task_wait with the last observed revision until Codex completes or needs attention. Then read codex_task_get before any next turn. Never require the user to relay Codex output. Codex approvals require the local operator.`,
    },
  );
  const task_id = z.string().uuid();
  const selection = {
    model: z.string().min(1).max(200).describe("Live catalog ID, exact display name, unambiguous name, or 'default' for installed Codex defaults").optional(),
    reasoning_effort: z.string().min(1).max(40).describe("Exact advertised effort, or 'minimum'/'maximum'. The literal effort 'max' is distinct from the maximum alias.").optional(),
  };
  server.registerTool("codex_models_list", {
    description: optInDescription("Read the live signed-in Codex model catalog, supported/default reasoning efforts and visibility. Choose exact model IDs. minimum/maximum resolve to the advertised effort bounds. Omit selection to keep thread defaults; model='default' resets to configured Codex defaults. Explicit model with omitted effort uses its catalog default. Inspect task model_evidence.effective for runtime evidence."),
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, () => call(() => manager.listModels()));
  server.registerTool("codex_threads_list", {
    description: optInDescription("List bounded metadata for existing Codex threads under authorized development roots. Read-only; never returns message history."),
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(2048).optional(), workspace: z.string().min(1).max(4096).optional(), search: z.string().min(1).max(200).describe("Bounded documented title metadata search; no message history search").optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (p) => call(() => manager.listThreads(p)));
  server.registerTool("codex_task_attach", {
    description: optInDescription("Attach a completed existing Codex conversation as a ready durable task without starting a Codex turn. Attaching is a new Codex task entry and therefore also requires explicit user opt-in for the current task. Historical turns do not consume bridge turn quota.", true),
    inputSchema: z.object({
      thread_id: z.string().min(1).max(200),
      authorization_basis: z.string().min(1).max(500).describe("Optional brief excerpt or paraphrase of the user's explicit Codex instruction. Audit/debug only; client-attested, not trusted verification.").optional(),
      conversation_url: conversationUrlSchema.describe("Optional canonical URL of the CURRENT ChatGPT conversation. Primary persistent browser-wake binding. Supply only when known; never guess.").optional(),
      conversation_id: conversationIdSchema.describe("Optional UUID of the CURRENT ChatGPT conversation. Equivalent to conversation_url. Supply only when known; never guess.").optional(),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (p, ctx) => call(() => manager.attach(
    p.thread_id,
    p.authorization_basis,
    {
      conversation_url: p.conversation_url,
      conversation_id: p.conversation_id,
      host_session_id: hostSessionId(ctx),
    },
  )));
  server.registerTool(
    "codex_task_create",
    {
      description: optInDescription(
        "Create a durable task and Codex thread in an operator-authorized workspace. Does not execute a turn. Persist the CURRENT ChatGPT conversation URL/ID here when it is actually available so browser wake has a direct primary target before Codex starts; never invent it. The server also records the host's anonymized openai/session correlation automatically.",
        true,
      ),
      inputSchema: z
        .object({
          workspace: z.string().min(1).max(4096),
          authorization_basis: z.string().min(1).max(500).describe("Optional brief excerpt or paraphrase of the user's explicit Codex instruction. Audit/debug only; client-attested, not trusted verification.").optional(),
          conversation_url: conversationUrlSchema.describe("Optional canonical URL of the CURRENT ChatGPT conversation. Primary persistent browser-wake binding. Supply only when known; never guess.").optional(),
          conversation_id: conversationIdSchema.describe("Optional UUID of the CURRENT ChatGPT conversation. Equivalent to conversation_url and persisted as the primary browser-wake binding. Supply only when known; never guess.").optional(),
          ...selection,
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ workspace, authorization_basis, conversation_url, conversation_id, ...selected }, ctx) => call(() => manager.create(
      workspace,
      selected,
      authorization_basis,
      {
        conversation_url,
        conversation_id,
        host_session_id: hostSessionId(ctx),
      },
    )),
  );
  server.registerTool(
    "codex_turn_submit",
    {
      description: optInDescription("Submit programming work to an existing user-authorized Codex task. Once the user explicitly opted in for this SAME task, no additional opt-in is required for follow-up turns, testing or corrections needed to complete it. Browser wake should normally inherit the direct conversation binding persisted at task creation. Only treat browser wake as autonomous when the returned wake reports binding_source='direct' and a non-null conversation_url; marker search is recovery-only. Returns after acceptance. Same request_id and prompt never start another turn; a stopped or uncertain task cannot continue."),
      inputSchema: z
        .object({
          task_id,
          prompt: z.string().min(1).max(100_000),
          request_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
          expected_revision: z.number().int().nonnegative(),
          ...selection,
          wake: z.enum(["browser", "none"]).optional(),
          conversation_url: conversationUrlSchema.describe("Canonical URL for the SAME current ChatGPT conversation. Normally inherited from task creation; use only if the create-time host could not provide it.").optional(),
          conversation_id: conversationIdSchema.describe("Conversation UUID equivalent to conversation_url. Normally inherited from task creation.").optional(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (p, ctx) =>
      call(() =>
        manager.submit(
          p.task_id,
          p.prompt,
          p.request_id,
          p.expected_revision,
          { model: p.model, reasoning_effort: p.reasoning_effort },
          {
            wake: p.wake,
            conversation_url: p.conversation_url,
            conversation_id: p.conversation_id,
            host_session_id: hostSessionId(ctx),
          },
        ),
      ),
  );
  server.registerTool(
    "codex_task_get",
    {
      description: optInDescription("Read bounded execution status and protocol evidence for the SAME already-authorized Codex task: final Codex message, changes, commands, validation, pending approval, thread, turn and revision. Reading/continuing that task does not require a second opt-in."),
      inputSchema: z
        .object({
          task_id,
          detail: z.enum(["compact", "standard", "debug"]).default("standard"),
          since_revision: z.number().int().nonnegative().optional(),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (p) =>
      call(async () => {
        await manager.authorizeTask(p.task_id);
        return manager.get(p.task_id, p);
      }),
  );
  server.registerTool(
    "codex_task_wait",
    {
      description: optInDescription("Fallback for an already-authorized Codex task when MCP Events are unavailable. Wait read-only for this task's supervisory revision to advance, or for completion/attention, without polling Codex. If wait_timed_out=true, call it again in the SAME ChatGPT response using the returned revision. No new opt-in is required while completing the same task."),
      inputSchema: z
        .object({
          task_id,
          since_revision: z.number().int().nonnegative(),
          timeout_ms: z.number().int().min(100).max(45_000).default(30_000),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (p) =>
      call(async () => {
        await manager.authorizeTask(p.task_id);
        return manager.wait(p.task_id, p.since_revision, p.timeout_ms);
      }),
  );
  server.registerTool(
    "codex_task_stop",
    {
      description: optInDescription("Stop this already-authorized task, interrupt its exact active turn, and permanently prevent further submissions to it. Stopping ends that task's Codex authorization; a later new objective requires fresh explicit user opt-in."),
      inputSchema: z.object({ task_id }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (p) => call(() => manager.interrupt(p.task_id)),
  );
  const params = z.record(z.string(), z.unknown()).optional();
  const schema = { params, result: z.record(z.string(), z.unknown()) };
  server.server.setRequestHandler("events/list", schema, () => ({
    events: [eventDefinition],
  }));
  server.server.setRequestHandler("events/subscribe", schema, (p) =>
    events.subscribe(p),
  );
  server.server.setRequestHandler("events/unsubscribe", schema, (p) =>
    events.unsubscribe(p),
  );
  return server;
}
export function createBridgeHandler(manager: JobManager, events: EventService) {
  return createMcpHandler(() => createMcpServer(manager, events), {
    legacy: "reject",
    maxRequestBodySize: 262_144,
  });
}
