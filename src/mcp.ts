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
    { name: "Codex MCP Bridge", version: "0.4.0" },
    {
      capabilities,
      supportedProtocolVersions: ["2026-07-28"],
      instructions:
        "Create a task, subscribe to codex.task_changed for its task_id, then submit the first turn. Read task evidence after each event. Submit follow-up turns only within the user's authorized work, with a unique request_id and current expected_revision. The bridge does not choose prompts. Codex approvals require the local operator.",
    },
  );
  const task_id = z.string().uuid();
  server.registerTool(
    "codex_task_create",
    {
      description:
        "Create a durable task and Codex thread in an operator-authorized workspace. Does not execute a turn; subscribe before submitting.",
      inputSchema: z
        .object({ workspace: z.string().min(1).max(4096) })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ workspace }) => call(() => manager.create(workspace)),
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
        manager.submit(p.task_id, p.prompt, p.request_id, p.expected_revision),
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
