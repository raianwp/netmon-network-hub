import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useGetSettings,
  useUpdateSettings,
  useGetMikrotikConfig,
  useSaveMikrotikConfig,
  useListUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useGetBackupStatus,
  useRunBackup,
  useGetInternetStatus,
  getGetInternetStatusQueryKey,
  getGetSettingsQueryKey,
  getGetMikrotikConfigQueryKey,
  getListUsersQueryKey,
  getGetBackupStatusQueryKey,
  User
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Settings2, Router, Users, Trash2, Plus, Loader2, KeyRound, Info, Plug, CheckCircle2, XCircle, Database, FolderArchive, Clock, RefreshCw, Shield, Globe } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const appSettingsSchema = z.object({
  checkIntervalSeconds: z.coerce.number().min(10).max(3600),
  pingAttempts: z.coerce.number().min(1).max(10),
  pingTimeoutMs: z.coerce.number().min(100).max(30000),
  failuresBeforeOffline: z.coerce.number().min(1).max(10),
  notificationDurationSeconds: z.coerce.number().min(1).max(60),
  agentCheckIntervalSeconds: z.coerce.number().min(15).max(3600),
});

const mikrotikSchema = z.object({
  name: z.string().min(1),
  ipAddress: z.string().min(7),
  apiUser: z.string().min(1),
  apiPassword: z.string(),
  apiPort: z.coerce.number().default(80),
  enabled: z.boolean().default(false),
  refreshIntervalSeconds: z.coerce.number().min(5).max(3600).default(30),
});

const userSchema = z.object({
  username: z.string().min(3, "Mínimo 3 caracteres"),
  password: z.string().min(6, "Mínimo 6 caracteres"),
  role: z.enum(["admin", "viewer"]).default("viewer"),
  canAccessAiTerminal: z.boolean().default(false),
});

