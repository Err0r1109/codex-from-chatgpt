import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  allowedHosts,
  assertSafeHost,
  isLoopbackHost,
  resolveCodexCommand,
  runtimeConfig,
} from "../src/config.js";

test("HOST sólo permite loopback sin opt-in", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.throws(() => assertSafeHost("0.0.0.0", false), /no es loopback/);
  assert.doesNotThrow(() => assertSafeHost("0.0.0.0", true));
});

test("runtime config valida duraciones y requiere opt-in para bind externo", () => {
  assert.throws(() => runtimeConfig({ HOST: "0.0.0.0" }), /no es loopback/);
  const config = runtimeConfig({ HOST: "0.0.0.0", CODEX_AGENT_ALLOW_NON_LOOPBACK: "1", PORT: "9000", CODEX_RPC_TIMEOUT_MS: "17" });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 9000);
  assert.equal(config.rpcTimeoutMs, 17);
});

test("allowedHosts sigue al PORT configurado y admite el host del túnel", () => {
  const loopback = allowedHosts("127.0.0.1", 9000, {});
  assert.ok(loopback.includes("127.0.0.1:9000"));
  assert.ok(loopback.includes("localhost:9000"));
  assert.ok(!loopback.some((host) => host.endsWith(":8787")));

  const external = allowedHosts("0.0.0.0", 9000, {});
  assert.deepEqual(external, ["0.0.0.0:9000"]);

  // El SDK compara la cabecera Host cruda: hacen falta ambas formas.
  const tunneled = allowedHosts("127.0.0.1", 9000, { CODEX_AGENT_ALLOWED_HOSTS: "Tunnel.Example.Com, ,," });
  assert.ok(tunneled.includes("tunnel.example.com"));
  assert.ok(tunneled.includes("Tunnel.Example.Com"));
  assert.ok(!tunneled.includes(""), "una entrada vacía desactivaría la validación en el SDK");

  // '*' no es un comodín para el SDK, pero la lista nunca debe quedar vacía.
  for (const env of [{}, { CODEX_AGENT_ALLOWED_HOSTS: "" }, { CODEX_AGENT_ALLOWED_HOSTS: ",, " }]) {
    assert.ok(allowedHosts("127.0.0.1", 9000, env).length > 0);
  }

  assert.deepEqual(runtimeConfig({ PORT: "9000" }).allowedHosts, loopback);
});

test("Windows Codex resolver follows the current official runtime when a pinned path is stale", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-runtime-"));
  try {
    const localAppData = path.join(root, "Local");
    const userProfile = path.join(root, "User");
    const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
    const oldDir = path.join(binRoot, "old-build");
    const currentDir = path.join(binRoot, "current-build");
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(currentDir, { recursive: true });
    writeFileSync(path.join(oldDir, "codex.exe"), "old");
    const current = path.join(currentDir, "codex.exe");
    writeFileSync(current, "current");
    writeFileSync(path.join(currentDir, "codex-code-mode-host.exe"), "host");
    mkdirSync(path.join(userProfile, ".codex"), { recursive: true });
    writeFileSync(
      path.join(userProfile, ".codex", "config.toml"),
      "[mcp_servers.node_repl.env]\nCODEX_CLI_PATH = '" + current + "'\n",
    );

    assert.equal(
      resolveCodexCommand(
        {
          LOCALAPPDATA: localAppData,
          USERPROFILE: userProfile,
          CODEX_BIN: path.join(oldDir, "codex.exe"),
        },
        "win32",
      ),
      current,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime config reads JSON workspace roots and preserves the legacy root", () => {
  assert.deepEqual(runtimeConfig({ CODEX_WORKSPACE_ROOTS: '["C:\\\\src","D:\\\\work"]' }).workspaceRoots, ["C:\\src", "D:\\work"]);
  assert.deepEqual(runtimeConfig({ CODEX_WORKSPACE_ROOT: "C:\\legacy" }).workspaceRoots, ["C:\\legacy"]);
  assert.throws(() => runtimeConfig({ CODEX_WORKSPACE_ROOTS: "no-json" }), /JSON/);
});

test("Windows Codex resolver keeps an explicit custom executable", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-custom-"));
  try {
    const custom = path.join(root, "custom-codex.exe");
    writeFileSync(custom, "custom");
    assert.equal(
      resolveCodexCommand(
        { LOCALAPPDATA: path.join(root, "Local"), CODEX_BIN: custom },
        "win32",
      ),
      custom,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows Codex resolver fails closed when official runtime selection is ambiguous", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-ambiguous-"));
  try {
    const localAppData = path.join(root, "Local");
    const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
    for (const name of ["one", "two"]) {
      const dir = path.join(binRoot, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "codex.exe"), name);
      writeFileSync(path.join(dir, "codex-code-mode-host.exe"), "host");
    }
    assert.throws(
      () =>
        resolveCodexCommand(
          {
            LOCALAPPDATA: localAppData,
            USERPROFILE: path.join(root, "NoConfig"),
            CODEX_BIN: path.join(root, "missing-codex.exe"),
          },
          "win32",
        ),
      /Ambiguous official Codex runtime/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
