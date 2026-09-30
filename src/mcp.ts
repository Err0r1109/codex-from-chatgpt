import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { JobManager } from "./jobs.js";
import { EventService, eventDefinition } from "./events.js";

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
        "Prefer MCP Events: create a task, subscribe to codex.task_changed, then submit. If this ChatGPT host cannot subscribe to Events, keep the same Work response active and use codex_task_wait with the last observed revision until Codex completes or needs attention; on timeout, wait again using the returned revision. Then read evidence and submit the next turn. Never require the user to relay Codex output. Codex approvals require the local operator.",
    },
  );
  const task_id = z.string().uuid();
  const selection = {
    model: z.string().min(1).max(200).describe("Live catalog ID, exact display name, unambiguous name, or 'default' for installed Codex defaults").optional(),
    reasoning_effort: z.string().min(1).max(40).describe("Exact advertised effort, or 'minimum'/'maximum'. The literal effort 'max' is distinct from the maximum alias.").optional(),
  };
  server.registerTool("codex_models_list", {
    description: "Read the live signed-in Codex model catalog, supported/default reasoning efforts and visibility. Choose exact model IDs. minimum/maximum resolve to the advertised effort bounds. Omit selection to keep thread defaults; model='default' resets to configured Codex defaults. Explicit model with omitted effort uses its catalog default. Inspect task model_evidence.effective for runtime evidence.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, () => call(() => manager.listModels()));
  server.registerTool(
    "codex_task_create",
    {
      description:
        "Create a durable task and Codex thread in an operator-authorized workspace. Does not execute a turn; subscribe before submitting.",
      inputSchema: z
        .object({ workspace: z.string().min(1).max(4096), ...selection })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ workspace, ...selected }) => call(() => manager.create(workspace, selected)),
  );
  server.registerTool(
    "codex_turn_submit",
    {
      description:
        "Submit programming work to the existing Codex thread. Returns after acceptance. Same request_id and prompt never start another turn; a stopped or uncertain task cannot continue.",
      inputSchema: z
        .object({
          task_id,
          prompt: z.string().min(1).max(100_000),
          request_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
          expected_revision: z.number().int().nonnegative(),
          ...selection,
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (p) =>
      call(() =>
        manager.submit(p.task_id, p.prompt, p.request_id, p.expected_revision, { model: p.model, reasoning_effort: p.reasoning_effort }),
      ),
  );
  server.registerTool(
    "codex_task_get",
    {
      description:
        "Read bounded execution status and protocol evidence: final Codex message, changes, commands, validation, pending approval, thread, turn and revision.",
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
      description:
        "Fallback for ChatGPT hosts without MCP Events. Wait read-only for this task's supervisory revision to advance, or for completion/attention, without polling Codex. If wait_timed_out=true, call it again in the SAME ChatGPT response using the returned revision.",
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
      description:
        "Stop this task, interrupt its exact active turn, and permanently prevent further submissions to it.",
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
