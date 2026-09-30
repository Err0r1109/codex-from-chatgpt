import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import path from "node:path";

export type BrowserData = Record<string, any>;
const LBB_CONNECT_TIMEOUT_MS = 15_000;
const LBB_CALL_TIMEOUT_MS = 30_000;

export interface LbbClient {
  call(name: string, args: BrowserData): Promise<BrowserData>;
  close(): Promise<void>;
}

/** Only the operator-configured existing MCP entrypoint. No relay keys enter this process. */
export class StdioLbbClient implements LbbClient {
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;
  constructor(private readonly entrypoint: string) {}
  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [this.entrypoint], cwd: path.dirname(this.entrypoint),
      env: getDefaultEnvironment(), stderr: "ignore" });
    const client = new Client({ name: "codex-browser-wake", version: "1.0.0" });
    try {
      await client.connect(transport, {
        timeout: LBB_CONNECT_TIMEOUT_MS,
        maxTotalTimeout: LBB_CONNECT_TIMEOUT_MS,
      });
      const catalog = await client.listTools(undefined, {
        timeout: LBB_CONNECT_TIMEOUT_MS,
        maxTotalTimeout: LBB_CONNECT_TIMEOUT_MS,
      });
      for (const name of ["browser_status", "browser_observe", "browser_operation", "browser_open_tab", "browser_type", "browser_press", "browser_click", "browser_switch_tab"])
        if (!catalog.tools.some(t => t.name === name)) throw new Error("LBB public catalog mismatch");
      this.transport = transport;
      this.client = client;
      client.onclose = () => { this.client = undefined; };
      return client;
    } catch { await transport.close(); throw new Error("LBB MCP unavailable"); }
  }
  async call(name: string, args: BrowserData): Promise<BrowserData> {
    const client = await this.connect();
    const result = await client.callTool(
      { name, arguments: args },
      { timeout: LBB_CALL_TIMEOUT_MS, maxTotalTimeout: LBB_CALL_TIMEOUT_MS },
    );
    if (result.structuredContent) return result.structuredContent;
    for (const block of result.content ?? []) {
      if (block.type === "text") {
        try { return JSON.parse(block.text); } catch { /* Not a structured browser result. */ }
      }
    }
    throw new Error("LBB returned no structured evidence");
  }
  async close(): Promise<void> {
    await this.client?.close();
    await this.transport?.close();
    this.client = undefined; this.transport = undefined;
  }
}
