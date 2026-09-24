import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const llmProviderConfigTable = pgTable("llm_provider_config", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().unique().$type<"claude" | "gpt" | "gemini" | "deepseek" | "groq">(),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type LlmProviderConfig = typeof llmProviderConfigTable.$inferSelect;
