import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

import type { ApprovalDecision, JobManager } from "./jobs.js";

const MAX_BODY_BYTES = 64 * 1024;

type JobControl = Pick<
  JobManager,
  "get" | "respondApproval" | "respondInput" | "wakeStatus" | "setWakePaused"
>;

export type OperatorControlOptions = {
  port: number;
  token: string;
  shutdown: () => Promise<void>;
};

function writeJson(
  response: import("node:http").ServerResponse,
  status: number,
  value: unknown,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}
function loopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  return (
    value === "127.0.0.1" ||
    value === "::1" ||
    value === "::ffff:127.0.0.1"
  );
}

function authorized(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return (
    supplied.length === wanted.length &&
    supplied.length > 0 &&
    timingSafeEqual(supplied, wanted)
  );
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("operator request too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  return JSON.parse(text);
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("operator request must be a JSON object");
  return value as Record<string, unknown>;
}

function requiredString(
  object: Record<string, unknown>,
  key: string,
): string {
  const value = object[key];
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(key + " is required");
  return value;
}

function requestId(value: unknown): string | number {
  if (typeof value === "string" || typeof value === "number") return value;
  throw new Error("request_id must be a string or number");
}
export async function startOperatorControl(
  jobs: JobControl,
  options: OperatorControlOptions,
): Promise<{ close: () => Promise<void>; port: number }> {
  if (
    !Number.isInteger(options.port) ||
    options.port < 0 ||
    options.port > 65535
  )
    throw new Error("invalid operator control port");
  if (options.token.length < 32)
    throw new Error("operator control token is too short");

  const server = createServer(async (request, response) => {
    try {
      if (!loopbackAddress(request.socket.remoteAddress)) {
        writeJson(response, 403, { error: "loopback only" });
        return;
      }
      if (request.headers.origin) {
        writeJson(response, 403, { error: "browser-origin requests are denied" });
        return;
      }
      if (!authorized(request, options.token)) {
        writeJson(response, 401, { error: "unauthorized" });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/status") {
        writeJson(response, 200, {
          ok: true,
          pid: process.pid,
          operator_control: true,
          browser_wake: jobs.wakeStatus(),
        });
        return;
      }
      if (request.method !== "POST" || url.pathname !== "/control") {
        writeJson(response, 404, { error: "not found" });
        return;
      }

      const body = objectValue(await readJson(request));
      const command = requiredString(body, "command");

      if (command === "inspect") {
        const task = requiredString(body, "task_id");
        writeJson(response, 200, jobs.get(task, { detail: "debug" }));
        return;
      }

      if (command === "wake_status") { writeJson(response, 200, jobs.wakeStatus()); return; }
      if (command === "wake_pause" || command === "wake_resume") { writeJson(response, 200, { changed: jobs.setWakePaused(command === "wake_pause"), ...jobs.wakeStatus() }); return; }

      if (command === "approve") {
        const task = requiredString(body, "task_id");
        const id = requestId(body.request_id);
        const result = await jobs.respondApproval(
          task,
          id,
          body.decision as ApprovalDecision,
        );
        writeJson(response, 200, result);
        return;
      }

      if (command === "input") {
        const task = requiredString(body, "task_id");
        const id = requestId(body.request_id);
        const result = await jobs.respondInput(task, id, body.answers);
        writeJson(response, 200, result);
        return;
      }

      if (command === "stop") {
        writeJson(response, 202, { ok: true, stopping: true });
        setImmediate(() => void options.shutdown());
        return;
      }

      writeJson(response, 400, { error: "unknown command: " + command });
    } catch (error) {
      writeJson(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, "127.0.0.1");
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("operator control did not bind a TCP port");
  }

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
