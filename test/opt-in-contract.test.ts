import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CREATE_OPT_IN_RULE,
  EXPLICIT_USER_OPT_IN_PREFIX,
  SERVER_OPT_IN_INSTRUCTIONS,
  hostSessionId,
  optInDescription,
} from "../src/mcp.js";

test("every bridge tool description can begin with the explicit opt-in contract", () => {
  const ordinary = optInDescription("Example tool.");
  const create = optInDescription("Create task.", true);
  assert.ok(ordinary.startsWith(EXPLICIT_USER_OPT_IN_PREFIX));
  assert.ok(create.startsWith(EXPLICIT_USER_OPT_IN_PREFIX));
  assert.ok(create.includes(CREATE_OPT_IN_RULE));
  assert.match(CREATE_OPT_IN_RULE, /coding request by itself is NOT authorization/i);
  assert.match(CREATE_OPT_IN_RULE, /Mentioning, discussing, suggesting or asking about Codex is NOT authorization/i);
});

test("server instructions encode the required authorization acceptance cases", () => {
  const cases: Array<[string, string]> = [
    ["Build me an Android game.", "NOT AUTHORIZED"],
    ["Would Codex be good for building this Android game?", "NOT AUTHORIZED"],
    ["We could probably use Codex for this.", "NOT AUTHORIZED"],
    ["Use Codex to build this Android game.", "AUTHORIZED"],
    ["Now make me another game.", "NOT AUTHORIZED"],
  ];
  for (const [phrase, verdict] of cases) {
    assert.ok(SERVER_OPT_IN_INSTRUCTIONS.includes(`"${phrase}" => ${verdict}`));
  }
  assert.match(SERVER_OPT_IN_INSTRUCTIONS, /same task without additional approval prompts/i);
  assert.match(SERVER_OPT_IN_INSTRUCTIONS, /past authorization never grants current authorization/i);
});

test("authorization contract explicitly allows autonomous continuation inside the opted-in task", () => {
  assert.match(SERVER_OPT_IN_INSTRUCTIONS, /create\/attach, submit, wait\/get, further turns, testing and corrections/i);
  assert.match(SERVER_OPT_IN_INSTRUCTIONS, /Authorization also ends when the task is stopped/i);
  assert.match(SERVER_OPT_IN_INSTRUCTIONS, /new conversation begins without fresh explicit opt-in/i);
});

test("every registered Codex MCP tool is wired through the opt-in description helper", () => {
  const source = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");
  const names = [
    "codex_models_list",
    "codex_threads_list",
    "codex_task_attach",
    "codex_task_create",
    "codex_turn_submit",
    "codex_task_get",
    "codex_task_wait",
    "codex_task_stop",
  ];
  for (const name of names) {
    const match = new RegExp(`registerTool\\(\\s*"${name}"`).exec(source);
    assert.ok(match, `missing registration for ${name}`);
    const start = match.index;
    const next = source.indexOf("server.registerTool", start + match[0].length);
    const block = source.slice(start, next === -1 ? undefined : next);
    assert.match(block, /description:\s*optInDescription\(/, `${name} bypasses opt-in description`);
  }
});

test("ChatGPT host session metadata is captured only from the documented openai/session key", () => {
  assert.equal(hostSessionId({ mcpReq: { _meta: { "openai/session": "session-123", other: "ignored" } } }), "session-123");
  assert.equal(hostSessionId({ mcpReq: { _meta: { other: "nope" } } }), undefined);
  assert.equal(hostSessionId({ mcpReq: { _meta: { "openai/session": 123 } } }), undefined);
});
