import { Router } from "express";
import { db } from "@workspace/db";
import { llmProviderConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SaveLlmConfigBody, TestLlmConfigBody } from "@workspace/api-zod";
import { requireAiTerminalAccess } from "../middlewares/auth.js";
import { encryptSecret } from "../lib/crypto.js";
import { testProviderKey, type ProviderId } from "../lib/llm-providers.js";

const router = Router();

const PROVIDERS: ProviderId[] = ["claude", "gpt", "gemini", "deepseek", "groq"];

function isProviderId(value: string): value is ProviderId {
  return (PROVIDERS as string[]).includes(value);
}

router.get("/llm-config", requireAiTerminalAccess, async (_req, res) => {
  const rows = await db.select().from(llmProviderConfigTable);
  const byProvider = new Map(rows.map(r => [r.provider, r]));
  res.json(PROVIDERS.map(provider => {
    const row = byProvider.get(provider);
    return {
      provider,
      configured: !!row,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  }));
});

router.put("/llm-config/:provider", requireAiTerminalAccess, async (req, res) => {
  const provider = String(req.params.provider);
  if (!isProviderId(provider)) { res.status(400).json({ error: "Provedor inválido" }); return; }
  const parsed = SaveLlmConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const apiKeyEncrypted = encryptSecret(parsed.data.apiKey);
  const existing = await db.select().from(llmProviderConfigTable).where(eq(llmProviderConfigTable.provider, provider)).limit(1);

  let updatedAt: Date;
  if (existing[0]) {
    const [row] = await db.update(llmProviderConfigTable)
      .set({ apiKeyEncrypted, updatedAt: new Date() })
      .where(eq(llmProviderConfigTable.provider, provider))
      .returning();
    updatedAt = row.updatedAt;
  } else {
    const [row] = await db.insert(llmProviderConfigTable)
      .values({ provider, apiKeyEncrypted })
      .returning();
    updatedAt = row.updatedAt;
  }

  res.json({ provider, configured: true, updatedAt: updatedAt.toISOString() });
});

router.delete("/llm-config/:provider", requireAiTerminalAccess, async (req, res) => {
  const provider = String(req.params.provider);
  if (!isProviderId(provider)) { res.status(400).json({ error: "Provedor inválido" }); return; }
  await db.delete(llmProviderConfigTable).where(eq(llmProviderConfigTable.provider, provider));
  res.json({ message: "Configuração removida com sucesso" });
});

router.post("/llm-config/:provider/test", requireAiTerminalAccess, async (req, res) => {
  const provider = String(req.params.provider);
  if (!isProviderId(provider)) { res.status(400).json({ error: "Provedor inválido" }); return; }
  const parsed = TestLlmConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const result = await testProviderKey(provider, parsed.data.apiKey);
  res.json(result);
});

export default router;
