import { useState } from "react";
import {
  useListHosts,
  useListHostStatuses,
  useGetMonitoringSummary,
  useTriggerMonitoring,
  getListHostStatusesQueryKey,
  getGetMonitoringSummaryQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Server, Monitor, Cpu, CheckCircle2, XCircle, HelpCircle, Loader2, WifiOff, Wifi, Play, ArrowUpDown, ArrowUp, ArrowDown, Search, Terminal, Activity } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNow, differenceInMinutes, differenceInHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { PingTestDialog } from "@/components/ping-test-dialog";
import { AgentMetricsDialog } from "@/components/agent-metrics-dialog";

type SortField = "name" | "ip" | "user" | "latency" | "uptime" | "lastOnline" | "lastOffline" | "status";
type SortDir = "asc" | "desc";
type TabType = "pc" | "server" | "device";

function formatUptime(lastOfflineAt: string | null | undefined, lastOnlineAt: string | null | undefined): string {
  if (!lastOnlineAt) return "--";
  const since = lastOfflineAt ? new Date(lastOfflineAt) : null;
  if (!since) return "Sempre online";
  const now = new Date();
  const totalMins = differenceInMinutes(now, since);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = differenceInHours(now, since);
  if (hours < 24) return `${hours}h ${totalMins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function parseUptimeMinutes(lastOfflineAt: string | null | undefined, lastOnlineAt: string | null | undefined): number {
  if (!lastOnlineAt) return 0;
  const since = lastOfflineAt ? new Date(lastOfflineAt) : null;
  if (!since) return Number.MAX_SAFE_INTEGER;
  return differenceInMinutes(new Date(), since);
}

export default function Hosts() {
  const [activeTab, setActiveTab] = useState<TabType>("pc");
  const [sortField, setSortField] = useState<SortField>("ip");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");
  const [pingTestOpen, setPingTestOpen] = useState(false);
  const [agentDialogHost, setAgentDialogHost] = useState<{ id: number; name: string } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: hosts, isLoading: isHostsLoading } = useListHosts();

  const { data: statuses } = useListHostStatuses({
    query: { queryKey: getListHostStatusesQueryKey(), refetchInterval: 10000 }
  });

  const { data: summary } = useGetMonitoringSummary({
    query: { queryKey: getGetMonitoringSummaryQueryKey(), refetchInterval: 10000 }
  });

  const triggerMutation = useTriggerMonitoring({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListHostStatusesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMonitoringSummaryQueryKey() });
        toast({ title: "Verificação iniciada", description: "Ciclo de ping disparado." });
      }
    }
  });

  const getStatusForHost = (hostId: number) => statuses?.find(s => s.hostId === hostId);

  const getStatusBadge = (status?: string) => {
    switch(status) {
      case 'online':
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-mono"><CheckCircle2 className="w-3 h-3 mr-1" /> ONLINE</Badge>;
      case 'offline':
        return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 font-mono"><XCircle className="w-3 h-3 mr-1" /> OFFLINE</Badge>;
      default:
        return <Badge variant="outline" className="bg-muted text-muted-foreground border-border font-mono"><HelpCircle className="w-3 h-3 mr-1" /> DESCONHECIDO</Badge>;
    }
  };

  const statusOrder = { online: 0, unknown: 1, offline: 2 };

  const sortedHosts = (() => {
    const q = search.trim().toLowerCase();
    const base = (hosts?.filter(h => h.type === activeTab && h.enabled) ?? []).filter(h => {
      if (!q) return true;
      const status = getStatusForHost(h.id)?.status ?? "desconhecido";
      return (
        h.name.toLowerCase().includes(q) ||
        h.ipAddress.toLowerCase().includes(q) ||
        (h.userName ?? "").toLowerCase().includes(q) ||
        (h.sector ?? "").toLowerCase().includes(q) ||
        status.toLowerCase().includes(q)
      );
    });
    return [...base].sort((a, b) => {
      let cmp = 0;
      const sa = getStatusForHost(a.id);
      const sb = getStatusForHost(b.id);
      if (sortField === "name") {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === "ip") {
        const toNum = (ip: string) => ip.split('.').map(Number).reduce((acc, v) => acc * 256 + v, 0);
        cmp = toNum(a.ipAddress) - toNum(b.ipAddress);
      } else if (sortField === "user") {
        const ua = (a.userName || "").toLowerCase();
        const ub = (b.userName || "").toLowerCase();
        cmp = ua.localeCompare(ub);
      } else if (sortField === "latency") {
        const la = sa?.responseTimeMs ?? Number.MAX_SAFE_INTEGER;
        const lb = sb?.responseTimeMs ?? Number.MAX_SAFE_INTEGER;
        cmp = la - lb;
      } else if (sortField === "uptime") {
        const ua = parseUptimeMinutes(sa?.lastOfflineAt, sa?.lastOnlineAt);
        const ub = parseUptimeMinutes(sb?.lastOfflineAt, sb?.lastOnlineAt);
        cmp = ua - ub;
      } else if (sortField === "lastOnline") {
        const ta = sa?.lastOnlineAt ? new Date(sa.lastOnlineAt).getTime() : 0;
        const tb = sb?.lastOnlineAt ? new Date(sb.lastOnlineAt).getTime() : 0;
        cmp = ta - tb;
      } else if (sortField === "lastOffline") {
        const ta = sa?.lastOfflineAt ? new Date(sa.lastOfflineAt).getTime() : 0;
        const tb = sb?.lastOfflineAt ? new Date(sb.lastOfflineAt).getTime() : 0;
        cmp = ta - tb;
      } else if (sortField === "status") {
        const sta = sa?.status ?? "unknown";
        const stb = sb?.status ?? "unknown";
        cmp = (statusOrder[sta as keyof typeof statusOrder] ?? 1) - (statusOrder[stb as keyof typeof statusOrder] ?? 1);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  })();

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  const tabCount = (type: TabType) => hosts?.filter(h => h.type === type && h.enabled).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold font-mono tracking-tight">Monitoramento</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">Acompanhamento em tempo real dos ativos da rede.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-0 md:flex-initial">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar host..."
              className="pl-8 h-8 w-full md:w-48 font-mono text-xs bg-secondary/50 border-border md:focus:w-64 transition-all duration-200"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
            className="font-mono border-primary/50 text-primary hover:bg-primary/10"
          >
            {triggerMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            <span className="hidden sm:inline">Forçar Verificação</span>
            <span className="sm:hidden">Forçar</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPingTestOpen(true)}
            className="font-mono border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Terminal className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Teste Ping</span>
            <span className="sm:hidden">Ping</span>
          </Button>
        </div>
      </div>

      <PingTestDialog open={pingTestOpen} onOpenChange={setPingTestOpen} />
      <AgentMetricsDialog
        open={!!agentDialogHost}
        onOpenChange={(open) => !open && setAgentDialogHost(null)}
        hostId={agentDialogHost?.id ?? null}
        hostName={agentDialogHost?.name}
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="w-full">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <TabsList className="grid w-full sm:w-[500px] grid-cols-3 bg-secondary border border-border h-auto min-h-11">
          <TabsTrigger value="pc" className="font-mono uppercase tracking-wider text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-1 py-2">
            <Monitor className="w-4 h-4 sm:mr-2 shrink-0" />
            <span className="hidden sm:inline">PCs</span>
            <span className="sm:hidden">PC</span>
            <span className="ml-1 sm:ml-2 bg-background/20 text-current px-1.5 sm:px-2 py-0.5 rounded-full text-[10px]">{tabCount("pc")}</span>
          </TabsTrigger>
          <TabsTrigger value="server" className="font-mono uppercase tracking-wider text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-1 py-2">
            <Server className="w-4 h-4 sm:mr-2 shrink-0" />
            <span className="hidden sm:inline">Servidores</span>
            <span className="sm:hidden">Serv.</span>
            <span className="ml-1 sm:ml-2 bg-background/20 text-current px-1.5 sm:px-2 py-0.5 rounded-full text-[10px]">{tabCount("server")}</span>
          </TabsTrigger>
          <TabsTrigger value="device" className="font-mono uppercase tracking-wider text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-1 py-2">
            <Cpu className="w-4 h-4 sm:mr-2 shrink-0" />
            <span className="hidden sm:inline">Dispositivos</span>
            <span className="sm:hidden">Disp.</span>
            <span className="ml-1 sm:ml-2 bg-background/20 text-current px-1.5 sm:px-2 py-0.5 rounded-full text-[10px]">{tabCount("device")}</span>
          </TabsTrigger>
        </TabsList>

          <div className="flex items-center gap-3 sm:ml-2 flex-wrap">
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-emerald-500 font-bold">{summary?.online ?? '--'}</span>
              <span className="text-muted-foreground">online</span>
            </div>
            <div className="text-border">|</div>
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <XCircle className="w-3.5 h-3.5 text-destructive" />
              <span className="text-destructive font-bold">{summary?.offline ?? '--'}</span>
              <span className="text-muted-foreground">offline</span>
            </div>
            <div className="text-border">|</div>
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground font-bold">{summary?.unknown ?? '--'}</span>
              <span className="text-muted-foreground">desc.</span>
            </div>
          </div>
        </div>

        <div className="mt-4 border border-border rounded-md bg-card shadow-xl overflow-x-auto">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow>
                <TableHead className="w-[50px] font-mono text-xs font-bold text-muted-foreground">#</TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("name")}>
                  <span className="flex items-center">Host <SortIcon field="name" /></span>
                </TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("ip")}>
                  <span className="flex items-center">IP <SortIcon field="ip" /></span>
                </TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("user")}>
                  <span className="flex items-center">Usuário/Setor <SortIcon field="user" /></span>
                </TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("latency")}>
                  <span className="flex items-center">Latência <SortIcon field="latency" /></span>
                </TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("uptime")}>
                  <span className="flex items-center">Uptime <SortIcon field="uptime" /></span>
                </TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("lastOnline")}>
                  <span className="flex items-center">Última Online <SortIcon field="lastOnline" /></span>
                </TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("lastOffline")}>
                  <span className="flex items-center">Última Offline <SortIcon field="lastOffline" /></span>
                </TableHead>
                <TableHead className="w-[60px] text-right font-mono text-xs font-bold text-muted-foreground">Agent</TableHead>
                <TableHead className="text-right font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("status")}>
                  <span className="flex items-center justify-end">Status <SortIcon field="status" /></span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isHostsLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-32 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
                  </TableCell>
                </TableRow>
              ) : sortedHosts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-32 text-center text-muted-foreground font-mono">
                    Nenhum host encontrado nesta categoria.
                  </TableCell>
                </TableRow>
              ) : (
                sortedHosts.map((host, idx) => {
                  const status = getStatusForHost(host.id);
                  const isOffline = status?.status === 'offline';
                  const isOnline = status?.status === 'online';
                  const uptime = isOnline ? formatUptime(status?.lastOfflineAt, status?.lastOnlineAt) : "--";

                  return (
                    <TableRow
                      key={host.id}
                      className={`group ${isOffline ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-secondary/20'}`}
                    >
                      <TableCell className="font-mono text-muted-foreground text-xs">{idx + 1}</TableCell>
                      <TableCell className="font-mono font-medium text-foreground">
                        {host.name}
                        {!host.enabled && <Badge variant="secondary" className="ml-2 text-[9px] h-4">Desativado</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-primary">{host.ipAddress}</TableCell>
                      <TableCell>
                        <div className="font-mono text-sm text-foreground">{host.userName || '-'}</div>
                        <div className="font-mono text-xs text-muted-foreground">{host.sector || '-'}</div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {isOnline
                          ? (status?.responseTimeMs ? `${status.responseTimeMs}ms` : '-')
                          : <span className="text-muted-foreground">--</span>
                        }
                      </TableCell>
                      <TableCell className="font-mono text-sm text-emerald-500 font-medium">
                        {uptime}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {status?.lastOnlineAt ? (
                          <div className="flex items-center gap-1 text-emerald-500">
                            <Wifi className="w-3 h-3 shrink-0" />
                            <div>
                              <div>{format(new Date(status.lastOnlineAt), "dd/MM HH:mm", { locale: ptBR })}</div>
                              <div className="text-[10px] text-muted-foreground">
                                {formatDistanceToNow(new Date(status.lastOnlineAt), { locale: ptBR, addSuffix: true })}
                              </div>
                            </div>
                          </div>
                        ) : <span className="text-muted-foreground">--</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {status?.lastOfflineAt ? (
                          <div className="flex items-center gap-1 text-destructive">
                            <WifiOff className="w-3 h-3 shrink-0" />
                            <div>
                              <div>{format(new Date(status.lastOfflineAt), "dd/MM HH:mm", { locale: ptBR })}</div>
                              <div className="text-[10px] text-muted-foreground">
                                {formatDistanceToNow(new Date(status.lastOfflineAt), { locale: ptBR, addSuffix: true })}
                              </div>
                            </div>
                          </div>
                        ) : <span className="text-muted-foreground">--</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {host.agentEnabled && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setAgentDialogHost({ id: host.id, name: host.name })}
                            className="h-8 w-8 border border-border cursor-pointer hover:border-primary/50"
                            title="Ver métricas do Agent"
                          >
                            <Activity className="w-4 h-4 text-primary" />
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {getStatusBadge(host.enabled ? status?.status : 'unknown')}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Tabs>
    </div>
  );
}
