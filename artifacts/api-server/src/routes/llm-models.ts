import { Router } from "express";
import { db } from "@workspace/db";
import { llmModelsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { CreateLlmModelBody, UpdateLlmModelParams, UpdateLlmModelBody, DeleteLlmModelParams } from "@workspace/api-zod";
import { requireAiTerminalAccess } from "../middlewares/auth.js";

const router = Router();

router.get("/llm-models", requireAiTerminalAccess, async (_req, res) => {
  const rows = await db.select().from(llmModelsTable).orderBy(asc(llmModelsTable.provider), asc(llmModelsTable.orderIndex), asc(llmModelsTable.id));
  res.json(rows);
});

router.post("/llm-models", requireAiTerminalAccess, async (req, res) => {
  const parsed = CreateLlmModelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request body" }); return; }
  const data = parsed.data;
  try {
    const [model] = await db.insert(llmModelsTable).values({
      provider: data.provider as typeof llmModelsTable.$inferSelect.provider,
      modelId: data.modelId,
      label: data.label,
      enabled: data.enabled ?? true,
      orderIndex: data.orderIndex ?? 0,
    }).returning();
    res.status(201).json(model);
  } catch {
    res.status(409).json({ error: "Esse modelo já existe para essa plataforma." });
  }
});

router.put("/llm-models/:id", requireAiTerminalAccess, async (req, res) => {
  const params = UpdateLlmModelParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = UpdateLlmModelBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const updates: Record<string, unknown> = {};
  const d = body.data;
  if (d.modelId != null) updates.modelId = d.modelId;
  if (d.label != null) updates.label = d.label;
  if (d.enabled != null) updates.enabled = d.enabled;
  if (d.orderIndex != null) updates.orderIndex = d.orderIndex;

  const [model] = await db.update(llmModelsTable).set(updates).where(eq(llmModelsTable.id, params.data.id)).returning();
  if (!model) { res.status(404).json({ error: "Model not found" }); return; }
  res.json(model);
});

router.delete("/llm-models/:id", requireAiTerminalAccess, async (req, res) => {
  const params = DeleteLlmModelParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(llmModelsTable).where(eq(llmModelsTable.id, params.data.id));
  res.json({ message: "Modelo removido com sucesso" });
});

export default router;
