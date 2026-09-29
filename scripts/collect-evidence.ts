import { readFileSync, writeFileSync } from "node:fs";
import { CodexAppServer } from "../src/codex-app-server.js";
const target = process.argv[2];
const report = JSON.parse(readFileSync(target, "utf8"));
const a = new CodexAppServer();
await a.start();
try {
  const r = await a.request("thread/read", {
    threadId: report.task.thread_id,
    includeTurns: true,
  });
  report.protocol_evidence = r.thread.turns.map((t) => ({
    turn_id: t.id,
    status: t.status,
    commands: t.items
      .filter((i) => i.type === "commandExecution")
      .map((i) => ({
        command: i.command,
        status: i.status,
        exit_code: i.exitCode,
        output: i.aggregatedOutput?.slice(-1600),
      })),
  }));
  writeFileSync(target, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.protocol_evidence));
} finally {
  await a.stop();
}
