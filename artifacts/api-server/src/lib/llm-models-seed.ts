import { db } from "@workspace/db";
import { llmModelsTable } from "@workspace/db";
import { logger } from "./logger.js";

// Defaults seeded once on first startup if the table is empty. After that, the
// list is fully owned by whoever edits it in the Chat IA config screen — this
// never re-seeds or overwrites existing rows.
const DEFAULT_MODELS: Array<{ provider: typeof llmModelsTable.$inferSelect.provider; modelId: string; label: string; orderIndex: number }> = [
  { provider: "claude", modelId: "claude-opus-5", label: "Opus 5", orderIndex: 0 },
  { provider: "claude", modelId: "claude-sonnet-5", label: "Sonnet 5", orderIndex: 1 },
  { provider: "claude", modelId: "claude-haiku-4-5-20251001", label: "Haiku 4.5", orderIndex: 2 },
  { provider: "gpt", modelId: "gpt-5.1", label: "GPT-5.1", orderIndex: 0 },
  { provider: "gpt", modelId: "gpt-5.6-luna", label: "5.6 Luna", orderIndex: 1 },
  { provider: "gpt", modelId: "gpt-5.6-sol", label: "5.6 Sol", orderIndex: 2 },
  { provider: "gemini", modelId: "gemini-3-pro", label: "Pro 3.1", orderIndex: 0 },
  { provider: "gemini", modelId: "gemini-3-flash-preview", label: "Flash 3.6", orderIndex: 1 },
  { provider: "gemini", modelId: "gemini-3.5-flash-lite", label: "Flash Lite", orderIndex: 2 },
  { provider: "deepseek", modelId: "deepseek-chat", label: "DeepSeek-V3.2", orderIndex: 0 },
  { provider: "deepseek", modelId: "deepseek-reasoner", label: "DeepSeek-R1", orderIndex: 1 },
  { provider: "groq", modelId: "openai/gpt-oss-120b", label: "GPT-OSS 120B", orderIndex: 0 },
  { provider: "groq", modelId: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B", orderIndex: 1 },
];

export async function seedDefaultLlmModelsIfEmpty(): Promise<void> {
  const existing = await db.select({ id: llmModelsTable.id }).from(llmModelsTable).limit(1);
  if (existing.length > 0) return;

  await db.insert(llmModelsTable).values(DEFAULT_MODELS);
  logger.info({ count: DEFAULT_MODELS.length }, "Seeded default LLM models");
}
