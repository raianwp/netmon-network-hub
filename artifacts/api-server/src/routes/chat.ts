import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { llmProviderConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAiTerminalAccess } from "../middlewares/auth.js";
import { decryptSecret } from "../lib/crypto.js";
import { streamChat, type ProviderId, type ChatMessage } from "../lib/llm-providers.js";
import { getTerminalSessionContext } from "../lib/terminal-ws.js";
import { logger } from "../lib/logger.js";

const router = Router();

const attachmentSchema = z.object({
  kind: z.enum(["image", "text"]),
  name: z.string(),
  mimeType: z.string(),
  data: z.string(),
});

const chatMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), content: z.string(), attachments: z.array(attachmentSchema).optional() }),
  z.object({ kind: z.literal("assistant_text"), content: z.string() }),
  z.object({ kind: z.literal("assistant_tool_call"), id: z.string(), command: z.string(), reasoning: z.string().optional(), meta: z.string().optional() }),
  z.object({ kind: z.literal("tool_result"), toolCallId: z.string(), content: z.string() }),
]);

const chatStreamBodySchema = z.object({
  provider: z.enum(["claude", "gpt", "gemini", "deepseek", "groq"]),
  model: z.string().min(1),
  messages: z.array(chatMessageSchema).min(1),
  terminalSessionId: z.string().optional(),
});

/**
 * POST /api/chat/stream
 * Server-Sent Events stream. Each event:
 *   data: { type: "delta", text } | { type: "proposal", id, command, reasoning? } | { type: "done" } | { type: "error", message }
 * Not part of the OpenAPI/orval pipeline (same precedent as monitoring/ping-test) — the
 * response body isn't a single JSON payload, so it's hand-validated here instead.
 */
router.post("/chat/stream", requireAiTerminalAccess, async (req, res) => {
  const parsed = chatStreamBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { provider, model, messages, terminalSessionId } = parsed.data;

  const [config] = await db.select().from(llmProviderConfigTable)
    .where(eq(llmProviderConfigTable.provider, provider as ProviderId)).limit(1);
  if (!config) {
    res.status(400).json({ error: "Provedor de IA não configurado. Configure a chave de API primeiro." });
    return;
  }
  const apiKey = decryptSecret(config.apiKeyEncrypted);

  const sessionContext = terminalSessionId ? getTerminalSessionContext(terminalSessionId) : null;
  const systemPrompt = sessionContext
    ? `Você é um assistente de rede integrado a um terminal SSH/Telnet real, conectado agora a "${sessionContext.hostName}" (tipo de sistema: ${sessionContext.systemType}). ` +
      "Você NUNCA executa comandos diretamente. Para ver o que já está na tela, use a ferramenta read_terminal_output (livre, sem aprovação). " +
      "Para qualquer comando novo — mesmo apenas de consulta/leitura — use a ferramenta propose_command; ele só roda se o usuário aprovar manualmente. " +
      "Baseie os comandos que propuser na sintaxe correta do sistema indicado acima."
    : undefined;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Transfer-Encoding", "chunked");
  res.flushHeaders();

  const flush = () => {
    if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  };
  const send = (data: object) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      flush();
    }
  };

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    const result = await streamChat({
      provider: provider as ProviderId,
      apiKey,
      model,
      messages: messages as ChatMessage[],
      onDelta: (text) => send({ type: "delta", text }),
      enableTools: !!sessionContext,
      readTerminalOutput: () => sessionContext?.buffer ?? "",
      systemPrompt,
      signal: controller.signal,
    });
    if (result.type === "proposal") {
      send({ type: "proposal", id: result.id, command: result.command, reasoning: result.reasoning, meta: result.meta });
    }
    send({ type: "done" });
  } catch (err) {
    logger.error({ err, provider }, "Chat stream failed");
    send({ type: "error", message: err instanceof Error ? err.message : "Erro ao consultar a IA." });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

export default router;
