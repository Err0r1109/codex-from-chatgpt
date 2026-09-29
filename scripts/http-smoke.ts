import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
const c = new Client(
  { name: "bridge-acceptance", version: "1" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
await c.connect(
  new StreamableHTTPClientTransport(new URL("http://127.0.0.1:18887/mcp")),
);
try {
  console.log(
    JSON.stringify({
      era: c.getProtocolEra(),
      tools: (await c.listTools()).tools.map((t) => t.name),
    }),
  );
  const t = await c.callTool({
    name: "codex_task_create",
    arguments: { workspace: process.argv[2] },
  });
  console.log(JSON.stringify(t));
  const id = t.structuredContent.task_id;
  console.log(
    JSON.stringify(
      await c.callTool({ name: "codex_task_get", arguments: { task_id: id } }),
    ),
  );
  console.log(
    JSON.stringify(
      await c.callTool({ name: "codex_task_stop", arguments: { task_id: id } }),
    ),
  );
} finally {
  await c.close();
}
