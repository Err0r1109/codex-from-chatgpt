import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
const tests = readdirSync("test")
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => `test/${name}`);
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...tests],
  {
    stdio: "inherit",
    env: { ...process.env, CODEX_WORKSPACE_ROOT: process.cwd() },
  },
);
process.exitCode = result.status ?? 1;
