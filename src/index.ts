import { createServer } from "node:http";
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { CodexAppServer } from "./codex-app-server.js";
import { runtimeConfig, isLoopbackHost } from "./config.js";
import { JobManager, type ApprovalDecision } from "./jobs.js";
import { createBridgeHandler } from "./mcp.js";
import { StateStore } from "./store.js";
import { EventService } from "./events.js";
import { makePrivate } from "./private-files.js";
import { startOperatorControl } from "./operator-control.js";

import { BrowserWakeService } from "./browser-wake.js";
import { StdioLbbClient } from "./lbb-client.js";
import { requireChatGPT } from "./models.js";

async function main() {
  const config = runtimeConfig();
  if (!isLoopbackHost(config.host))
    throw new Error("The bridge requires loopback");
  const store = new StateStore(config.stateFile);
  mkdirSync(path.dirname(store.filePath), { recursive: true });
  makePrivate(path.dirname(store.filePath), true);
  const lockFile = `${store.filePath}.lock`;
  const lock = openSync(lockFile, "wx", 0o600);
  writeFileSync(lock, String(process.pid));
  const childEnv = { ...process.env };
  for (const name of Object.keys(childEnv))
    if (/API_KEY|TOKEN|SECRET|TUNNEL|OPERATOR|LBB|BROWSER_WAKE/i.test(name)) delete childEnv[name];
  const appServer = new CodexAppServer({
    command: config.codexCommand,
    rpcTimeoutMs: config.rpcTimeoutMs,
    shutdownTimeoutMs: config.shutdownTimeoutMs,
    spawnOptions: { env: childEnv, windowsHide: true },
  });
  let events: EventService | undefined;
  let browserWake: BrowserWakeService | undefined;
  try {
    await appServer.start();
    await requireChatGPT(appServer);
    console.error("Codex worker: App Server default; authentication: ChatGPT");
    const jobs = new JobManager(appServer, { store, workspaceRoots: config.workspaceRoots, workspacePolicy: config.workspacePolicy, executionPolicy: config.executionPolicy, browserWakeEnabled: config.browserWakeEnabled });
    events = new EventService(store, (id) => jobs.authorizeTask(id));
    await jobs.initialize();
    if (config.browserWakeEnabled) {
      if (!config.lbbMcpPath || !path.isAbsolute(config.lbbMcpPath)) throw new Error("Browser wake requires operator-configured absolute CODEX_LBB_MCP_PATH");
      browserWake = new BrowserWakeService(store, new StdioLbbClient(config.lbbMcpPath), {
        paused: () => jobs.isWakePaused(), authorize: id => jobs.authorizeTask(id),
        pin: (task, url) => jobs.pinBrowserConversation(task, url),
        labels: config.browserWakeLabels,
      });
      jobs.bindWakeService(() => browserWake!.status());
    }
    const handler = createBridgeHandler(jobs, events);
    const handleMcp = toNodeHandler(handler);
    const httpServer = createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const host = (req.headers.host ?? "").toLowerCase();
      if (
        !config.allowedHosts.map((x) => x.toLowerCase()).includes(host) ||
        req.headers.origin
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const url = new URL(req.url ?? "/", `http://${host}`);
        if (url.pathname === "/healthz" || url.pathname === "/readyz") {
          const ready = appServer.isReady() && !store.getDiagnostic();
          res.writeHead(url.pathname === "/readyz" && !ready ? 503 : 200, {
            "Content-Type": "application/json",
          });
          res.end(
            JSON.stringify({ ok: true, ready, authentication: "chatgpt", protocol: "2026-07-28", browser_wake: jobs.wakeStatus() }),
          );
        } else if (url.pathname === "/mcp") await handleMcp(req, res);
        else {
          res.writeHead(404);
          res.end();
        }
      } catch {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    });
    let operatorControl:
      | { close: () => Promise<void>; port: number }
      | undefined;
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      events?.stop();
      await browserWake?.stop();
      await operatorControl?.close();
      await handler.close();
      await appServer.stop();
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      closeSync(lock);
      unlinkSync(lockFile);
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    // An actual local TTY is the only approval entry. It is absent from HTTP/MCP.
    if (process.stdin.isTTY) {
      const terminal = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      console.error(
        "Local commands: inspect TASK_ID | approve TASK_ID REQUEST_ID DECISION_JSON | input TASK_ID REQUEST_ID ANSWERS_JSON | stop",
      );
      terminal.on("line", (line) => {
        void (async () => {
          const [command, task, rawId, ...rest] = line.trim().split(/\s+/);
          const decision = rest.join(" ");
          if (command === "stop") {
            await shutdown();
            return;
          }
          if (command === "inspect" && task) {
            console.log(
              JSON.stringify(jobs.get(task, { detail: "debug" }), null, 2),
            );
            return;
          }
          if ((command === "approve" || command === "input") && task && rawId) {
            let id: unknown;
            try {
              id = JSON.parse(rawId);
            } catch {
              id = rawId;
            }
            if (typeof id !== "string" && typeof id !== "number")
              throw new Error("Invalid request ID");
            let value: unknown;
            try {
              value = JSON.parse(decision);
            } catch {
              value = decision;
            }
            console.log(
              JSON.stringify(
                command === "input"
                  ? await jobs.respondInput(task, id, value)
                  : await jobs.respondApproval(
                      task,
                      id,
                      value as ApprovalDecision,
                    ),
              ),
            );
          }
        })().catch((e) => console.error(e.message));
      });
    }
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(config.port, config.host, resolve);
    });
    const operatorTokenFile = process.env.CODEX_OPERATOR_TOKEN_FILE?.trim();
    if (operatorTokenFile) {
      makePrivate(operatorTokenFile);
      const token = readFileSync(operatorTokenFile, "utf8").trim();
      const operatorPort = Number(
        process.env.CODEX_OPERATOR_PORT ?? config.port + 1,
      );
      operatorControl = await startOperatorControl(jobs, {
        port: operatorPort,
        token,
        shutdown,
      });
      console.error(
        `Operator control: http://127.0.0.1:${operatorControl.port}`,
      );
    }
    events.start();
    browserWake?.start();
    console.error(`Codex MCP Bridge: http://${config.host}:${config.port}/mcp`);
  } catch (e) {
    events?.stop();
    await browserWake?.stop();
    await appServer.stop();
    closeSync(lock);
    unlinkSync(lockFile);
    throw e;
  }
}
if (
  process.argv[1] &&
  path
    .resolve(process.argv[1])
    .endsWith(
      `${path.sep}index.${process.argv[1].endsWith(".ts") ? "ts" : "js"}`,
    )
)
  void main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
