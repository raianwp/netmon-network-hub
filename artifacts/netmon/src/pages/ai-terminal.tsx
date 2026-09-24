import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  useListSshHosts, useCreateSshHost, useUpdateSshHost, useDeleteSshHost,
  getListSshHostsQueryKey, SshHost,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plug, PlugZap, Settings2, Plus, Edit2, Trash2, Loader2,
  ShieldAlert, Server, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AiChatPanel } from "@/components/ai-chat-panel";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

// `size="sm"` on Button sets `min-h-8`, a different property than `h-7`, so both
// must be pinned together to get a real 28px control (see button.tsx cva sizes).
const TOOLBAR_CONTROL = "h-7 min-h-7 text-xs cursor-pointer";

type SystemType = "mikrotik" | "cisco" | "linux" | "windows" | "ubiquiti" | "fortinet" | "unknown";
type ConnStatus = "idle" | "connecting" | "connected" | "error" | "closed";

const systemTypeLabel: Record<SystemType, string> = {
  mikrotik: "MikroTik",
  cisco: "Cisco",
  linux: "Linux",
  windows: "Windows",
  ubiquiti: "Ubiquiti",
  fortinet: "Fortinet",
  unknown: "Desconhecido",
};

const hostSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  ipAddress: z.string().min(7, "IP inválido"),
  protocol: z.enum(["ssh", "telnet"]),
  port: z.coerce.number().min(1).max(65535),
  username: z.string().min(1, "Usuário é obrigatório"),
  password: z.string().optional(),
  systemType: z.enum(["mikrotik", "cisco", "linux", "windows", "ubiquiti", "fortinet", "unknown"]),
});

type HostFormValues = z.infer<typeof hostSchema>;

export interface TerminalPaneHandle {
  /** Sends text to the terminal exactly as if the user typed it, followed by Enter. */
  sendCommand: (command: string) => void;
}

const TerminalPane = forwardRef<TerminalPaneHandle, {
  host: SshHost | null;
  shouldConnect: boolean;
  sessionId: string;
  onStatusChange: (status: ConnStatus, message?: string) => void;
}>(function TerminalPane({ host, shouldConnect, sessionId, onStatusChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      convertEol: true,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 13,
      theme: {
        background: "#0a0a0b",
        foreground: "#d4d4d4",
        cursor: "#22c55e",
        selectionBackground: "#264f78",
      },
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    term.writeln("\x1b[90mSelecione um host e clique em Conectar.\x1b[0m");

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch { /* ignore during unmount race */ }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    if (!shouldConnect || !host) {
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    term.reset();
    term.writeln(`\x1b[90mConectando a ${host.name} (${host.ipAddress})...\x1b[0m`);
    onStatusChange("connecting");

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${wsProto}//${window.location.host}/api/terminal/ws?hostId=${host.id}&cols=${term.cols}&rows=${term.rows}&sessionId=${sessionId}`
    );
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as
          | { type: "output"; data: string }
          | { type: "status"; status: "connected" | "error" | "closed"; message?: string };
        if (msg.type === "output") {
          term.write(msg.data);
        } else if (msg.type === "status") {
          if (msg.status === "connected") {
            onStatusChange("connected");
          } else if (msg.status === "error") {
            term.writeln(`\r\n\x1b[31m${msg.message ?? "Erro na conexão."}\x1b[0m`);
            onStatusChange("error", msg.message);
          } else if (msg.status === "closed") {
            term.writeln("\r\n\x1b[90mConexão encerrada.\x1b[0m");
            onStatusChange("closed");
          }
        }
      } catch { /* ignore malformed server message */ }
    };
    ws.onerror = () => onStatusChange("error", "Falha na conexão WebSocket.");
    ws.onclose = () => onStatusChange("closed");

    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });

    return () => {
      dataDisposable.dispose();
      ws.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldConnect, host?.id]);

  useImperativeHandle(ref, () => ({
    sendCommand: (command: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data: `${command}\r` }));
      }
    },
  }), []);

  return <div ref={containerRef} className="h-full w-full p-2" />;
});

