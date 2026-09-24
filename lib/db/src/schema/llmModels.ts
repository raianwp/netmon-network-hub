import { pgTable, serial, text, integer, boolean, unique } from "drizzle-orm/pg-core";

export const llmModelsTable = pgTable("llm_models", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().$type<"claude" | "gpt" | "gemini" | "deepseek" | "groq">(),
  modelId: text("model_id").notNull(),
  label: text("label").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  orderIndex: integer("order_index").default(0).notNull(),
}, (table) => [
  unique("llm_models_provider_model_id_unique").on(table.provider, table.modelId),
]);

export type LlmModel = typeof llmModelsTable.$inferSelect;
