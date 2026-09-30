import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { wakeLabelsSchema, type WakeLabels } from "./wake-state.js";

export const SERVICE_NAME = "Codex Agent";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const CODEX_PROTOCOL_VERSION = "codex-cli 0.147.0 / app-server v2";

export function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`PORT inválido: ${value}`);
  }
  return parsed;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost") {
    return true;
  }
  const addressType = net.isIP(normalized);
  return (addressType === 4 && normalized.startsWith("127.")) || normalized === "::1";
}

export function assertSafeHost(host: string, allowNonLoopback = process.env.CODEX_AGENT_ALLOW_NON_LOOPBACK === "1"): void {
  if (isLoopbackHost(host)) {
    return;
  }
  if (!allowNonLoopback) {
    throw new Error(
      `HOST=${host} no es loopback. Define CODEX_AGENT_ALLOW_NON_LOOPBACK=1 sólo cuando un Secure MCP Tunnel o una protección equivalente cubra explícitamente el transporte.`,
    );
  }
}

/**
 * Host headers accepted on /mcp. Anchors DNS rebinding protection to the configured
 * bind address instead of a hardcoded port. A tunnel that rewrites Host must add its
 * own hostname through CODEX_AGENT_ALLOWED_HOSTS.
 */
export function allowedHosts(host: string, port: number, env: NodeJS.ProcessEnv = process.env): string[] {
  const hosts = new Set<string>();
  const add = (name: string): void => {
    const normalized = name.trim().toLowerCase();
    if (normalized.length > 0) hosts.add(normalized);
  };

  const bracket = (name: string): string => (net.isIP(name) === 6 ? `[${name}]` : name);
  add(`${bracket(host)}:${port}`);
  if (isLoopbackHost(host)) {
    add(`127.0.0.1:${port}`);
    add(`localhost:${port}`);
    add(`[::1]:${port}`);
  }
  // El SDK compara la cabecera Host cruda, sin normalizar. Host es
  // case-insensitive, así que se aceptan ambas formas para no rechazar a un
  // túnel que envíe su hostname con mayúsculas.
  for (const extra of (env.CODEX_AGENT_ALLOWED_HOSTS ?? "").split(",")) {
    add(extra);
    const verbatim = extra.trim();
    if (verbatim.length > 0) hosts.add(verbatim);
  }
  return [...hosts];
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function windowsPathEqual(a: string, b: string): boolean {
  return path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase();
}

function insideWindowsRoot(root: string, candidate: string): boolean {
  const relative = path.win32.relative(path.win32.resolve(root), path.win32.resolve(candidate));
  return relative === "" || (!relative.startsWith("..\\") && relative !== ".." && !path.win32.isAbsolute(relative));
}

function codexCliFromUserConfig(env: NodeJS.ProcessEnv): string | null {
  const home =
    env.CODEX_HOME?.trim() ||
    (env.USERPROFILE ? path.win32.join(env.USERPROFILE, ".codex") : "");
  if (!home) return null;
  const configFile = path.win32.join(home, "config.toml");
  if (!existsSync(configFile)) return null;
  let text: string;
  try {
    text = readFileSync(configFile, "utf8");
  } catch {
    return null;
  }
  const match = text.match(/^\s*CODEX_CLI_PATH\s*=\s*(['"])(.*?)\1\s*$/m);
  if (!match?.[2]) return null;
  return match[1] === '"' ? match[2].replace(/\\\\/g, "\\") : match[2];
}

function officialWindowsCodexCandidates(env: NodeJS.ProcessEnv): string[] {
  if (!env.LOCALAPPDATA) return [];
  const root = path.win32.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
  if (!existsSync(root)) return [];
  const candidates: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.win32.join(root, entry.name);
    const cli = path.win32.join(directory, "codex.exe");
    const host = path.win32.join(directory, "codex-code-mode-host.exe");
    if (isFile(cli) && isFile(host)) candidates.push(cli);
  }
  return candidates.sort((a, b) => a.localeCompare(b));
}

export function resolveCodexCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string {
  const explicit = env.CODEX_BIN?.trim();
  if (platform !== "win32") return explicit || "codex";

  const officialRoot = env.LOCALAPPDATA
    ? path.win32.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin")
    : null;
  const configured = codexCliFromUserConfig(env);
  const configuredValid = configured && isFile(configured) ? configured : null;

  if (explicit && isFile(explicit)) {
    const isOfficial = officialRoot ? insideWindowsRoot(officialRoot, explicit) : false;
    if (!isOfficial) return explicit;

    const host = path.win32.join(path.win32.dirname(explicit), "codex-code-mode-host.exe");
    const staleAgainstConfig =
      configuredValid !== null && !windowsPathEqual(explicit, configuredValid);
    if (isFile(host) && !staleAgainstConfig) return explicit;
    if (configuredValid) return configuredValid;
  }

  if (configuredValid) return configuredValid;

  const candidates = officialWindowsCodexCandidates(env);
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length > 1)
    throw new Error(
      "Ambiguous official Codex runtime: multiple complete installations found and no current CODEX_CLI_PATH disambiguates them.",
    );
  if (explicit)
    throw new Error(`Configured CODEX_BIN is unavailable or stale: ${explicit}`);
  return "codex";
}

export function runtimeConfig(env: NodeJS.ProcessEnv = process.env): {
  host: string;
  port: number;
  allowedHosts: string[];
  codexCommand: string;
  rpcTimeoutMs: number;
  shutdownTimeoutMs: number;
  stateFile: string | undefined;
  workspaceRoots: string[];
  workspacePolicy: "roots" | "explicit";
  executionPolicy: "legacy" | "danger-full-access";
  browserWakeEnabled: boolean;
  lbbMcpPath: string | undefined;
  browserWakeLabels: WakeLabels | undefined;
} {
  const parseDuration = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 10 * 60 * 1000) {
      throw new Error(`${name} inválido: ${raw}`);
    }
    return value;
  };

  const host = env.HOST ?? DEFAULT_HOST;
  for (const [key, values] of [["CODEX_WORKSPACE_POLICY", ["roots", "explicit"]], ["CODEX_EXECUTION_POLICY", ["legacy", "danger-full-access"]]] as const)
    if (env[key] && !(values as readonly string[]).includes(env[key]!)) throw new Error(`Invalid operator policy: ${key}`);
  assertSafeHost(host, env.CODEX_AGENT_ALLOW_NON_LOOPBACK === "1");
  const port = parsePort(env.PORT ?? String(DEFAULT_PORT));
  let workspaceRoots: string[];
  if (env.CODEX_WORKSPACE_ROOTS) {
    let parsed: unknown;
    try { parsed = JSON.parse(env.CODEX_WORKSPACE_ROOTS); } catch { throw new Error("CODEX_WORKSPACE_ROOTS debe ser JSON válido."); }
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 64 || parsed.some((root) => typeof root !== "string" || root.length === 0))
      throw new Error("CODEX_WORKSPACE_ROOTS debe ser un array JSON de 1 a 64 rutas.");
    workspaceRoots = parsed;
  } else workspaceRoots = [env.CODEX_WORKSPACE_ROOT ?? path.join(env.USERPROFILE ?? env.HOME ?? process.cwd(), "workspace")];
  return {
    host,
    port,
    allowedHosts: allowedHosts(host, port, env),
    codexCommand: resolveCodexCommand(env),
    rpcTimeoutMs: parseDuration("CODEX_RPC_TIMEOUT_MS", 30_000),
    shutdownTimeoutMs: parseDuration("CODEX_SHUTDOWN_TIMEOUT_MS", 2_000),
    stateFile: env.CODEX_AGENT_STATE_FILE,
    workspaceRoots,
    workspacePolicy: env.CODEX_WORKSPACE_POLICY === "explicit" ? "explicit" : "roots",
    executionPolicy: env.CODEX_EXECUTION_POLICY === "danger-full-access" ? "danger-full-access" : "legacy",
    browserWakeEnabled: env.CODEX_BROWSER_WAKE === "1",
    lbbMcpPath: env.CODEX_LBB_MCP_PATH,
    browserWakeLabels: env.CODEX_WAKE_LABELS ? wakeLabelsSchema.parse(JSON.parse(env.CODEX_WAKE_LABELS)) : undefined,
  };
}
