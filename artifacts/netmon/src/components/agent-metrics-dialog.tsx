import { useState } from "react";
import { Activity, Cpu, MemoryStick, Clock, Monitor, X, Loader2, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronUp, ListTree, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useGetHostAgentLatest, useRefreshHostAgent, getGetHostAgentLatestQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ProcessSortField = "name" | "cpu" | "mem";
type SortDir = "asc" | "desc";

interface AgentMetricsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostId: number | null;
  hostName?: string;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "--";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null) return "--";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
}

export function AgentMetricsDialog({ open, onOpenChange, hostId, hostName }: AgentMetricsDialogProps) {
  const [processesOpen, setProcessesOpen] = useState(false);
  const [sortField, setSortField] = useState<ProcessSortField>("mem");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (field: ProcessSortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "name" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ field }: { field: ProcessSortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 ml-1 text-primary" /> : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  const queryClient = useQueryClient();
  const latestQueryKey = getGetHostAgentLatestQueryKey(hostId ?? 0);

  const { data, isLoading, isError } = useGetHostAgentLatest(hostId ?? 0, {
    query: {
      queryKey: latestQueryKey,
      enabled: open && hostId != null,
      refetchInterval: open ? 15000 : false,
    },
  });

  const refreshMutation = useRefreshHostAgent({
    mutation: {
      onSuccess: (fresh) => {
        queryClient.setQueryData(latestQueryKey, fresh);
      },
    },
  });

  const memPercent =
    data?.memUsedBytes != null && data?.memTotalBytes
      ? Math.round((data.memUsedBytes / data.memTotalBytes) * 100)
      : null;

  const visibleProcesses = data?.processes
    ? data.processes
        .filter((p) => p.name.toLowerCase() !== "svchost")
        .sort((a, b) => {
          let cmp = 0;
          if (sortField === "name") cmp = a.name.localeCompare(b.name);
          else if (sortField === "cpu") cmp = (a.cpuPercent ?? -1) - (b.cpuPercent ?? -1);
          else cmp = (a.memBytes ?? 0) - (b.memBytes ?? 0);
          return sortDir === "asc" ? cmp : -cmp;
        })
    : [];

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setProcessesOpen(false); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-mono flex items-center gap-2 text-base pr-6">
            <Activity className="w-4 h-4 text-primary" />
            Métricas do Agent {hostName ? `— ${hostName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground font-mono text-sm py-10">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando...
            </div>
          )}

          {isError && !isLoading && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted text-muted-foreground border border-border text-xs font-mono">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              Nenhuma métrica coletada ainda para este host. O agent (windows_exporter) precisa estar rodando e acessível na porta configurada.
            </div>
          )}

          {data && !isLoading && (
            <>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground">
                  Última coleta: {new Date(data.collectedAt).toLocaleString("pt-BR")}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => hostId != null && refreshMutation.mutate({ id: hostId })}
                    disabled={refreshMutation.isPending}
                    title="Buscar agora"
                    className="inline-flex items-center justify-center rounded-md border border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground hover:bg-secondary/40 cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3 h-3 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                  </button>
                  {data.scrapeOk ? (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-mono text-[10px]">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> AGENT OK
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 font-mono text-[10px]">
                      <XCircle className="w-3 h-3 mr-1" /> SEM RESPOSTA
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-mono font-semibold uppercase text-foreground/80">
                    <Cpu className="w-3.5 h-3.5" /> CPU
                  </div>
                  <p className="font-mono font-bold text-lg text-foreground">
                    {data.cpuPercent != null ? `${data.cpuPercent.toFixed(1)}%` : "--"}
                  </p>
                  <p className="font-mono text-xs text-foreground/70 break-words" title={data.cpuModel ?? undefined}>
                    {data.cpuModel ?? "--"}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-mono font-semibold uppercase text-foreground/80">
                    <MemoryStick className="w-3.5 h-3.5" /> RAM
                  </div>
                  <p className="font-mono font-bold text-lg text-foreground flex items-baseline gap-2">
                    <span>{memPercent != null ? `${memPercent}%` : "--"}</span>
                    {memPercent != null && (
                      <span>{formatBytes(data.memUsedBytes)}/{formatBytes(data.memTotalBytes)}</span>
                    )}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-mono font-semibold uppercase text-foreground/80">
                    <Clock className="w-3.5 h-3.5" /> Uptime
                  </div>
                  <p className="font-mono font-bold text-sm text-foreground">{formatUptime(data.uptimeSeconds)}</p>
                </div>
                <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-mono font-semibold uppercase text-foreground/80">
                    <Monitor className="w-3.5 h-3.5" /> Sistema
                  </div>
                  <p className="font-mono font-bold text-sm text-foreground break-words">{data.osVersion ?? "--"}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setProcessesOpen((v) => !v)}
                  className="w-full flex items-center justify-between rounded-md border border-border bg-secondary/20 px-3 py-2 font-mono text-xs text-foreground hover:bg-secondary/40 cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <ListTree className="w-3.5 h-3.5 text-primary" />
                    Processos ({visibleProcesses.length})
                  </span>
                  {processesOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {processesOpen && (
                  visibleProcesses.length === 0 ? (
                    <p className="font-mono text-xs text-muted-foreground/60 px-1">Nenhum processo reportado pelo agent.</p>
                  ) : (
                    <div className="border border-border rounded-md overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/50 border-b border-border font-mono text-[10px] font-bold text-muted-foreground select-none">
                        <button type="button" onClick={() => toggleSort("name")} className="flex items-center cursor-pointer hover:text-foreground">
                          Processo <SortIcon field="name" />
                        </button>
                        <span className="flex items-center gap-3 shrink-0">
                          <button type="button" onClick={() => toggleSort("cpu")} className="flex items-center cursor-pointer hover:text-foreground">
                            CPU <SortIcon field="cpu" />
                          </button>
                          <button type="button" onClick={() => toggleSort("mem")} className="flex items-center cursor-pointer hover:text-foreground">
                            RAM <SortIcon field="mem" />
                          </button>
                        </span>
                      </div>
                      <div className="max-h-64 overflow-y-auto divide-y divide-border">
                        {visibleProcesses.map((p, idx) => (
                          <div key={`${p.name}-${idx}`} className="flex items-center justify-between px-3 py-1.5 font-mono text-xs hover:bg-secondary/20">
                            <span className="text-foreground truncate pr-2">{p.name}</span>
                            <span className="text-muted-foreground shrink-0 flex items-center gap-3">
                              <span>{p.cpuPercent != null ? `${p.cpuPercent.toFixed(1)}% CPU` : "--"}</span>
                              <span>{formatBytes(p.memBytes)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            </>
          )}

          <div className="flex justify-end pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="font-mono text-xs border-border text-muted-foreground cursor-pointer"
            >
              <X className="w-3.5 h-3.5 mr-1.5" />
              Fechar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
