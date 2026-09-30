import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_WORKSPACE_ROOT = path.join(process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(), "workspace");

export class WorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceValidationError";
  }
}

function configuredRoots(roots?: string | readonly string[]): string[] {
  const configured = roots ?? (process.env.CODEX_WORKSPACE_ROOTS
    ? JSON.parse(process.env.CODEX_WORKSPACE_ROOTS) as unknown
    : process.env.CODEX_WORKSPACE_ROOT ?? DEFAULT_WORKSPACE_ROOT);
  const values = typeof configured === "string" ? [configured] : configured;
  if (!Array.isArray(values) || values.length === 0 || values.some((v) => typeof v !== "string")) {
    throw new WorkspaceValidationError("workspaceRoots debe contener al menos una ruta absoluta.");
  }
  return values.map((root: string) => {
    if (!path.isAbsolute(root) || root.includes("\0") || root.split(/[\\/]/).some((part: string) => part === "..")) {
      throw new WorkspaceValidationError("workspaceRoots debe contener rutas absolutas sin segmentos '..'.");
    }
    return root;
  });
}

/** Resolves an existing directory under the canonical, administrative workspace root. */
export async function validateWorkspace(input: string, rootInput?: string | readonly string[]): Promise<string> {
  if (typeof input !== "string" || input.length === 0) {
    throw new WorkspaceValidationError("workspace debe ser una ruta no vacía.");
  }
  if (input.includes("\0")) {
    throw new WorkspaceValidationError("workspace contiene un byte NUL inválido.");
  }
  if (!path.isAbsolute(input)) {
    throw new WorkspaceValidationError("workspace debe ser una ruta absoluta.");
  }
  if (input.split(/[\\/]/).some((part) => part === "..")) {
    throw new WorkspaceValidationError("workspace no puede contener segmentos '..'.");
  }

  const rootInputValues = configuredRoots(rootInput);
  let roots: string[];
  let candidate: string;
  try {
    roots = await Promise.all(rootInputValues.map(async (rootInputValue) => {
      const root = await realpath(rootInputValue);
      if (!(await stat(root)).isDirectory()) throw new Error("la raíz no es un directorio");
      return root;
    }));
    candidate = await realpath(path.resolve(input));
    if (!(await stat(candidate)).isDirectory()) throw new Error("el workspace no es un directorio");
  } catch {
    throw new WorkspaceValidationError(`workspace no existe o no puede resolverse: ${input}`);
  }

  const inside = roots.some((root) => {
    const relative = path.relative(root, candidate);
    return relative === "" || !(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
  });
  if (!inside) {
    throw new WorkspaceValidationError(`workspace debe estar dentro de una raíz autorizada (${rootInputValues.join(", ")}): ${input}`);
  }
  return candidate;
}
