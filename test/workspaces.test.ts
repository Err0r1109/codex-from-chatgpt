import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateWorkspace } from "../src/workspaces.js";

test("canonical workspace stays under the configured root", async () => {
  const result = await validateWorkspace(process.cwd());
  assert.equal(result, process.cwd());
});

test("workspace traversal, outside path and invalid root are rejected", async () => {
  await assert.rejects(
    validateWorkspace(`${process.cwd()}/../.codex`),
    /segmentos '\.\.'/,
  );
  const outside = mkdtempSync(path.join(tmpdir(), "outside-workspace-"));
  await assert.rejects(validateWorkspace(outside), /dentro de/);
  await assert.rejects(
    validateWorkspace("/tmp", "/path/../unsafe"),
    /segmentos '\.\.'/,
  );
});

test("symlink escape is rejected after realpath", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-workspace-root-"));
  const outside = mkdtempSync(path.join(tmpdir(), "codex-workspace-outside-"));
  const link = path.join(root, "escape");
  symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(validateWorkspace(link, root), /dentro de/);
  mkdirSync(path.join(root, "valid"));
  assert.equal(
    await validateWorkspace(path.join(root, "valid"), root),
    realpathSync(path.join(root, "valid")),
  );
});

test("multiple workspace roots accept either root and reject outside and junction escapes", async () => {
  const one = mkdtempSync(path.join(tmpdir(), "codex-workspace-one-"));
  const two = mkdtempSync(path.join(tmpdir(), "codex-workspace-two-"));
  const outside = mkdtempSync(path.join(tmpdir(), "codex-workspace-outside-"));
  const link = path.join(one, "escape");
  symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  assert.equal(await validateWorkspace(one, [one, two]), realpathSync(one));
  assert.equal(await validateWorkspace(two, [one, two]), realpathSync(two));
  await assert.rejects(validateWorkspace(outside, [one, two]));
  await assert.rejects(validateWorkspace(link, [one, two]));
});

test("explicit workspace policy accepts local paths while excluding private state ancestors", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "codex-explicit-workspace-"));
  const project = path.join(base, "project");
  const privateDir = path.join(base, "private");
  mkdirSync(project);
  mkdirSync(privateDir);
  assert.equal(await validateWorkspace(project, null, path.join(privateDir, "state.json")), realpathSync(project));
  await assert.rejects(validateWorkspace(base, null, path.join(privateDir, "state.json")), /private bridge state/);
  await assert.rejects(validateWorkspace(privateDir, null, path.join(privateDir, "state.json")), /private bridge state/);
  const child = path.join(privateDir, "child"); mkdirSync(child);
  await assert.rejects(validateWorkspace(child, null, path.join(privateDir, "state.json")), /private bridge state/);
  await assert.rejects(validateWorkspace(project, [privateDir], path.join(privateDir, "state.json")), /dentro de/);
  await assert.rejects(validateWorkspace(`${project}\0`, null), /NUL/);
  if (process.platform === "win32") {
    for (const unsafe of ["\\\\?\\C:\\Windows", "\\\\.\\C:\\Windows", "\\\\server\\share", "C:relative"])
      await assert.rejects(validateWorkspace(unsafe, null));
  }
});