const changePasswordSchema = z.object({
  password: z.string().min(6, "Mínimo 6 caracteres"),
  confirmPassword: z.string().min(6, "Mínimo 6 caracteres"),
}).refine(d => d.password === d.confirmPassword, {
  message: "As senhas não coincidem",
  path: ["confirmPassword"],
});

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [backupIntervalHours, setBackupIntervalHours] = useState("24");
  const [activeTab, setActiveTab] = useState("monitoring");

  const [internetEnabled, setInternetEnabled] = useState(true);
  const [internetInterval, setInternetInterval] = useState("120");
  const [internetHosts, setInternetHosts] = useState<string[]>(["8.8.8.8", "1.1.1.1"]);
  const [internetNotify, setInternetNotify] = useState(false);
  const [newHostInput, setNewHostInput] = useState("");

  const { data: settings } = useGetSettings();
  const { data: mkConfig } = useGetMikrotikConfig();
  const { data: users, isLoading: isLoadingUsers } = useListUsers();
  const { data: internetStatus } = useGetInternetStatus({ query: { queryKey: getGetInternetStatusQueryKey(), refetchInterval: 30000 } });
  const { data: backupStatus, refetch: refetchBackup } = useGetBackupStatus({
    query: { queryKey: getGetBackupStatusQueryKey(), refetchInterval: 30000 }
  });

  const updateSettingsMutation = useUpdateSettings({
    mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() }); toast({ title: "Configurações salvas" }); } }
  });

  const updateMkMutation = useSaveMikrotikConfig({
    mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetMikrotikConfigQueryKey() }); toast({ title: "Integração MikroTik salva" }); } }
  });

  const createUserMutation = useCreateUser({
    mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); userForm.reset(); toast({ title: "Usuário criado" }); } }
  });

  const updateUserMutation = useUpdateUser({
    mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); setEditingUser(null); pwForm.reset(); toast({ title: "Senha alterada com sucesso" }); } }
  });

  const deleteUserMutation = useDeleteUser({
    mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); toast({ title: "Usuário removido" }); } }
  });

  const toggleAiTerminalMutation = useUpdateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: "Acesso ao IA Terminal atualizado" });
      },
      onError: () => toast({ title: "Erro", description: "Não foi possível atualizar o acesso.", variant: "destructive" }),
    }
  });

  const runBackupMutation = useRunBackup({
    mutation: {
      onSuccess: (data) => {
        refetchBackup();
        if (data.ok) {
          toast({ title: "Backup realizado!", description: data.message });
        } else {
          toast({ title: "Erro no backup", description: data.message, variant: "destructive" });
        }
      }
    }
  });

  const appForm = useForm<z.infer<typeof appSettingsSchema>>({
    resolver: zodResolver(appSettingsSchema),
    defaultValues: { checkIntervalSeconds: 120, pingAttempts: 3, pingTimeoutMs: 3000, failuresBeforeOffline: 3, notificationDurationSeconds: 10, agentCheckIntervalSeconds: 60 }
  });

  const mkForm = useForm<z.infer<typeof mikrotikSchema>>({
    resolver: zodResolver(mikrotikSchema),
    defaultValues: { name: "Router Principal", ipAddress: "", apiUser: "", apiPassword: "", apiPort: 80, enabled: false, refreshIntervalSeconds: 30 }
  });

  const userForm = useForm<z.infer<typeof userSchema>>({
    resolver: zodResolver(userSchema),
    defaultValues: { username: "", password: "", role: "viewer", canAccessAiTerminal: false }
  });

  const pwForm = useForm<z.infer<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { password: "", confirmPassword: "" }
  });

  useEffect(() => {
    if (settings) {
      appForm.reset({
        checkIntervalSeconds: settings.checkIntervalSeconds,
        pingAttempts: settings.pingAttempts,
        pingTimeoutMs: settings.pingTimeoutMs,
        failuresBeforeOffline: settings.failuresBeforeOffline,
        notificationDurationSeconds: settings.notificationDurationSeconds,
        agentCheckIntervalSeconds: settings.agentCheckIntervalSeconds,
      });
      setBackupIntervalHours(String(settings.backupIntervalHours ?? 24));
      setInternetEnabled(settings.internetCheckEnabled ?? true);
      setInternetInterval(String(settings.internetCheckIntervalSeconds ?? 120));
      if (settings.internetCheckHosts && settings.internetCheckHosts.length > 0) {
        setInternetHosts(settings.internetCheckHosts);
      }
      setInternetNotify(settings.internetCheckNotifyDesktop ?? false);
    }
  }, [settings]);

  useEffect(() => {
    if (mkConfig) mkForm.reset({
      name: mkConfig.name,
      ipAddress: mkConfig.ipAddress,
      apiUser: mkConfig.apiUser,
      apiPassword: "",
      apiPort: mkConfig.apiPort,
      enabled: mkConfig.enabled,
      refreshIntervalSeconds: mkConfig.refreshIntervalSeconds,
    });
  }, [mkConfig]);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/mikrotik/test", { credentials: "include" });
      const data = await res.json() as { ok: boolean; url?: string; error?: string; version?: string; statusCode?: number; detail?: string };
      if (data.ok) {
        setTestResult({ ok: true, message: `Conectado! RouterOS v${data.version} — ${data.url}` });
      } else {
        const detail = data.detail ? ` (${data.detail.slice(0,80)})` : "";
        setTestResult({ ok: false, message: `Falha: ${data.error ?? "Erro desconhecido"}${detail}` });
      }
    } catch {
      setTestResult({ ok: false, message: "Erro de rede ao tentar conectar." });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveBackupInterval = () => {
    updateSettingsMutation.mutate({ data: { backupIntervalHours: parseInt(backupIntervalHours) } });
  };

  const onAppSubmit = (v: z.infer<typeof appSettingsSchema>) => updateSettingsMutation.mutate({ data: v });
  const onMkSubmit = (v: z.infer<typeof mikrotikSchema>) => updateMkMutation.mutate({ data: v });
  const onUserSubmit = (v: z.infer<typeof userSchema>) => createUserMutation.mutate({ data: v });
  const onPwSubmit = (v: z.infer<typeof changePasswordSchema>) => {
    if (editingUser) updateUserMutation.mutate({ id: editingUser.id, data: { password: v.password } });
  };

  return (
    <div className="space-y-6 max-w-5xl w-full min-w-0 mx-auto pb-10">
      <div>
        <h1 className="text-3xl font-bold font-mono tracking-tight">Configurações</h1>
        <p className="text-muted-foreground text-sm font-mono mt-1">Parâmetros do sistema, integração e controle de acesso.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5 bg-secondary border border-border h-auto min-h-11">
          <TabsTrigger value="monitoring" className="font-mono uppercase tracking-wider text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-1.5 py-2">
            <Settings2 className="w-4 h-4 sm:mr-2 shrink-0" />
            <span className="hidden sm:inline">Monitoramento</span>
          </TabsTrigger>
          <TabsTrigger value="backup" className="font-mono uppercase tracking-wider text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-1.5 py-2">
            <Database className="w-4 h-4 sm:mr-2 shrink-0" />
            <span className="hidden sm:inline">Backup</span>
          </TabsTrigger>
          <TabsTrigger value="mikrotik" className="font-mono uppercase tracking-wider text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-1.5 py-2">
            <Router className="w-4 h-4 sm:mr-2 shrink-0" />
            <span className="hidden sm:inline">Dashboard</span>
          </TabsTrigger>
          <TabsTrigger value="users" className="font-mono uppercase tracking-wider text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-1.5 py-2">
            <Users className="w-4 h-4 sm:mr-2 shrink-0" />
            <span className="hidden sm:inline">Usuários</span>
          </TabsTrigger>
          <TabsTrigger value="internet" className="font-mono uppercase tracking-wider text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-1.5 py-2">
            <Globe className="w-4 h-4 sm:mr-2 shrink-0" />
            <span className="hidden sm:inline">Internet</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="monitoring" className="mt-4">
          <Card className="bg-card/50 backdrop-blur border-border shadow-md">
            <CardHeader className="border-b border-border/50">
              <div className="flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-primary" />
                <CardTitle className="font-mono">Parâmetros de Monitoramento</CardTitle>
              </div>
              <CardDescription className="font-mono text-xs">Configurações do motor de polling e alertas</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <Form {...appForm}>
                <form onSubmit={appForm.handleSubmit(onAppSubmit)} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={appForm.control} name="checkIntervalSeconds" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Intervalo de Checagem (s)</FormLabel>
                        <FormControl><Input type="number" className="font-mono" {...field} /></FormControl>
                        <p className="text-[10px] text-muted-foreground font-mono mt-1">Tempo de espera entre um ciclo completo de pings e o próximo. Ex: 120 = verifica todos os hosts a cada 2 minutos.</p>
                      </FormItem>
                    )} />
                    <FormField control={appForm.control} name="pingAttempts" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Tentativas por Checagem</FormLabel>
                        <FormControl><Input type="number" className="font-mono" {...field} /></FormControl>
                        <p className="text-[10px] text-muted-foreground font-mono mt-1">Quantos pings são enviados em sequência imediata por ciclo. Se qualquer um responder, o host é marcado online.</p>
                      </FormItem>
                    )} />
                    <FormField control={appForm.control} name="pingTimeoutMs" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Timeout do Ping (ms)</FormLabel>
                        <FormControl><Input type="number" className="font-mono" {...field} /></FormControl>
                        <p className="text-[10px] text-muted-foreground font-mono mt-1">Tempo máximo de espera por resposta de cada ping. Ex: 3000 = aguarda 3 segundos por resposta.</p>
                      </FormItem>
                    )} />
                    <FormField control={appForm.control} name="failuresBeforeOffline" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Ciclos com Falha para Offline</FormLabel>
                        <FormControl><Input type="number" className="font-mono" {...field} /></FormControl>
                        <p className="text-[10px] text-muted-foreground font-mono mt-1">Quantos ciclos consecutivos sem resposta para marcar o host como OFFLINE.</p>
                      </FormItem>
                    )} />
                    <FormField control={appForm.control} name="notificationDurationSeconds" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Duração das notificações (segundos)</FormLabel>
                        <FormControl><Input type="number" min={1} max={60} className="font-mono" {...field} /></FormControl>
                        <p className="text-[10px] text-muted-foreground font-mono mt-1">Tempo que o pop-up de mudança de status fica visível antes de fechar automaticamente.</p>
                      </FormItem>
                    )} />
                    <FormField control={appForm.control} name="agentCheckIntervalSeconds" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Intervalo do Agent (segundos)</FormLabel>
                        <FormControl><Input type="number" min={15} max={3600} className="font-mono" {...field} /></FormControl>
                        <p className="text-[10px] text-muted-foreground font-mono mt-1">De quanto em quanto tempo coleta CPU/RAM dos hosts com Monitoramento Detalhado (Agent) ativado.</p>
                      </FormItem>
                    )} />
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button type="submit" disabled={updateSettingsMutation.isPending} className="font-mono">
                      {updateSettingsMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Salvar Parâmetros
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backup" className="mt-4">
          <Card className="bg-card/50 backdrop-blur border-border shadow-md">
            <CardHeader className="border-b border-border/50">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-primary" />
                <CardTitle className="font-mono">Backup Automático</CardTitle>
              </div>
              <CardDescription className="font-mono text-xs">Cópia do banco de dados e arquivos de configuração</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-5">
              <div className="flex items-start gap-3 p-4 rounded-md bg-primary/5 border border-primary/20 text-xs font-mono text-muted-foreground">
                <FolderArchive className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-foreground font-medium">Destino dos arquivos de backup:</p>
                  <p className="font-mono text-primary text-sm">{backupStatus?.backupDir ?? "/opt/netmon/backups"}</p>
                  <p className="mt-2">O backup inclui um dump completo do banco de dados PostgreSQL e uma cópia do arquivo <strong className="text-foreground">.env</strong>. Apenas o backup mais recente é mantido — o anterior é removido automaticamente a cada ciclo.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-md border border-border bg-secondary/20 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-mono uppercase text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    Último Backup
                  </div>
                  {backupStatus?.lastBackupAt ? (
                    <div>
                      <p className="font-mono font-bold text-foreground">{format(new Date(backupStatus.lastBackupAt), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</p>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{formatDistanceToNow(new Date(backupStatus.lastBackupAt), { locale: ptBR, addSuffix: true })}</p>
                    </div>
                  ) : (
                    <p className="font-mono text-muted-foreground text-sm">Nenhum backup realizado ainda</p>
                  )}
                </div>
                <div className="rounded-md border border-border bg-secondary/20 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-mono uppercase text-muted-foreground">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Próximo Backup
                  </div>
                  {backupStatus?.nextBackupAt ? (
                    <div>
                      <p className="font-mono font-bold text-foreground">{format(new Date(backupStatus.nextBackupAt), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</p>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{formatDistanceToNow(new Date(backupStatus.nextBackupAt), { locale: ptBR, addSuffix: true })}</p>
                    </div>
                  ) : (
                    <p className="font-mono text-muted-foreground text-sm">Após o primeiro backup manual</p>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 pt-2 border-t border-border">
                <div className="flex-1 space-y-1.5">
                  <label className="font-mono text-xs uppercase text-muted-foreground">Frequência do Backup Automático</label>
                  <Select value={backupIntervalHours} onValueChange={setBackupIntervalHours}>
                    <SelectTrigger className="font-mono w-full sm:w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1" className="font-mono">A cada 1 hora</SelectItem>
                      <SelectItem value="6" className="font-mono">A cada 6 horas</SelectItem>
                      <SelectItem value="12" className="font-mono">A cada 12 horas</SelectItem>
                      <SelectItem value="24" className="font-mono">1× por dia (padrão)</SelectItem>
                      <SelectItem value="48" className="font-mono">A cada 2 dias</SelectItem>
                      <SelectItem value="168" className="font-mono">1× por semana</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground font-mono">O sistema verifica a cada 5 minutos se está na hora de fazer o backup.</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleSaveBackupInterval} disabled={updateSettingsMutation.isPending} className="font-mono">
                    {updateSettingsMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Salvar Intervalo
                  </Button>
                  <Button onClick={() => runBackupMutation.mutate()} disabled={runBackupMutation.isPending} className="font-mono bg-primary hover:bg-primary/90">
                    {runBackupMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Executando...</> : <><Database className="w-4 h-4 mr-2" />Fazer Backup Agora</>}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mikrotik" className="mt-4">
          <Card className="bg-card/50 backdrop-blur border-border shadow-md">
            <CardHeader className="border-b border-border/50">
              <div className="flex items-center gap-2">
                <Router className="w-5 h-5 text-primary" />
                <CardTitle className="font-mono">Integração MikroTik</CardTitle>
              </div>
              <CardDescription className="font-mono text-xs">Conexão via REST API HTTP com o roteador principal</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="flex items-start gap-2 p-3 rounded-md bg-primary/5 border border-primary/20 mb-4 text-xs font-mono text-muted-foreground">
                <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <span>Esta integração usa a <strong className="text-foreground">REST API HTTP</strong> do RouterOS (porta padrão <strong className="text-foreground">80</strong>). No MikroTik: <strong className="text-foreground">IP → Services → www → habilitado</strong>.<br/>Não confunda com a API Winbox (porta 8728) — são serviços diferentes.</span>
              </div>
              <Form {...mkForm}>
                <form onSubmit={mkForm.handleSubmit(onMkSubmit)} className="space-y-4">
                  <FormField control={mkForm.control} name="enabled" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4 bg-secondary/20 mb-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base font-mono">Integração Ativa</FormLabel>
                        <div className="text-[10px] text-muted-foreground font-mono">Habilita a coleta de dados via RouterOS REST API</div>
                      </div>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={mkForm.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Identificação</FormLabel>
                        <FormControl><Input className="font-mono" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={mkForm.control} name="ipAddress" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Endereço IP</FormLabel>
                        <FormControl><Input className="font-mono" placeholder="192.168.88.1" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={mkForm.control} name="apiUser" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Usuário API</FormLabel>
                        <FormControl><Input className="font-mono" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={mkForm.control} name="apiPassword" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Senha API (deixe em branco p/ manter)</FormLabel>
                        <FormControl><Input type="password" placeholder="••••••••" className="font-mono" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={mkForm.control} name="apiPort" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Porta HTTP (padrão: 80)</FormLabel>
                        <FormControl><Input type="number" className="font-mono" {...field} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={mkForm.control} name="refreshIntervalSeconds" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Intervalo de atualização do dashboard (segundos)</FormLabel>
                        <FormControl><Input type="number" min={5} max={3600} className="font-mono" {...field} /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                  {testResult && (
                    <div className={`flex items-start gap-2 p-3 rounded-md text-xs font-mono border ${testResult.ok ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 border-destructive/30 text-destructive"}`}>
                      {testResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                      <span>{testResult.message}</span>
                    </div>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={handleTestConnection} disabled={isTesting} className="font-mono border-primary/40 text-primary hover:bg-primary/10">
                      {isTesting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plug className="w-4 h-4 mr-2" />}
                      Testar Conexão
                    </Button>
                    <Button type="submit" disabled={updateMkMutation.isPending} className="font-mono">
                      {updateMkMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Salvar Integração
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <Card className="bg-card/50 backdrop-blur border-border shadow-md">
            <CardHeader className="border-b border-border/50">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                <CardTitle className="font-mono">Controle de Acesso</CardTitle>
              </div>
              <CardDescription className="font-mono text-xs">Gerenciamento de administradores e viewers</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 border-r-0 lg:border-r border-border pr-0 lg:pr-6">
                <Form {...userForm}>
                  <form onSubmit={userForm.handleSubmit(onUserSubmit)} className="space-y-4">
                    <h3 className="font-mono font-medium text-sm border-b border-border pb-2">Novo Usuário</h3>
                    <FormField control={userForm.control} name="username" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Login</FormLabel>
                        <FormControl><Input className="font-mono h-9 text-sm" {...field} /></FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )} />
                    <FormField control={userForm.control} name="password" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Senha</FormLabel>
                        <FormControl><Input type="password" className="font-mono h-9 text-sm" {...field} /></FormControl>
                        <FormMessage className="text-[10px]" />
                        <p className="text-[10px] text-muted-foreground font-mono">Mínimo 6 caracteres</p>
                      </FormItem>
                    )} />
                    <FormField control={userForm.control} name="canAccessAiTerminal" render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-3 bg-secondary/20">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm font-mono">IA Terminal</FormLabel>
                          <div className="text-[10px] text-muted-foreground font-mono">Permite acessar o Terminal com IA</div>
                        </div>
                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      </FormItem>
                    )} />
                    <FormField control={userForm.control} name="role" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Grupo</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger className="font-mono h-9 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="admin" className="font-mono"><Shield className="w-3 h-3 mr-2 inline text-primary" /> Admin</SelectItem>
                            <SelectItem value="viewer" className="font-mono">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage className="text-[10px]" />
                        <p className="text-[10px] text-muted-foreground font-mono">Admin: acesso total. Viewer: apenas visualização.</p>
                      </FormItem>
                    )} />
                    <Button type="submit" className="w-full font-mono text-xs" disabled={createUserMutation.isPending}>
                      <Plus className="w-3 h-3 mr-2" />
                      Adicionar
                    </Button>
                  </form>
                </Form>
              </div>

              <div className="lg:col-span-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-mono text-xs font-bold">Usuário</TableHead>
                      <TableHead className="font-mono text-xs font-bold">Grupo</TableHead>
                      <TableHead className="font-mono text-xs font-bold">IA Terminal</TableHead>
                      <TableHead className="font-mono text-xs font-bold">Criado em</TableHead>
                      <TableHead className="text-right font-mono text-xs font-bold">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingUsers ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-4"><Loader2 className="w-4 h-4 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                    ) : users?.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-mono font-medium">{u.username}</TableCell>
                        <TableCell>
                          <span className={`font-mono text-[10px] px-2 py-0.5 rounded-full ${u.role === 'admin' ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                            {u.role === 'admin' ? 'Admin' : 'Viewer'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={u.canAccessAiTerminal}
                            onCheckedChange={(checked) => toggleAiTerminalMutation.mutate({ id: u.id, data: { canAccessAiTerminal: checked } })}
                            disabled={toggleAiTerminalMutation.isPending}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {format(new Date(u.createdAt), "dd/MM/yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => { setEditingUser(u); pwForm.reset(); }} title="Alterar senha">
                            <KeyRound className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => { if(confirm("Remover usuário?")) deleteUserMutation.mutate({ id: u.id }); }} disabled={deleteUserMutation.isPending}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="internet">
          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="font-mono text-sm flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                Verificação de Conexão à Internet
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                Monitoramento de conectividade externa via ICMP. Status atual:{" "}
                {internetStatus?.status === "online" && <span className="text-emerald-500 font-medium">Online</span>}
                {internetStatus?.status === "offline" && <span className="text-red-500 font-medium">Offline / Falha</span>}
                {(!internetStatus || internetStatus.status === "unknown") && <span className="text-muted-foreground">Verificando...</span>}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-sm font-medium">Habilitar verificação</p>
                  <p className="font-mono text-xs text-muted-foreground mt-0.5">Monitora conectividade com a internet a cada intervalo configurado</p>
                </div>
                <button
                  type="button"
                  onClick={() => setInternetEnabled(v => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${internetEnabled ? "bg-primary" : "bg-secondary border border-border"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${internetEnabled ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>

              <div className="space-y-2">
                <label className="font-mono text-xs uppercase text-muted-foreground tracking-wider">Intervalo de verificação (segundos)</label>
                <Input
                  type="number"
                  min={30}
                  max={3600}
                  className="font-mono w-48"
                  value={internetInterval}
                  onChange={e => setInternetInterval(e.target.value)}
                  disabled={!internetEnabled}
                />
                <p className="font-mono text-xs text-muted-foreground">Mínimo: 30s. Padrão: 120s.</p>
              </div>

              <div className="space-y-3">
                <label className="font-mono text-xs uppercase text-muted-foreground tracking-wider">Hosts de verificação (IPs externos)</label>
                <div className="space-y-2">
                  {internetHosts.map((host, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="font-mono text-sm flex-1 bg-secondary border border-border rounded-md px-3 py-1.5">{host}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={internetHosts.length <= 1 || !internetEnabled}
                        onClick={() => setInternetHosts(hosts => hosts.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    className="font-mono flex-1"
                    placeholder="Ex: 8.8.8.8"
                    value={newHostInput}
                    onChange={e => setNewHostInput(e.target.value)}
                    disabled={!internetEnabled}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const h = newHostInput.trim();
                        if (h && !internetHosts.includes(h)) {
                          setInternetHosts(hosts => [...hosts, h]);
                          setNewHostInput("");
                        }
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="font-mono"
                    disabled={!internetEnabled || !newHostInput.trim()}
                    onClick={() => {
                      const h = newHostInput.trim();
                      if (h && !internetHosts.includes(h)) {
                        setInternetHosts(hosts => [...hosts, h]);
                        setNewHostInput("");
                      }
                    }}
                  >
                    <Plus className="w-4 h-4 mr-1" /> Adicionar
                  </Button>
                </div>
                <p className="font-mono text-xs text-muted-foreground">Online se qualquer host responder ao ping. Mínimo: 1 host.</p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-sm font-medium">Notificação desktop</p>
                  <p className="font-mono text-xs text-muted-foreground mt-0.5">Alerta quando a conexão mudar de estado</p>
                </div>
                <button
                  type="button"
                  onClick={() => setInternetNotify(v => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${internetNotify ? "bg-primary" : "bg-secondary border border-border"}`}
                  disabled={!internetEnabled}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${internetNotify ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>

              <div className="flex justify-end pt-2 border-t border-border">
                <Button
                  type="button"
                  className="font-mono"
                  disabled={updateSettingsMutation.isPending}
                  onClick={() => {
                    const interval = parseInt(internetInterval);
                    if (isNaN(interval) || interval < 30) {
                      toast({ title: "Intervalo inválido", description: "Mínimo 30 segundos.", variant: "destructive" });
                      return;
                    }
                    if (internetHosts.length === 0) {
                      toast({ title: "Nenhum host configurado", description: "Adicione ao menos um host.", variant: "destructive" });
                      return;
                    }
                    updateSettingsMutation.mutate({
                      data: {
                        internetCheckEnabled: internetEnabled,
                        internetCheckIntervalSeconds: interval,
                        internetCheckHosts: internetHosts,
                        internetCheckNotifyDesktop: internetNotify,
                      }
                    }, {
                      onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
                        toast({ title: "Configurações salvas", description: "Verificação de internet atualizada." });
                      },
                      onError: () => toast({ title: "Erro", description: "Não foi possível salvar.", variant: "destructive" }),
                    });
                  }}
                >
                  {updateSettingsMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Salvar
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="sm:max-w-[400px] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" />
              Alterar Senha — {editingUser?.username}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">Digite a nova senha. Mínimo 6 caracteres.</DialogDescription>
          </DialogHeader>
          <Form {...pwForm}>
            <form onSubmit={pwForm.handleSubmit(onPwSubmit)} className="space-y-4 pt-2">
              <FormField control={pwForm.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Nova Senha</FormLabel>
                  <FormControl><Input type="password" className="font-mono" {...field} /></FormControl>
                  <FormMessage className="text-[10px]" />
                </FormItem>
              )} />
              <FormField control={pwForm.control} name="confirmPassword" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Confirmar Senha</FormLabel>
                  <FormControl><Input type="password" className="font-mono" {...field} /></FormControl>
                  <FormMessage className="text-[10px]" />
                </FormItem>
              )} />
              <div className="flex justify-end gap-3 pt-2 border-t border-border">
                <Button type="button" variant="outline" className="font-mono" onClick={() => setEditingUser(null)}>Cancelar</Button>
                <Button type="submit" className="font-mono" disabled={updateUserMutation.isPending}>
                  {updateUserMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Salvar
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
