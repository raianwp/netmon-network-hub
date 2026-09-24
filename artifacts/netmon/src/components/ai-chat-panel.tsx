import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useListLlmConfig, useSaveLlmConfig, useTestLlmConfig, getListLlmConfigQueryKey,
  useListLlmModels, useCreateLlmModel, useUpdateLlmModel, useDeleteLlmModel, getListLlmModelsQueryKey,
  LlmModel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bot, Settings2, Paperclip, Send, X, FileText, Image as ImageIcon,
  CheckCircle2, XCircle, Loader2, User, Eraser, Plus, Trash2, Save, Terminal, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

// `size="sm"` on Button sets `min-h-8`, a different property than `h-7`, so both
// must be pinned together to get a real 28px control (see button.tsx cva sizes).
const TOOLBAR_CONTROL = "h-7 min-h-7 text-xs cursor-pointer";

type ProviderId = "claude" | "gpt" | "gemini" | "deepseek" | "groq";

// The 5 platforms are fixed; the model list under each one is fully editable
// from the "Modelos" tab in the config dialog — nothing here is hardcoded.
const PROVIDERS: ProviderId[] = ["claude", "gpt", "gemini", "deepseek", "groq"];

const PROVIDER_LABEL: Record<ProviderId, string> = {
  claude: "Claude (Anthropic)",
  gpt: "GPT (OpenAI)",
  gemini: "Gemini (Google)",
  deepseek: "DeepSeek",
  groq: "Groq",
};

// Accepted file types for the attach button: images (sent for vision) and
// plain text/code/log files (content is read and appended to the prompt as text).
const ACCEPT_ATTACHMENTS = [
  "image/*",
  ".txt", ".md", ".markdown", ".log", ".json", ".yaml", ".yml",
  ".js", ".jsx", ".ts", ".tsx", ".py", ".sh", ".conf", ".cfg", ".ini", ".csv", ".xml", ".html", ".css",
].join(",");

const MAX_TEXT_ATTACHMENT_CHARS = 200_000;
const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

interface Attachment {
  kind: "image" | "text";
  name: string;
  mimeType: string;
  data: string; // base64 for images, raw text for text files — empty after a reload restore for images
}

// UI-side chat history. Mirrors the unified `kind`-discriminated shape the
// backend expects (see llm-providers.ts ChatMessage), plus local-only fields
// (`id`, `status`, `error`) needed for rendering. `tool_result` entries carry
// the outcome of an approved/rejected command — never rendered as their own
// bubble, but kept in history so the next request can replay the full
// tool-call/tool-result exchange back to the model.
type UiChatMessage =
  | { id: string; kind: "user"; content: string; attachments?: Attachment[] }
  | { id: string; kind: "assistant_text"; content: string; error?: boolean }
  | { id: string; kind: "assistant_tool_call"; toolCallId: string; command: string; reasoning?: string; meta?: string; status: "pending" | "approved" | "rejected" }
  | { id: string; kind: "tool_result"; toolCallId: string; content: string };

function toWireMessage(m: UiChatMessage): object {
  switch (m.kind) {
    case "user": return { kind: "user", content: m.content, attachments: m.attachments };
    case "assistant_text": return { kind: "assistant_text", content: m.content };
    case "assistant_tool_call": return { kind: "assistant_tool_call", id: m.toolCallId, command: m.command, reasoning: m.reasoning, meta: m.meta };
    case "tool_result": return { kind: "tool_result", toolCallId: m.toolCallId, content: m.content };
  }
}

const STORAGE_KEY = "netmon-ai-chat-history-v2";

function loadStoredMessages(): UiChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UiChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistMessages(messages: UiChatMessage[]): void {
  try {
    // Strip image bytes before persisting — keeps localStorage small; the chip
    // still shows the filename, just without the actual picture after a reload.
    const slim = messages.map(m => m.kind === "user"
      ? { ...m, attachments: m.attachments?.map(a => a.kind === "image" ? { ...a, data: "" } : a) }
      : m);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch { /* localStorage full or unavailable — conversation just won't persist */ }
}

function readFileAsAttachment(file: File): Promise<Attachment | null> {
  return new Promise((resolve) => {
    const isImage = file.type.startsWith("image/");
    if (isImage) {
      if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.slice(result.indexOf(",") + 1);
        resolve({ kind: "image", name: file.name, mimeType: file.type || "image/png", data: base64 });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "").slice(0, MAX_TEXT_ATTACHMENT_CHARS);
        resolve({ kind: "text", name: file.name, mimeType: file.type || "text/plain", data: text });
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    }
  });
}

function ApiKeysTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: statuses } = useListLlmConfig({ query: { queryKey: getListLlmConfigQueryKey() } });
  const [keys, setKeys] = useState<Record<ProviderId, string>>({ claude: "", gpt: "", gemini: "", deepseek: "", groq: "" });
  const [testResults, setTestResults] = useState<Partial<Record<ProviderId, { ok: boolean; message: string }>>>({});

  const saveMutation = useSaveLlmConfig({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLlmConfigQueryKey() });
        toast({ title: "Chave salva" });
      },
      onError: () => toast({ title: "Erro", description: "Não foi possível salvar a chave.", variant: "destructive" }),
    }
  });
  const testMutation = useTestLlmConfig();

  const statusOf = (provider: ProviderId) => statuses?.find(s => s.provider === provider);

  const handleTest = async (provider: ProviderId) => {
    const apiKey = keys[provider].trim();
    if (!apiKey) { toast({ title: "Informe a chave antes de testar", variant: "destructive" }); return; }
    setTestResults(prev => ({ ...prev, [provider]: undefined }));
    try {
      const result = await testMutation.mutateAsync({ provider, data: { apiKey } });
      setTestResults(prev => ({ ...prev, [provider]: result }));
    } catch {
      setTestResults(prev => ({ ...prev, [provider]: { ok: false, message: "Falha ao testar." } }));
    }
  };

  const handleSave = (provider: ProviderId) => {
    const apiKey = keys[provider].trim();
    if (!apiKey) { toast({ title: "Informe a chave antes de salvar", variant: "destructive" }); return; }
    saveMutation.mutate({ provider, data: { apiKey } }, {
      onSuccess: () => setKeys(prev => ({ ...prev, [provider]: "" })),
    });
  };

  return (
    <div className="space-y-5 pt-2">
      {PROVIDERS.map(provider => {
        const status = statusOf(provider);
        const result = testResults[provider];
        return (
          <div key={provider} className="space-y-2 border-b border-border pb-4 last:border-0 last:pb-0">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-medium">{PROVIDER_LABEL[provider]}</span>
              {status?.configured ? (
                <Badge variant="outline" className="font-mono text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Configurado</Badge>
              ) : (
                <Badge variant="outline" className="font-mono text-[10px] bg-muted text-muted-foreground border-border">Não configurado</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                placeholder="Cole a chave de API aqui"
                value={keys[provider]}
                onChange={(e) => setKeys(prev => ({ ...prev, [provider]: e.target.value }))}
                className="font-mono text-xs h-8"
              />
              <Button
                type="button" variant="outline" size="sm"
                className="font-mono text-xs h-8 cursor-pointer shrink-0"
                disabled={testMutation.isPending}
                onClick={() => handleTest(provider)}
              >
                {testMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Testar"}
              </Button>
              <Button
                type="button" size="sm"
                className="font-mono text-xs h-8 cursor-pointer shrink-0"
                disabled={saveMutation.isPending}
                onClick={() => handleSave(provider)}
              >
                {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Salvar"}
              </Button>
            </div>
            {result && (
              <div className={`flex items-center gap-1.5 text-[11px] font-mono ${result.ok ? "text-emerald-500" : "text-destructive"}`}>
                {result.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">{result.message}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ModelRow({ model, onSave, onToggleEnabled, onDelete, isDeleting }: {
  model: LlmModel;
  onSave: (patch: { modelId: string; label: string }) => Promise<void>;
  onToggleEnabled: (enabled: boolean) => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const [label, setLabel] = useState(model.label);
  const [modelId, setModelId] = useState(model.modelId);
  const [isSaving, setIsSaving] = useState(false);
  const dirty = label.trim() !== model.label || modelId.trim() !== model.modelId;

  const handleSave = async () => {
    if (!dirty || !label.trim() || !modelId.trim()) return;
    setIsSaving(true);
    try {
      await onSave({ label: label.trim(), modelId: modelId.trim() });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="font-mono text-xs h-7 flex-1"
        placeholder="Nome de exibição"
      />
      <Input
        value={modelId}
        onChange={(e) => setModelId(e.target.value)}
        className="font-mono text-xs h-7 flex-1"
        placeholder="ID do modelo"
      />
      <Switch checked={model.enabled} onCheckedChange={onToggleEnabled} className="shrink-0" />
      <Button
        variant="outline" size="icon"
        className="h-7 w-7 shrink-0 cursor-pointer"
        title="Salvar"
        disabled={!dirty || isSaving}
        onClick={handleSave}
      >
        {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 cursor-pointer" onClick={onDelete} disabled={isDeleting}>
        <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
      </Button>
    </div>
  );
}

function AddModelRow({ provider }: { provider: ProviderId }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [modelId, setModelId] = useState("");
  const [label, setLabel] = useState("");

  const createMutation = useCreateLlmModel({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLlmModelsQueryKey() });
        setModelId("");
        setLabel("");
      },
      onError: () => toast({ title: "Erro", description: "Não foi possível adicionar o modelo (já existe?).", variant: "destructive" }),
    }
  });

  const handleAdd = () => {
    if (!modelId.trim() || !label.trim()) {
      toast({ title: "Preencha nome e ID do modelo", variant: "destructive" });
      return;
    }
    createMutation.mutate({ data: { provider, modelId: modelId.trim(), label: label.trim() } });
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nome de exibição" className="font-mono text-xs h-7 flex-1" />
      <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="ID do modelo" className="font-mono text-xs h-7 flex-1" />
      <Button size="icon" className="h-7 w-7 shrink-0 cursor-pointer" onClick={handleAdd} disabled={createMutation.isPending}>
        {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
      </Button>
    </div>
  );
}

function ModelsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: models = [] } = useListLlmModels({ query: { queryKey: getListLlmModelsQueryKey() } });

  const updateMutation = useUpdateLlmModel({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListLlmModelsQueryKey() }),
      onError: () => toast({ title: "Erro", description: "Não foi possível atualizar o modelo.", variant: "destructive" }),
    }
  });

  const handleSave = async (id: number, patch: { modelId: string; label: string }) => {
    await updateMutation.mutateAsync({ id, data: patch });
    toast({ title: "Modelo salvo" });
  };
  const deleteMutation = useDeleteLlmModel({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListLlmModelsQueryKey() }),
      onError: () => toast({ title: "Erro", description: "Não foi possível remover o modelo.", variant: "destructive" }),
    }
  });

  return (
    <div className="space-y-5 pt-2 max-h-[55vh] overflow-y-auto pr-1">
      {PROVIDERS.map(provider => {
        const providerModels = models
          .filter(m => m.provider === provider)
          .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
        return (
          <div key={provider} className="space-y-2 border-b border-border pb-4 last:border-0 last:pb-0">
            <span className="font-mono text-sm font-medium">{PROVIDER_LABEL[provider]}</span>
            <div className="space-y-1.5">
              {providerModels.length === 0 && (
                <p className="font-mono text-[11px] text-muted-foreground">Nenhum modelo cadastrado.</p>
              )}
              {providerModels.map(m => (
                <ModelRow
                  key={m.id}
                  model={m}
                  isDeleting={deleteMutation.isPending}
                  onSave={(patch) => handleSave(m.id, patch)}
                  onToggleEnabled={(enabled) => updateMutation.mutate({ id: m.id, data: { enabled } })}
                  onDelete={() => deleteMutation.mutate({ id: m.id })}
                />
              ))}
            </div>
            <AddModelRow provider={provider} />
          </div>
        );
      })}
    </div>
  );
}

function ConfigDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-mono text-xl flex items-center gap-2"><Bot className="w-5 h-5 text-primary" />Configurar Chat IA</DialogTitle>
          <DialogDescription className="font-mono text-xs text-muted-foreground">
            Chaves de API por plataforma e a lista de modelos disponíveis no seletor do chat.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="keys" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-secondary border border-border h-9">
            <TabsTrigger value="keys" className="font-mono text-xs cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Chaves de API</TabsTrigger>
            <TabsTrigger value="models" className="font-mono text-xs cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Modelos</TabsTrigger>
          </TabsList>
          <TabsContent value="keys"><ApiKeysTab /></TabsContent>
          <TabsContent value="models"><ModelsTab /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2 py-1 text-[11px] font-mono max-w-[180px]">
      {attachment.kind === "image" ? <ImageIcon className="w-3 h-3 shrink-0 text-primary" /> : <FileText className="w-3 h-3 shrink-0 text-primary" />}
      <span className="truncate">{attachment.name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="shrink-0 text-muted-foreground hover:text-destructive cursor-pointer">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function ProposalCard({ message, onApprove, onReject, disabled }: {
  message: Extract<UiChatMessage, { kind: "assistant_tool_call" }>;
  onApprove: () => void;
  onReject: () => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 max-w-full space-y-2">
      <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
        <Terminal className="w-3.5 h-3.5 shrink-0" />
        <span className="text-xs font-mono font-medium">A IA sugere executar:</span>
      </div>
      <code className="block text-xs font-mono bg-black/30 text-foreground rounded px-2 py-1.5 overflow-x-auto whitespace-pre">{message.command}</code>
      {message.reasoning && <p className="text-[11px] font-mono text-muted-foreground">{message.reasoning}</p>}
      {message.status === "pending" ? (
        <div className="flex items-center gap-2 pt-0.5">
          <Button size="sm" className="h-7 text-xs font-mono cursor-pointer" disabled={disabled} onClick={onApprove}>
            <Check className="w-3.5 h-3.5 mr-1" /> Aprovar
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs font-mono cursor-pointer" disabled={disabled} onClick={onReject}>
            <X className="w-3.5 h-3.5 mr-1" /> Rejeitar
          </Button>
        </div>
      ) : (
        <Badge variant="outline" className={`font-mono text-[10px] ${message.status === "approved" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-muted text-muted-foreground border-border"}`}>
          {message.status === "approved" ? "Aprovado e executado" : "Rejeitado"}
        </Badge>
      )}
    </div>
  );
}

function MessageBubble({ message, onApprove, onReject, resolving }: {
  message: UiChatMessage;
  onApprove: (m: Extract<UiChatMessage, { kind: "assistant_tool_call" }>) => void;
  onReject: (m: Extract<UiChatMessage, { kind: "assistant_tool_call" }>) => void;
  resolving: boolean;
}) {
  if (message.kind === "tool_result") return null;

  if (message.kind === "assistant_tool_call") {
    return (
      <div className="flex gap-2">
        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-primary/15">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="flex flex-col gap-1.5 max-w-[85%] items-start">
          <ProposalCard message={message} onApprove={() => onApprove(message)} onReject={() => onReject(message)} disabled={resolving} />
        </div>
      </div>
    );
  }

  const isUser = message.kind === "user";
  if (!isUser && !message.content) return null;

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isUser ? "bg-secondary" : "bg-primary/15"}`}>
        {isUser ? <User className="w-3.5 h-3.5 text-muted-foreground" /> : <Bot className="w-3.5 h-3.5 text-primary" />}
      </div>
      <div className={`flex flex-col gap-1.5 max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        {isUser && message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.attachments.map((a, i) => (
              a.kind === "image" && a.data ? (
                <img key={i} src={`data:${a.mimeType};base64,${a.data}`} alt={a.name} className="h-16 w-16 object-cover rounded-md border border-border" />
              ) : (
                <AttachmentChip key={i} attachment={a} />
              )
            ))}
          </div>
        )}
        {message.content && (
          <div className={`rounded-lg px-3 py-2 text-sm font-mono ${isUser ? "bg-primary text-primary-foreground" : (message.kind === "assistant_text" && message.error) ? "bg-destructive/10 text-destructive border border-destructive/30" : "bg-secondary/60 text-foreground"}`}>
            {isUser ? (
              <span className="whitespace-pre-wrap break-words">{message.content}</span>
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none break-words text-foreground [&_p]:my-1 [&_pre]:bg-black/30 [&_pre]:rounded [&_pre]:p-2 [&_code]:font-mono">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AiChatPanel({ hostContext, terminalSessionId, onApproveCommand }: {
  hostContext: string | null;
  terminalSessionId: string | null;
  onApproveCommand: (command: string) => void;
}) {
  const { toast } = useToast();
  const { data: llmModels = [] } = useListLlmModels({ query: { queryKey: getListLlmModelsQueryKey() } });
  const [modelId, setModelId] = useState<string>("");
  const [messages, setMessages] = useState<UiChatMessage[]>(() => loadStoredMessages());
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isResolvingProposal, setIsResolvingProposal] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pendingProposal = messages.find((m): m is Extract<UiChatMessage, { kind: "assistant_tool_call" }> => m.kind === "assistant_tool_call" && m.status === "pending");

  const groups = useMemo(() => {
    return PROVIDERS.map(provider => ({
      provider,
      label: PROVIDER_LABEL[provider],
      models: llmModels
        .filter(m => m.provider === provider && m.enabled)
        .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id),
    })).filter(g => g.models.length > 0);
  }, [llmModels]);

  const modelIdToProvider = useMemo(() => {
    const map = new Map<string, ProviderId>();
    for (const m of llmModels) map.set(m.modelId, m.provider as ProviderId);
    return map;
  }, [llmModels]);

  useEffect(() => {
    if (modelId && modelIdToProvider.has(modelId)) return;
    const first = groups[0]?.models[0]?.modelId;
    if (first) setModelId(first);
  }, [groups, modelId, modelIdToProvider]);

  useEffect(() => { persistMessages(messages); }, [messages]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const results = await Promise.all(Array.from(files).map(readFileAsAttachment));
    const valid = results.filter((a): a is Attachment => a !== null);
    if (valid.length < files.length) {
      toast({ title: "Alguns arquivos não puderam ser anexados", description: "Verifique o tipo/tamanho (imagens até 8MB).", variant: "destructive" });
    }
    setPendingAttachments(prev => [...prev, ...valid]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClear = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  // Shared by a normal send and by resuming after an approve/reject — both are
  // just "post this history, stream the reply, maybe get a new proposal back".
  const runChatTurn = async (history: UiChatMessage[]) => {
    if (!modelId) return;
    const provider = modelIdToProvider.get(modelId) ?? "claude";

    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    let assistantMessageId: string | null = null;
    const ensureAssistantMessage = () => {
      if (assistantMessageId) return assistantMessageId;
      const id = crypto.randomUUID();
      assistantMessageId = id;
      setMessages(prev => [...prev, { id, kind: "assistant_text", content: "" }]);
      return id;
    };

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          provider,
          model: modelId,
          messages: history.map(toWireMessage),
          terminalSessionId: terminalSessionId ?? undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(errBody?.error ?? `Erro HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find(l => l.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6)) as
            | { type: "delta"; text: string }
            | { type: "proposal"; id: string; command: string; reasoning?: string; meta?: string }
            | { type: "done" }
            | { type: "error"; message: string };

          if (payload.type === "delta" && payload.text) {
            accumulated += payload.text;
            const id = ensureAssistantMessage();
            setMessages(prev => prev.map(m => m.id === id ? { ...m, content: accumulated } : m));
          } else if (payload.type === "proposal") {
            setMessages(prev => [...prev, { id: crypto.randomUUID(), kind: "assistant_tool_call", toolCallId: payload.id, command: payload.command, reasoning: payload.reasoning, meta: payload.meta, status: "pending" }]);
          } else if (payload.type === "error") {
            throw new Error(payload.message ?? "Erro ao consultar a IA.");
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Erro ao consultar a IA.";
      const id = ensureAssistantMessage();
      setMessages(prev => prev.map(m => m.id === id ? { ...m, content: message, error: true } : m));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text && pendingAttachments.length === 0) return;
    if (isStreaming || !modelId || pendingProposal) return;

    const userMessage: UiChatMessage = {
      id: crypto.randomUUID(),
      kind: "user",
      content: text,
      attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
    };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput("");
    setPendingAttachments([]);
    await runChatTurn(history);
  };

  const handleApprove = async (m: Extract<UiChatMessage, { kind: "assistant_tool_call" }>) => {
    setIsResolvingProposal(true);
    setMessages(prev => prev.map(x => x.id === m.id ? { ...x, status: "approved" } : x));
    onApproveCommand(m.command);
    // Give the host a moment to respond before asking the model to look — it can
    // always call read_terminal_output again later if it needs a fresher view.
    await new Promise(r => setTimeout(r, 1500));
    const toolResult: UiChatMessage = {
      id: crypto.randomUUID(),
      kind: "tool_result",
      toolCallId: m.toolCallId,
      content: "Usuário aprovou o comando e ele foi digitado no terminal. Use read_terminal_output para ver o resultado atual da tela antes de continuar.",
    };
    const history = [...messages.map(x => x.id === m.id ? { ...x, status: "approved" as const } : x), toolResult];
    setMessages(history);
    setIsResolvingProposal(false);
    await runChatTurn(history);
  };

  const handleReject = async (m: Extract<UiChatMessage, { kind: "assistant_tool_call" }>) => {
    setIsResolvingProposal(true);
    const toolResult: UiChatMessage = {
      id: crypto.randomUUID(),
      kind: "tool_result",
      toolCallId: m.toolCallId,
      content: "Usuário rejeitou o comando. Ele NÃO foi executado.",
    };
    const history = [...messages.map(x => x.id === m.id ? { ...x, status: "rejected" as const } : x), toolResult];
    setMessages(history);
    setIsResolvingProposal(false);
    await runChatTurn(history);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-border shrink-0">
        <Select value={modelId} onValueChange={setModelId} disabled={groups.length === 0}>
          <SelectTrigger className={`font-mono ${TOOLBAR_CONTROL} w-[190px]`}>
            <SelectValue placeholder={groups.length === 0 ? "Nenhum modelo" : undefined} />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group, idx) => (
              <SelectGroup key={group.provider}>
                {idx > 0 && <SelectSeparator />}
                <SelectLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{group.label}</SelectLabel>
                {group.models.map(m => (
                  <SelectItem key={m.modelId} value={m.modelId} className="font-mono text-xs cursor-pointer">{m.label}</SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="icon" className="h-7 w-7 min-h-7 shrink-0 cursor-pointer" title="Limpar conversa" disabled={messages.length === 0}>
                <Eraser className="w-3.5 h-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-border bg-card">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-mono">Limpar conversa</AlertDialogTitle>
                <AlertDialogDescription className="font-mono">Isso apaga todo o histórico do chat guardado neste navegador. Não pode ser desfeito.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="font-mono cursor-pointer">Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleClear} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono cursor-pointer">Limpar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="outline" size="icon" className="h-7 w-7 min-h-7 shrink-0 cursor-pointer" title="Configurar chaves de API" onClick={() => setConfigOpen(true)}>
            <Settings2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="w-7 h-7 text-primary" />
            </div>
            <div>
              <p className="font-mono text-sm font-medium">Chat IA</p>
              <p className="font-mono text-xs text-muted-foreground mt-1 max-w-xs">
                {hostContext
                  ? `Pergunte algo sobre o terminal conectado (${hostContext}) ou anexe um arquivo pra análise.`
                  : "Configure uma chave de API e comece a conversar."}
              </p>
            </div>
          </div>
        ) : (
          messages.map(m => (
            <MessageBubble key={m.id} message={m} onApprove={handleApprove} onReject={handleReject} resolving={isResolvingProposal} />
          ))
        )}
      </div>

      <div className="border-t border-border p-2.5 shrink-0 space-y-2">
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pendingAttachments.map((a, i) => (
              <AttachmentChip key={i} attachment={a} onRemove={() => setPendingAttachments(prev => prev.filter((_, idx) => idx !== i))} />
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTACHMENTS}
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <Button
            type="button" variant="outline" size="icon"
            className="h-9 w-9 shrink-0 cursor-pointer"
            title="Anexar arquivo"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={pendingProposal ? "Aprove ou rejeite o comando sugerido acima..." : "Escreva uma mensagem..."}
            rows={1}
            disabled={!!pendingProposal}
            className="font-mono text-sm min-h-9 max-h-32 resize-none"
          />
          <Button
            type="button" size="icon"
            className="h-9 w-9 shrink-0 cursor-pointer"
            disabled={isStreaming || !modelId || !!pendingProposal || (!input.trim() && pendingAttachments.length === 0)}
            onClick={handleSend}
          >
            {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <ConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}
