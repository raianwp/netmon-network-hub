import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI, Type } from "@google/genai";
import { randomUUID } from "crypto";

export type ProviderId = "claude" | "gpt" | "gemini" | "deepseek" | "groq";

export interface ChatAttachment {
  kind: "image" | "text";
  name: string;
  mimeType: string;
  // base64 for images, raw text content for "text" attachments
  data: string;
}

// Unified, provider-agnostic chat history shape — this is what's persisted on
// the frontend and sent on every request. `assistant_tool_call` / `tool_result`
// only ever represent a `propose_command` exchange: the model asked to run a
// command, and (in a later request, once the user has acted) the outcome came
// back. `read_terminal_output` never appears here — it's resolved entirely
// within a single streamChat() call and never needs cross-request approval.
export type ChatMessage =
  | { kind: "user"; content: string; attachments?: ChatAttachment[] }
  | { kind: "assistant_text"; content: string }
  // `meta` is provider-specific opaque data that must be echoed back verbatim
  // when replaying this tool call in a later request — e.g. Gemini's
  // thought_signature, required on every function-call part it sees again or
  // it rejects the request. Other providers just ignore it.
  | { kind: "assistant_tool_call"; id: string; command: string; reasoning?: string; meta?: string }
  | { kind: "tool_result"; toolCallId: string; content: string };

export type ChatTurnResult =
  | { type: "text" }
  | { type: "proposal"; id: string; command: string; reasoning?: string; meta?: string };

export interface StreamChatOptions {
  provider: ProviderId;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  onDelta: (text: string) => void;
  /** Only offered to the model when a terminal is actually connected. */
  enableTools: boolean;
  /** Returns the current terminal scrollback — backs the read_terminal_output tool. */
  readTerminalOutput: () => string;
  systemPrompt?: string;
  signal?: AbortSignal;
}

const MAX_TOOL_ITERATIONS = 3;

const READ_TOOL_DESCRIPTION =
  "Lê o conteúdo mais recente já exibido na tela do terminal conectado. Não executa nada novo e não precisa de aprovação — use para ver o que já apareceu (ex: resultado de um comando recém-aprovado).";
const PROPOSE_TOOL_DESCRIPTION =
  "Propõe um comando para ser digitado no terminal conectado. Use para QUALQUER comando novo — mesmo um comando apenas de consulta/leitura, como listar interfaces. Nunca assuma que um comando foi executado: ele só roda se o usuário aprovar. O resultado (ou a rejeição) chega em uma mensagem seguinte.";

function attachmentsAsText(attachments: ChatAttachment[] | undefined): string {
  const textAttachments = (attachments ?? []).filter(a => a.kind === "text");
  if (textAttachments.length === 0) return "";
  return textAttachments.map(a => `\n\n[Arquivo anexado: ${a.name}]\n${a.data}`).join("");
}

// gpt, deepseek and groq are all consumed through OpenAI's chat-completions wire
// format — only the base URL differs (deepseek and groq are OpenAI-compatible APIs).
function openAiClient(provider: "gpt" | "deepseek" | "groq", apiKey: string): OpenAI {
  const baseURL = provider === "deepseek"
    ? "https://api.deepseek.com"
    : provider === "groq"
      ? "https://api.groq.com/openai/v1"
      : undefined;
  return new OpenAI({ apiKey, baseURL });
}

export async function testProviderKey(provider: ProviderId, apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    switch (provider) {
      case "claude": {
        await new Anthropic({ apiKey }).models.list();
        break;
      }
      case "gpt":
      case "deepseek":
      case "groq": {
        await openAiClient(provider, apiKey).models.list();
        break;
      }
      case "gemini": {
        await new GoogleGenAI({ apiKey }).models.list();
        break;
      }
    }
    return { ok: true, message: "Conectado com sucesso." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Erro desconhecido ao testar a API." };
  }
}

// ---------------------------------------------------------------------------
// Claude (Anthropic)
// ---------------------------------------------------------------------------

const ANTHROPIC_TOOLS: Anthropic.Tool[] = [
  { name: "read_terminal_output", description: READ_TOOL_DESCRIPTION, input_schema: { type: "object", properties: {} } },
  {
    name: "propose_command",
    description: PROPOSE_TOOL_DESCRIPTION,
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "O comando exato a ser digitado no terminal." },
        reasoning: { type: "string", description: "Breve explicação do motivo deste comando." },
      },
      required: ["command"],
    },
  },
];

function buildAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.kind === "user") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      for (const att of m.attachments ?? []) {
        if (att.kind === "image") {
          blocks.push({ type: "image", source: { type: "base64", media_type: att.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: att.data } });
        }
      }
      blocks.push({ type: "text", text: m.content + attachmentsAsText(m.attachments) });
      result.push({ role: "user", content: blocks });
    } else if (m.kind === "assistant_text") {
      result.push({ role: "assistant", content: m.content });
    } else if (m.kind === "assistant_tool_call") {
      result.push({ role: "assistant", content: [{ type: "tool_use", id: m.id, name: "propose_command", input: { command: m.command, reasoning: m.reasoning } }] });
    } else {
      result.push({ role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }] });
    }
  }
  return result;
}

async function streamClaude(opts: StreamChatOptions): Promise<ChatTurnResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const messages = buildAnthropicMessages(opts.messages);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const stream = client.messages.stream(
      {
        model: opts.model,
        max_tokens: 4096,
        messages,
        ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
        ...(opts.enableTools ? { tools: ANTHROPIC_TOOLS } : {}),
      },
      { signal: opts.signal },
    );
    stream.on("text", (text) => opts.onDelta(text));
    const final = await stream.finalMessage();

    if (final.stop_reason !== "tool_use") return { type: "text" };
    const toolUse = final.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!toolUse) return { type: "text" };

    if (toolUse.name === "read_terminal_output") {
      const result = opts.readTerminalOutput();
      messages.push({ role: "assistant", content: final.content });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: result || "(tela vazia)" }] });
      continue;
    }
    const input = toolUse.input as { command?: string; reasoning?: string };
    return { type: "proposal", id: toolUse.id, command: input.command ?? "", reasoning: input.reasoning };
  }
  return { type: "text" };
}

// ---------------------------------------------------------------------------
// GPT / DeepSeek / Groq (OpenAI-compatible chat-completions)
// ---------------------------------------------------------------------------

const OPENAI_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  { type: "function", function: { name: "read_terminal_output", description: READ_TOOL_DESCRIPTION, parameters: { type: "object", properties: {} } } },
  {
    type: "function",
    function: {
      name: "propose_command",
      description: PROPOSE_TOOL_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "O comando exato a ser digitado no terminal." },
          reasoning: { type: "string", description: "Breve explicação do motivo deste comando." },
        },
        required: ["command"],
      },
    },
  },
];

function buildOpenAiMessages(messages: ChatMessage[], systemPrompt?: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) result.push({ role: "system", content: systemPrompt });
  for (const m of messages) {
    if (m.kind === "user") {
      const text = m.content + attachmentsAsText(m.attachments);
      const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];
      for (const att of m.attachments ?? []) {
        if (att.kind === "image") parts.push({ type: "image_url", image_url: { url: `data:${att.mimeType};base64,${att.data}` } });
      }
      parts.push({ type: "text", text });
      result.push({ role: "user", content: parts });
    } else if (m.kind === "assistant_text") {
      result.push({ role: "assistant", content: m.content });
    } else if (m.kind === "assistant_tool_call") {
      result.push({
        role: "assistant",
        content: null,
        tool_calls: [{ id: m.id, type: "function", function: { name: "propose_command", arguments: JSON.stringify({ command: m.command, reasoning: m.reasoning }) } }],
      });
    } else {
      result.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return result;
}

async function streamOpenAiFamily(provider: "gpt" | "deepseek" | "groq", opts: StreamChatOptions): Promise<ChatTurnResult> {
  const client = openAiClient(provider, opts.apiKey);
  const messages = buildOpenAiMessages(opts.messages, opts.systemPrompt);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const stream = await client.chat.completions.create(
      { model: opts.model, messages, stream: true, ...(opts.enableTools ? { tools: OPENAI_TOOLS } : {}) },
      { signal: opts.signal },
    );

    let toolCallId: string | undefined;
    let toolCallName: string | undefined;
    let toolCallArgs = "";
    let finishReason: string | null | undefined;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.delta?.content) opts.onDelta(choice.delta.content);
      const tc = choice?.delta?.tool_calls?.[0];
      if (tc) {
        if (tc.id) toolCallId = tc.id;
        if (tc.function?.name) toolCallName = tc.function.name;
        if (tc.function?.arguments) toolCallArgs += tc.function.arguments;
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }

    if (finishReason !== "tool_calls" || !toolCallId || !toolCallName) return { type: "text" };

    messages.push({ role: "assistant", content: null, tool_calls: [{ id: toolCallId, type: "function", function: { name: toolCallName, arguments: toolCallArgs } }] });

    let parsedArgs: { command?: string; reasoning?: string } = {};
    try { parsedArgs = JSON.parse(toolCallArgs || "{}"); } catch { /* malformed args from the model — treat as empty */ }

    if (toolCallName === "read_terminal_output") {
      const result = opts.readTerminalOutput();
      messages.push({ role: "tool", tool_call_id: toolCallId, content: result || "(tela vazia)" });
      continue;
    }
    return { type: "proposal", id: toolCallId, command: parsedArgs.command ?? "", reasoning: parsedArgs.reasoning };
  }
  return { type: "text" };
}