function ManageHostsDialog({
  open, onOpenChange, hosts,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hosts: SshHost[];
}) {
  const [editingHost, setEditingHost] = useState<SshHost | null>(null);
  const [deletingHost, setDeletingHost] = useState<SshHost | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createMutation = useCreateSshHost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSshHostsQueryKey() });
        setIsFormOpen(false);
        toast({ title: "Host adicionado" });
      },
      onError: () => toast({ title: "Erro", description: "Não foi possível salvar o host.", variant: "destructive" }),
    }
  });
  const updateMutation = useUpdateSshHost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSshHostsQueryKey() });
        setIsFormOpen(false);
        setEditingHost(null);
        toast({ title: "Host atualizado" });
      },
      onError: () => toast({ title: "Erro", description: "Não foi possível salvar o host.", variant: "destructive" }),
    }
  });
  const deleteMutation = useDeleteSshHost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSshHostsQueryKey() });
        setDeletingHost(null);
        toast({ title: "Host removido" });
      },
      onError: () => toast({ title: "Erro", description: "Não foi possível remover o host.", variant: "destructive" }),
    }
  });

  const form = useForm<HostFormValues>({
    resolver: zodResolver(hostSchema),
    defaultValues: { name: "", ipAddress: "", protocol: "ssh", port: 22, username: "", password: "", systemType: "unknown" },
  });

  const protocol = form.watch("protocol");

  const openNewForm = () => {
    setEditingHost(null);
    form.reset({ name: "", ipAddress: "", protocol: "ssh", port: 22, username: "", password: "", systemType: "unknown" });
    setIsFormOpen(true);
  };

  const openEditForm = (host: SshHost) => {
    setEditingHost(host);
    form.reset({ name: host.name, ipAddress: host.ipAddress, protocol: host.protocol, port: host.port, username: host.username, password: "", systemType: host.systemType });
    setIsFormOpen(true);
  };

  const onSubmit = (values: HostFormValues) => {
    if (editingHost) {
      // Backend only overwrites the stored password when a non-empty value is sent —
      // safe to always forward the (possibly blank) field here.
      updateMutation.mutate({ id: editingHost.id, data: values });
    } else {
      createMutation.mutate({ data: { ...values, password: values.password ?? "" } });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col border-border bg-card">
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-mono text-xl flex items-center gap-2"><Server className="w-5 h-5 text-primary" />Hosts do Terminal IA</DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">
              Dispositivos disponíveis para conexão via SSH/Telnet no Terminal IA.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end shrink-0">
            <Button size="sm" onClick={openNewForm} className="font-mono cursor-pointer">
              <Plus className="w-4 h-4 mr-2" />
              Novo Host
            </Button>
          </div>

          <div className="border border-border rounded-md overflow-hidden flex-1 min-h-0">
            <div className="overflow-y-auto max-h-[45vh]">
              <Table>
                <TableHeader className="bg-secondary/50 sticky top-0 z-10">
                  <TableRow>
                    <TableHead className="font-mono text-xs font-bold">Nome / IP</TableHead>
                    <TableHead className="font-mono text-xs font-bold">Protocolo</TableHead>
                    <TableHead className="font-mono text-xs font-bold">Sistema</TableHead>
                    <TableHead className="font-mono text-xs font-bold">Usuário</TableHead>
                    <TableHead className="text-right font-mono text-xs font-bold">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hosts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground font-mono">Nenhum host cadastrado.</TableCell>
                    </TableRow>
                  ) : hosts.map(host => (
                    <TableRow key={host.id} className="group hover:bg-secondary/20">
                      <TableCell>
                        <div className="font-mono font-bold text-foreground">{host.name}</div>
                        <div className="font-mono text-xs text-primary mt-1">{host.ipAddress}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`font-mono uppercase tracking-wider text-[10px] ${host.protocol === "telnet" ? "border-amber-500/40 text-amber-500 bg-amber-500/10" : "border-border"}`}>
                          {host.protocol === "telnet" && <ShieldAlert className="w-3 h-3 mr-1" />}
                          {host.protocol} :{host.port}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{systemTypeLabel[host.systemType as SystemType]}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{host.username}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="icon" onClick={() => openEditForm(host)} className="h-8 w-8 cursor-pointer">
                          <Edit2 className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeletingHost(host)} className="h-8 w-8 cursor-pointer">
                          <Trash2 className="w-4 h-4 text-muted-foreground group-hover:text-destructive transition-colors" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[500px] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono text-xl">{editingHost ? "Editar Host" : "Novo Host"}</DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">Dados de conexão do dispositivo.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Nome</FormLabel>
                    <FormControl><Input placeholder="Ex: MK-Borda-01" className="font-mono" {...field} /></FormControl>
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
                <FormField control={form.control} name="ipAddress" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Endereço IP</FormLabel>
                    <FormControl><Input placeholder="192.168.1.x" className="font-mono" {...field} /></FormControl>
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="protocol" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Protocolo</FormLabel>
                    <Select onValueChange={(v) => { field.onChange(v); if (v === "ssh") form.setValue("port", 22); else form.setValue("port", 23); }} value={field.value}>
                      <FormControl><SelectTrigger className="font-mono cursor-pointer"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="ssh" className="font-mono cursor-pointer">SSH</SelectItem>
                        <SelectItem value="telnet" className="font-mono cursor-pointer">Telnet</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
                <FormField control={form.control} name="port" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Porta</FormLabel>
                    <FormControl><Input type="number" className="font-mono" {...field} /></FormControl>
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
              </div>

              {protocol === "telnet" && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs font-mono text-amber-500/90">Telnet trafega usuário, senha e comandos sem criptografia. Use apenas em redes internas confiáveis.</p>
                </div>
              )}

              <FormField control={form.control} name="systemType" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Tipo de Sistema</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger className="font-mono cursor-pointer"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="mikrotik" className="font-mono cursor-pointer">MikroTik</SelectItem>
                      <SelectItem value="cisco" className="font-mono cursor-pointer">Cisco</SelectItem>
                      <SelectItem value="linux" className="font-mono cursor-pointer">Linux</SelectItem>
                      <SelectItem value="windows" className="font-mono cursor-pointer">Windows</SelectItem>
                      <SelectItem value="ubiquiti" className="font-mono cursor-pointer">Ubiquiti</SelectItem>
                      <SelectItem value="fortinet" className="font-mono cursor-pointer">Fortinet</SelectItem>
                      <SelectItem value="unknown" className="font-mono cursor-pointer">Desconhecido</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage className="text-[10px]" />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="username" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Usuário</FormLabel>
                    <FormControl><Input placeholder="admin" className="font-mono" {...field} /></FormControl>
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
                <FormField control={form.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Senha</FormLabel>
                    <FormControl><Input type="password" placeholder={editingHost ? "Deixe em branco para manter" : ""} className="font-mono" {...field} /></FormControl>
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border mt-2">
                <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)} className="font-mono cursor-pointer">Cancelar</Button>
                <Button type="submit" disabled={isSaving} className="font-mono cursor-pointer">
                  {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Salvar
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingHost} onOpenChange={(open) => !open && setDeletingHost(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono">Excluir Host</AlertDialogTitle>
            <AlertDialogDescription className="font-mono">
              Tem certeza que deseja excluir <span className="font-bold text-foreground">{deletingHost?.name}</span>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono cursor-pointer">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingHost && deleteMutation.mutate({ id: deletingHost.id })}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono cursor-pointer"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AiTerminal() {
  const { toast } = useToast();
  const { data: hosts = [] } = useListSshHosts();
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
  const [shouldConnect, setShouldConnect] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [manageOpen, setManageOpen] = useState(false);
  const terminalRef = useRef<TerminalPaneHandle>(null);

  const selectedHost = hosts.find(h => h.id === selectedHostId) ?? null;

  // A fresh id per connection attempt — the backend uses it to key the terminal's
  // scrollback buffer that Chat IA reads from (see terminal-ws.ts).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const terminalSessionId = useMemo(() => crypto.randomUUID(), [shouldConnect, selectedHostId]);

  const sendToTerminal = (command: string) => terminalRef.current?.sendCommand(command);

  useEffect(() => {
    if (selectedHostId === null && hosts.length > 0) {
      setSelectedHostId(hosts[0].id);
    } else if (selectedHostId !== null && !hosts.some(h => h.id === selectedHostId)) {
      setSelectedHostId(hosts[0]?.id ?? null);
      setShouldConnect(false);
    }
  }, [hosts, selectedHostId]);

  const handleStatusChange = (next: ConnStatus, message?: string) => {
    setStatus(next);
    if (next === "error") {
      setShouldConnect(false);
      toast({ title: "Falha na conexão", description: message ?? "Não foi possível conectar ao host.", variant: "destructive" });
    } else if (next === "closed") {
      setShouldConnect(false);
    }
  };

  const toggleConnection = () => {
    if (!selectedHost) return;
    setShouldConnect(c => !c);
  };

  const connected = status === "connected";

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 -m-4 md:-m-8 p-4 md:p-8">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold font-mono tracking-tight">IA Terminal</h1>
        <p className="text-muted-foreground text-xs font-mono mt-0.5">Terminal SSH/Telnet com assistência de IA para diagnóstico e comandos.</p>
      </div>

      <div className="flex-1 min-h-0 border border-border rounded-md bg-card overflow-hidden shadow-xl">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={62} minSize={35}>
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border shrink-0 flex-wrap">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className={`font-mono ${TOOLBAR_CONTROL} justify-between min-w-[200px]`}>
                      <span className="flex items-center gap-2 truncate">
                        <Server className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        {selectedHost ? (
                          <>
                            <span className="truncate">{selectedHost.name}</span>
                            {selectedHost.protocol === "telnet" && <ShieldAlert className="w-3 h-3 text-amber-500 shrink-0" />}
                          </>
                        ) : (
                          <span className="text-muted-foreground">Selecione um host</span>
                        )}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[260px]">
                    {hosts.length === 0 ? (
                      <div className="px-2 py-3 text-center text-xs font-mono text-muted-foreground">Nenhum host cadastrado.</div>
                    ) : hosts.map(h => (
                      <DropdownMenuItem
                        key={h.id}
                        className="font-mono text-xs flex items-center justify-between gap-2 cursor-pointer"
                        onClick={() => { setSelectedHostId(h.id); setShouldConnect(false); }}
                      >
                        <span className="truncate">{h.name} <span className="text-muted-foreground">({h.ipAddress})</span></span>
                        <Badge variant="outline" className="text-[9px] shrink-0">{systemTypeLabel[h.systemType as SystemType]}</Badge>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button variant="outline" size="sm" className={`font-mono ${TOOLBAR_CONTROL}`} onClick={() => setManageOpen(true)}>
                  <Settings2 className="w-3.5 h-3.5 mr-1.5" />
                  Gerenciar Hosts
                </Button>

                <div className="flex-1" />

                <Badge variant="outline" className={`font-mono text-[10px] h-7 ${connected ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : status === "connecting" ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-muted text-muted-foreground border-border"}`}>
                  {connected ? "CONECTADO" : status === "connecting" ? "CONECTANDO..." : "DESCONECTADO"}
                </Badge>

                <Button
                  size="sm"
                  disabled={!selectedHost || status === "connecting"}
                  onClick={toggleConnection}
                  className={`font-mono ${TOOLBAR_CONTROL} ${shouldConnect ? "bg-destructive hover:bg-destructive/90" : ""}`}
                >
                  {status === "connecting" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : shouldConnect ? <PlugZap className="w-3.5 h-3.5 mr-1.5" /> : <Plug className="w-3.5 h-3.5 mr-1.5" />}
                  {shouldConnect ? "Desconectar" : "Conectar"}
                </Button>
              </div>

              <div className="flex-1 min-h-0 bg-[#0a0a0b]">
                <TerminalPane ref={terminalRef} host={selectedHost} shouldConnect={shouldConnect} sessionId={terminalSessionId} onStatusChange={handleStatusChange} />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle className="w-4 bg-transparent after:w-px after:bg-border hover:after:bg-primary/50 transition-colors cursor-col-resize" />

          <ResizablePanel defaultSize={38} minSize={25}>
            <AiChatPanel
              hostContext={connected && selectedHost ? `${selectedHost.name} — ${systemTypeLabel[selectedHost.systemType as SystemType]}` : null}
              terminalSessionId={connected ? terminalSessionId : null}
              onApproveCommand={sendToTerminal}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <ManageHostsDialog open={manageOpen} onOpenChange={setManageOpen} hosts={hosts} />
    </div>
  );
}
