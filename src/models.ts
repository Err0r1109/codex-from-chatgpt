import { z } from "zod";
import type { AppServerClient } from "./codex-app-server.js";

const modelSchema = z.object({
  id: z.string(), model: z.string(), displayName: z.string(),
  hidden: z.boolean(), isDefault: z.boolean(),
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string(), description: z.string() })),
  defaultReasoningEffort: z.string(),
  availabilityNux: z.unknown().optional(), availableAccessPrograms: z.unknown().optional(),
});
export type Model = z.infer<typeof modelSchema>;
const selectionSchema = z.object({ model: z.string().optional(), reasoning_effort: z.string().optional() });
export type Selection = z.infer<typeof selectionSchema>;
export const settingsSchema = z.object({ model: z.string(), reasoning_effort: z.string().nullable(), model_provider: z.string().optional(), source: z.string() });
export type Settings = z.infer<typeof settingsSchema>;
export const evidenceSchema = z.array(z.object({ turn_id: z.string().nullable(), requested: selectionSchema, resolved: selectionSchema, effective: settingsSchema.nullable(), reroutes: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string() })).optional() })).max(100);
export type TurnModelEvidence = z.infer<typeof evidenceSchema>[number];

export async function requireChatGPT(client: AppServerClient): Promise<void> {
  const result = await client.request<{ account?: { type?: string } }>("account/read", { refreshToken: false });
  if (result.account?.type !== "chatgpt") throw new Error("ChatGPT-authenticated Codex required; API inference is prohibited");
}

export class ModelCatalog {
  constructor(private client: AppServerClient) {}
  async list(): Promise<Model[]> {
    await requireChatGPT(this.client);
    const models: Model[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = z.object({ data: z.array(modelSchema), nextCursor: z.string().nullable().optional() }).parse(
        await this.client.request("model/list", { limit: 100, includeHidden: true, cursor }),
      );
      models.push(...page.data);
      cursor = page.nextCursor ?? null;
      if (cursor && cursors.has(cursor)) throw new Error("Invalid model catalog pagination");
      if (cursor) cursors.add(cursor);
      if (models.length > 1000) throw new Error("Model catalog exceeds bound");
    } while (cursor);
    return models;
  }
  async resolve(selection: Selection, current?: Settings | null, cwd?: string): Promise<Selection> {
    const models = await this.list();
    let defaultModel = current?.model;
    let defaultEffort = current?.reasoning_effort;
    if (selection.model === "default" || (!selection.model && !defaultModel)) {
      const result = await this.client.request<{ config?: { model?: string; model_reasoning_effort?: string } }>("config/read", { includeLayers: false, cwd });
      defaultModel = result.config?.model ?? models.find(m => m.isDefault)?.model;
      defaultEffort = result.config?.model_reasoning_effort;
    }
    const requested = selection.model === "default" ? defaultModel : selection.model ?? defaultModel;
    const exact = models.find(m => m.id === requested || m.model === requested || m.displayName.toLowerCase() === requested?.toLowerCase());
    const aliases = models.filter(m => m.displayName.toLowerCase().split(/[\s-]+/).includes(requested?.toLowerCase() ?? ""));
    const model = exact ?? (aliases.length === 1 ? aliases[0] : undefined);
    if (!model) throw new Error(`Unsupported Codex model: ${requested ?? "default unavailable"}; call codex_models_list`);
    const supported = model.supportedReasoningEfforts.map(e => e.reasoningEffort);
    let effort = selection.reasoning_effort;
    if (effort === "minimum" || effort === "maximum") {
      const order = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
      if (!supported.length || supported.some(e => !order.includes(e))) throw new Error("Cannot order advertised efforts; choose an exact catalog effort");
      const sorted = [...supported].sort((a,b) => order.indexOf(a) - order.indexOf(b));
      effort = effort === "minimum" ? sorted[0] : sorted.at(-1);
    }
    // A model switch uses that catalog's default, rather than inheriting an incompatible effort.
    if (!effort && selection.model) effort = selection.model === "default" ? defaultEffort ?? model.defaultReasoningEffort : model.defaultReasoningEffort;
    const effective = effort ?? defaultEffort ?? model.defaultReasoningEffort;
    if (!supported.includes(effective)) throw new Error(`Unsupported reasoning effort ${effective} for ${model.model}`);
    return { ...(selection.model ? { model: model.model } : {}), ...(effort ? { reasoning_effort: effort } : {}) };
  }
}
