import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useListHosts,
  useCreateHost,
  useUpdateHost,
  useDeleteHost,
  useDiscoverHosts,
  getListHostsQueryKey,
  Host,
  DiscoveredHost
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, Loader2, Monitor, Server, Cpu, X, ArrowUpDown, ArrowUp, ArrowDown, Scan, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";

type SortField = "name" | "ip" | "type";
type SortDir = "asc" | "desc";

const hostSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  ipAddress: z.string().min(7, "IP inválido"),
  type: z.enum(["pc", "server", "device"]),
  userName: z.string().optional().nullable(),
  sector: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
  notifyDesktop: z.boolean().default(false),
  agentEnabled: z.boolean().default(false),
  agentPort: z.coerce.number().default(9182),
  orderIndex: z.coerce.number().default(0),
});

const typeIcon = (type: string) => {
  if (type === "server") return <Server className="w-3 h-3 mr-1" />;
  if (type === "device") return <Cpu className="w-3 h-3 mr-1" />;
  return <Monitor className="w-3 h-3 mr-1" />;
};

const typeLabel = (type: string) => {
  if (type === "server") return "Servidor";
  if (type === "device") return "Dispositivo";
  return "PC";
};

export default function Register() {
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [deletingHost, setDeletingHost] = useState<Host | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [sortField, setSortField] = useState<SortField>("ip");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [isDiscoverOpen, setIsDiscoverOpen] = useState(false);
  const [startIp, setStartIp] = useState("");
  const [endIp, setEndIp] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredHost[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: hosts, isLoading } = useListHosts();

  const createMutation = useCreateHost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListHostsQueryKey() });
        setIsDialogOpen(false);
        form.reset();
        toast({ title: "Sucesso", description: "Host adicionado com sucesso." });
      }
    }
  });

  const updateMutation = useUpdateHost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListHostsQueryKey() });
        setIsDialogOpen(false);
        setEditingHost(null);
        form.reset();
        toast({ title: "Sucesso", description: "Host atualizado com sucesso." });
      }
    }
  });

  const deleteMutation = useDeleteHost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListHostsQueryKey() });
        setDeletingHost(null);
        toast({ title: "Sucesso", description: "Host removido com sucesso." });
      }
    }
  });

  const discoverMutation = useDiscoverHosts({
    mutation: {
      onSuccess: (data) => {
        setDiscovered(data);
        setIsScanning(false);
      },
      onError: () => {
        setIsScanning(false);
        toast({ title: "Erro", description: "Falha ao escanear a rede.", variant: "destructive" });
      }
    }
  });

  const form = useForm<z.infer<typeof hostSchema>>({
    resolver: zodResolver(hostSchema),
    defaultValues: { name: "", ipAddress: "", type: "pc", userName: "", sector: "", enabled: true, notifyDesktop: false, agentEnabled: false, agentPort: 9182, orderIndex: 0 },
  });

  const openNewDialog = (prefill?: { name?: string; ipAddress?: string }) => {
    setEditingHost(null);
    form.reset({ name: prefill?.name || "", ipAddress: prefill?.ipAddress || "", type: "pc", userName: "", sector: "", enabled: true, notifyDesktop: false, agentEnabled: false, agentPort: 9182, orderIndex: (hosts?.length || 0) + 1 });
    setIsDialogOpen(true);
  };

  const openEditDialog = (host: Host) => {
    setEditingHost(host);
    form.reset({ name: host.name, ipAddress: host.ipAddress, type: host.type as "pc" | "server" | "device", userName: host.userName || "", sector: host.sector || "", enabled: host.enabled, notifyDesktop: host.notifyDesktop ?? false, agentEnabled: host.agentEnabled ?? false, agentPort: host.agentPort ?? 9182, orderIndex: host.orderIndex });
    setIsDialogOpen(true);
  };

  const onSubmit = (values: z.infer<typeof hostSchema>) => {
    if (editingHost) {
      updateMutation.mutate({ id: editingHost.id, data: values });
    } else {
      createMutation.mutate({ data: values });
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 ml-1 text-primary" /> : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  const typeOrder = { pc: 0, server: 1, device: 2 };

  const sortedHosts = (() => {
    const base = hosts ? [...hosts] : [];
    return base.sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.name.localeCompare(b.name);
      else if (sortField === "ip") {
        const toNum = (ip: string) => ip.split('.').map(Number).reduce((acc, v) => acc * 256 + v, 0);
        cmp = toNum(a.ipAddress) - toNum(b.ipAddress);
      } else if (sortField === "type") {
        cmp = (typeOrder[a.type as keyof typeof typeOrder] ?? 0) - (typeOrder[b.type as keyof typeof typeOrder] ?? 0);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  })();

  const handleDiscover = () => {
    if (!startIp || !endIp) {
      toast({ title: "Erro", description: "Preencha o intervalo de IPs.", variant: "destructive" });
      return;
    }
    setIsScanning(true);
    setDiscovered([]);
    discoverMutation.mutate({ data: { startIp, endIp } });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold font-mono tracking-tight">Cadastro</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">Gerencie os hosts monitorados pela aplicação.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setIsDiscoverOpen(true)} className="font-mono border-primary/50 text-primary hover:bg-primary/10 cursor-pointer">
            <Scan className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Descobrir Hosts</span>
            <span className="sm:hidden">Descobrir</span>
          </Button>
          <Button onClick={() => openNewDialog()} className="font-mono cursor-pointer">
            <Plus className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Adicionar Host</span>
            <span className="sm:hidden">Adicionar</span>
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-md bg-card shadow-xl overflow-x-auto">
        <Table>
          <TableHeader className="bg-secondary/50">
            <TableRow>
              <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("name")}>
                <span className="flex items-center">Nome / IP <SortIcon field="name" /></span>
              </TableHead>
              <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("type")}>
                <span className="flex items-center">Tipo <SortIcon field="type" /></span>
              </TableHead>
              <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("ip")}>
                <span className="flex items-center">IP <SortIcon field="ip" /></span>
              </TableHead>
              <TableHead className="font-mono text-xs font-bold text-muted-foreground">Detalhes</TableHead>
              <TableHead className="font-mono text-xs font-bold text-muted-foreground">Status</TableHead>
              <TableHead className="text-right font-mono text-xs font-bold text-muted-foreground">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
                </TableCell>
              </TableRow>
            ) : sortedHosts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-mono">
                  Nenhum host cadastrado.
                </TableCell>
              </TableRow>
            ) : (
              sortedHosts.map((host) => (
                <TableRow key={host.id} className="group hover:bg-secondary/20">
                  <TableCell>
                    <div className="font-mono font-bold text-foreground">{host.name}</div>
                    <div className="font-mono text-xs text-primary mt-1">{host.ipAddress}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono uppercase tracking-wider text-[10px] border-border">
                      {typeIcon(host.type)}
                      {typeLabel(host.type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{host.ipAddress}</TableCell>
                  <TableCell>
                    <div className="font-mono text-xs text-foreground">{host.userName || '-'}</div>
                    <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{host.sector || '-'}</div>
                  </TableCell>
                  <TableCell>
                    {host.enabled ? (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-mono text-[10px]">Ativo</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-muted text-muted-foreground border-border font-mono text-[10px]">Inativo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(host)} className="h-8 w-8">
                      <Edit2 className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeletingHost(host)} className="h-8 w-8">
                      <Trash2 className="w-4 h-4 text-muted-foreground group-hover:text-destructive transition-colors" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono text-xl">{editingHost ? "Editar Host" : "Novo Host"}</DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">Preencha os detalhes do dispositivo para monitoramento.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Nome do Host</FormLabel>
                    <FormControl><Input placeholder="Ex: PC-RH-01" className="font-mono" {...field} /></FormControl>
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
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Tipo</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-mono">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="pc" className="font-mono">PC Desktop</SelectItem>
                      <SelectItem value="server" className="font-mono">Servidor</SelectItem>
                      <SelectItem value="device" className="font-mono">Dispositivo (impressora, switch...)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage className="text-[10px]" />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="userName" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Usuário (Opcional)</FormLabel>
                    <FormControl><Input placeholder="João Silva" className="font-mono" {...field} value={field.value || ''} /></FormControl>
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
                <FormField control={form.control} name="sector" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Setor (Opcional)</FormLabel>
                    <FormControl><Input placeholder="Recursos Humanos" className="font-mono" {...field} value={field.value || ''} /></FormControl>
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="enabled" render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4 bg-secondary/20 mt-2">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base font-mono">Monitoramento Ativo</FormLabel>
                    <div className="text-[10px] text-muted-foreground font-mono">Habilita ou desabilita o ping para este host</div>
                  </div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="notifyDesktop" render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4 bg-secondary/20">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base font-mono">Notificação na Área de Trabalho</FormLabel>
                    <div className="text-[10px] text-muted-foreground font-mono">Envia notificação do Windows/SO quando o status mudar</div>
                  </div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="agentEnabled" render={({ field }) => (
                <FormItem className="rounded-lg border border-border p-4 bg-secondary/20 space-y-3">
                  <div className="flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base font-mono flex items-center gap-1.5">
                        Monitoramento Detalhado (Agent)
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button" className="cursor-pointer text-amber-500 hover:text-amber-400" title="Mais informações">
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-72 font-mono text-xs bg-amber-500/90 border-amber-500/30 text-amber-950" align="start">
                            É necessário instalar o <strong>NetMon Agent</strong> no host como serviço para coletar essas métricas. Disponível apenas para hosts <strong>Windows</strong>.
                          </PopoverContent>
                        </Popover>
                      </FormLabel>
                      <div className="text-[10px] text-muted-foreground font-mono">Coleta CPU, RAM, uptime e processos via windows_exporter</div>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </div>
                  {field.value && (
                    <FormField control={form.control} name="agentPort" render={({ field: portField }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Porta do Agent</FormLabel>
                        <FormControl><Input type="number" className="font-mono h-9" placeholder="9182" {...portField} /></FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )} />
                  )}
                </FormItem>
              )} />
              <div className="flex justify-end gap-3 pt-4 border-t border-border mt-6">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="font-mono">Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="font-mono">
                  {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Salvar
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isDiscoverOpen} onOpenChange={setIsDiscoverOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col border-border bg-card">
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-mono text-xl flex items-center gap-2">
              <Scan className="w-5 h-5 text-primary" />
              Descobrir Hosts na Rede
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">Varredura ICMP por intervalo de IPs. Máximo 254 endereços por vez.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2 overflow-hidden">
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex-1 space-y-1">
                <label className="font-mono text-xs uppercase text-muted-foreground">Início</label>
                <Input value={startIp} onChange={e => setStartIp(e.target.value)} placeholder="192.168.1.1" className="font-mono" />
              </div>
              <div className="pt-5 font-mono text-muted-foreground">-</div>
              <div className="flex-1 space-y-1">
                <label className="font-mono text-xs uppercase text-muted-foreground">Fim</label>
                <Input value={endIp} onChange={e => setEndIp(e.target.value)} placeholder="192.168.1.254" className="font-mono" />
              </div>
              <div className="pt-5">
                <Button onClick={handleDiscover} disabled={isScanning} className="font-mono cursor-pointer">
                  {isScanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Scan className="w-4 h-4 mr-2" />}
                  Escanear
                </Button>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono shrink-0">
              Quanto maior o intervalo, mais tempo leva. Apenas hosts que respondem ao ping são listados.
            </div>
            {discovered.length > 0 && (
              <div className="border border-border rounded-md overflow-hidden flex flex-col min-h-0">
                <div className="overflow-y-auto max-h-[45vh]">
                  <Table>
                    <TableHeader className="bg-secondary/50 sticky top-0 z-10">
                      <TableRow>
                        <TableHead className="font-mono text-xs font-bold">IP</TableHead>
                        <TableHead className="font-mono text-xs font-bold">Status</TableHead>
                        <TableHead className="text-right font-mono text-xs font-bold">Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {discovered.map((d, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-primary">{d.ipAddress}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-mono text-[10px]">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> ONLINE
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" className="font-mono text-[10px] h-7 cursor-pointer" onClick={() => openNewDialog({ ipAddress: d.ipAddress })}>
                              <Plus className="w-3 h-3 mr-1" /> Cadastrar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="px-3 py-2 border-t border-border bg-secondary/30 shrink-0">
                  <span className="font-mono text-[10px] text-muted-foreground">{discovered.length} host{discovered.length !== 1 ? 's' : ''} encontrado{discovered.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
            )}
            {isScanning && discovered.length === 0 && (
              <div className="h-32 flex items-center justify-center shrink-0">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="ml-2 font-mono text-sm text-muted-foreground">Escaneando... aguarde.</span>
              </div>
            )}
            {!isScanning && discovered.length === 0 && startIp && endIp && (
              <div className="h-32 flex items-center justify-center font-mono text-sm text-muted-foreground shrink-0">
                Nenhum host encontrado neste intervalo.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingHost} onOpenChange={(open) => !open && setDeletingHost(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono">Excluir Host</AlertDialogTitle>
            <AlertDialogDescription className="font-mono">
              Tem certeza que deseja excluir <span className="font-bold text-foreground">{deletingHost?.name}</span> ({deletingHost?.ipAddress})? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deletingHost && deleteMutation.mutate({ id: deletingHost.id })} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono">
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