// ---------------------------------------------------------------------------
// Gemini (Google)
// ---------------------------------------------------------------------------

interface GeminiParamSchema {
  type: Type.OBJECT;
  properties: Record<string, { type: Type.STRING; description?: string }>;
  required?: string[];
}
interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: GeminiParamSchema;
}

const GEMINI_TOOLS: Array<{ functionDeclarations: GeminiFunctionDeclaration[] }> = [{
  functionDeclarations: [
    { name: "read_terminal_output", description: READ_TOOL_DESCRIPTION, parameters: { type: Type.OBJECT, properties: {} } },
    {
      name: "propose_command",
      description: PROPOSE_TOOL_DESCRIPTION,
      parameters: {
        type: Type.OBJECT,
        properties: {
          command: { type: Type.STRING, description: "O comando exato a ser digitado no terminal." },
          reasoning: { type: Type.STRING, description: "Breve explicação do motivo deste comando." },
        },
        required: ["command"],
      },
    },
  ],
}];

interface GeminiFunctionCallPart {
  functionCall: { name: string; args: Record<string, unknown> };
  // Gemini's "thinking" models require this opaque token to be echoed back
  // verbatim whenever a functionCall part is replayed in a later request —
  // otherwise the API rejects the whole request. See:
  // https://ai.google.dev/gemini-api/docs/thought-signatures
  thoughtSignature?: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
    | GeminiFunctionCallPart
    | { functionResponse: { name: string; response: { result: string } } }
  >;
}

function buildGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const result: GeminiContent[] = [];
  for (const m of messages) {
    if (m.kind === "user") {
      const parts: GeminiContent["parts"] = [];
      for (const att of m.attachments ?? []) {
        if (att.kind === "image") parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
      }
      parts.push({ text: m.content + attachmentsAsText(m.attachments) });
      result.push({ role: "user", parts });
    } else if (m.kind === "assistant_text") {
      result.push({ role: "model", parts: [{ text: m.content }] });
    } else if (m.kind === "assistant_tool_call") {
      result.push({
        role: "model",
        parts: [{
          functionCall: { name: "propose_command", args: { command: m.command, reasoning: m.reasoning ?? "" } },
          ...(m.meta ? { thoughtSignature: m.meta } : {}),
        }],
      });
    } else {
      result.push({ role: "user", parts: [{ functionResponse: { name: "propose_command", response: { result: m.content } } }] });
    }
  }
  return result;
}

async function streamGemini(opts: StreamChatOptions): Promise<ChatTurnResult> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const contents = buildGeminiContents(opts.messages);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const stream = await ai.models.generateContentStream({
      model: opts.model,
      contents,
      config: {
        ...(opts.systemPrompt ? { systemInstruction: opts.systemPrompt } : {}),
        ...(opts.enableTools ? { tools: GEMINI_TOOLS } : {}),
      },
    });

    let functionCall: { name: string; args: Record<string, unknown> } | undefined;
    let thoughtSignature: string | undefined;
    for await (const chunk of stream) {
      if (chunk.text) opts.onDelta(chunk.text);
      const rawPart = chunk.candidates?.[0]?.content?.parts?.find(p => p.functionCall) as
        (GeminiFunctionCallPart & { functionCall: { name?: string; args?: Record<string, unknown> } }) | undefined;
      if (rawPart?.functionCall?.name) {
        functionCall = { name: rawPart.functionCall.name, args: rawPart.functionCall.args ?? {} };
        thoughtSignature = rawPart.thoughtSignature;
      }
    }

    if (!functionCall) return { type: "text" };

    contents.push({ role: "model", parts: [{ functionCall, ...(thoughtSignature ? { thoughtSignature } : {}) }] });

    if (functionCall.name === "read_terminal_output") {
      const result = opts.readTerminalOutput();
      contents.push({ role: "user", parts: [{ functionResponse: { name: "read_terminal_output", response: { result: result || "(tela vazia)" } } }] });
      continue;
    }
    const args = functionCall.args as { command?: string; reasoning?: string };
    return { type: "proposal", id: randomUUID(), command: args.command ?? "", reasoning: args.reasoning, meta: thoughtSignature };
  }
  return { type: "text" };
}

// ---------------------------------------------------------------------------

export async function streamChat(opts: StreamChatOptions): Promise<ChatTurnResult> {
  if (opts.provider === "claude") return streamClaude(opts);
  if (opts.provider === "gemini") return streamGemini(opts);
  return streamOpenAiFamily(opts.provider, opts);
}
