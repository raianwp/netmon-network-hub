import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetMikrotikResources,
  useGetMikrotikInterfaces,
  useGetMikrotikRoutes,
  useGetMikrotikConfig,
  useGetMikrotikDhcpLeases,
  useGetMikrotikHealth,
  useGetMikrotikFirewallFilter,
  useGetMikrotikFirewallNat,
  useGetMikrotikAddresses,
  useGetMikrotikLog,
  getGetMikrotikResourcesQueryKey,
  getGetMikrotikInterfacesQueryKey,
  getGetMikrotikRoutesQueryKey,
  getGetMikrotikDhcpLeasesQueryKey,
  getGetMikrotikHealthQueryKey,
  getGetMikrotikFirewallFilterQueryKey,
  getGetMikrotikFirewallNatQueryKey,
  getGetMikrotikAddressesQueryKey,
  getGetMikrotikLogQueryKey
} from "@workspace/api-client-react";
import { Activity, Cpu, HardDrive, Clock, ArrowRightLeft, Network, Box, AlertTriangle, Settings, RefreshCw, Loader2, Wifi, ArrowUpDown, ArrowUp, ArrowDown, Thermometer, ShieldAlert, ScrollText, MapPin } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatBitsPerSecond, parseMikrotikUptime } from "@/lib/format";
import { Button } from "@/components/ui/button";

type DhcpSortField = "address" | "macAddress" | "hostName" | "status";
type SortDir = "asc" | "desc";
type FirewallView = "filter" | "nat";

export default function RouterDashboard() {
  const [dhcpSort, setDhcpSort] = useState<{ field: DhcpSortField; dir: SortDir }>({ field: "address", dir: "asc" });
  const [firewallView, setFirewallView] = useState<FirewallView>("filter");
  const { data: config, isLoading: isConfigLoading } = useGetMikrotikConfig();
  
  const isConfigured = config && config.enabled && config.ipAddress && config.apiUser;
  const refreshMs = (config?.refreshIntervalSeconds ?? 30) * 1000;

  const { data: resources, isLoading: isResourcesLoading } = useGetMikrotikResources({
    query: {
      queryKey: getGetMikrotikResourcesQueryKey(),
      enabled: !!isConfigured,
      refetchInterval: refreshMs,
    }
  });

  const { data: interfaces, isLoading: isInterfacesLoading } = useGetMikrotikInterfaces({
    query: {
      queryKey: getGetMikrotikInterfacesQueryKey(),
      enabled: !!isConfigured,
      refetchInterval: refreshMs,
    }
  });

  const { data: routes, isLoading: isRoutesLoading } = useGetMikrotikRoutes({
    query: {
      queryKey: getGetMikrotikRoutesQueryKey(),
      enabled: !!isConfigured,
      refetchInterval: refreshMs,
    }
  });

  const { data: dhcpLeases, isLoading: isDhcpLoading } = useGetMikrotikDhcpLeases({
    query: {
      queryKey: getGetMikrotikDhcpLeasesQueryKey(),
      enabled: !!isConfigured,
      refetchInterval: refreshMs,
    }
  });

  const { data: health } = useGetMikrotikHealth({
    query: {
      queryKey: getGetMikrotikHealthQueryKey(),
      enabled: !!isConfigured,
      refetchInterval: refreshMs,
    }
  });

  const { data: filterRules, isLoading: isFilterLoading } = useGetMikrotikFirewallFilter({
    query: {
      queryKey: getGetMikrotikFirewallFilterQueryKey(),
      enabled: !!isConfigured && firewallView === "filter",
      refetchInterval: refreshMs,
    }
  });

  const { data: natRules, isLoading: isNatLoading } = useGetMikrotikFirewallNat({
    query: {
      queryKey: getGetMikrotikFirewallNatQueryKey(),
      enabled: !!isConfigured && firewallView === "nat",
      refetchInterval: refreshMs,
    }
  });

  const { data: addresses, isLoading: isAddressesLoading } = useGetMikrotikAddresses({
    query: {
      queryKey: getGetMikrotikAddressesQueryKey(),
      enabled: !!isConfigured,
      refetchInterval: refreshMs,
    }
  });

  const { data: logEntries, isLoading: isLogLoading } = useGetMikrotikLog({
    query: {
      queryKey: getGetMikrotikLogQueryKey(),
      enabled: !!isConfigured,
      refetchInterval: refreshMs,
    }
  });

  const queryClient = useQueryClient();

  const handleRefresh = () => {
    if (isConfigured) {
      queryClient.invalidateQueries({ queryKey: getGetMikrotikResourcesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMikrotikInterfacesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMikrotikRoutesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMikrotikDhcpLeasesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMikrotikHealthQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMikrotikFirewallFilterQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMikrotikFirewallNatQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMikrotikAddressesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMikrotikLogQueryKey() });
    }
  };

  if (isConfigLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto">
        <div className="w-20 h-20 bg-muted/50 rounded-full flex items-center justify-center mb-6">
          <AlertTriangle className="w-10 h-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold font-mono text-foreground mb-2">MikroTik Não Configurado</h2>
        <p className="text-muted-foreground mb-8">
          A integração com o roteador MikroTik não está habilitada ou os dados de acesso não foram preenchidos.
        </p>
        <Link href="/settings">
          <Button className="font-mono">
            <Settings className="w-4 h-4 mr-2" />
            Configurar Integração
          </Button>
        </Link>
      </div>
    );
  }

  const isLoading = isResourcesLoading || isInterfacesLoading || isRoutesLoading;
  const memUsagePercent = resources ? ((resources.totalMemory - resources.freeMemory) / resources.totalMemory) * 100 : 0;
  const boundLeases = dhcpLeases?.filter(l => l.status === "bound") ?? [];

  const toggleDhcpSort = (field: DhcpSortField) => {
    setDhcpSort(prev => prev.field === field
      ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { field, dir: "asc" }
    );
  };

  const statusOrder: Record<string, number> = { bound: 0, waiting: 1 };

  const sortedDhcpLeases = dhcpLeases ? [...dhcpLeases].sort((a, b) => {
    let cmp = 0;
    const { field, dir } = dhcpSort;
    if (field === "address") {
      const toNum = (ip: string) => ip.split('.').map(Number).reduce((acc, v) => acc * 256 + v, 0);
      cmp = toNum(a.address) - toNum(b.address);
    } else if (field === "macAddress") {
      cmp = a.macAddress.localeCompare(b.macAddress);
    } else if (field === "hostName") {
      cmp = (a.hostName ?? "").localeCompare(b.hostName ?? "");
    } else if (field === "status") {
      cmp = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    }
    return dir === "asc" ? cmp : -cmp;
  }) : [];

  const DhcpSortIcon = ({ field }: { field: DhcpSortField }) => {
    if (dhcpSort.field !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return dhcpSort.dir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-mono tracking-tight">Router Dashboard</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">
            Status do Roteador: <span className="text-primary font-bold">{config.name}</span> ({config.ipAddress})
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading} className="font-mono cursor-pointer">
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* Resource cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-card/50 backdrop-blur border-border shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground">Carga da CPU</CardTitle>
            <Cpu className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {resources ? `${resources.cpuLoad}%` : '--'}
            </div>
            {resources && (
              <div className="w-full bg-secondary h-1.5 rounded-full mt-3 overflow-hidden">
                <div 
                  className={`h-full rounded-full ${resources.cpuLoad > 80 ? 'bg-destructive' : resources.cpuLoad > 50 ? 'bg-amber-500' : 'bg-primary'}`} 
                  style={{ width: `${resources.cpuLoad}%` }} 
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground">Temp. CPU</CardTitle>
            <Thermometer className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {health?.cpuTempC != null ? `${health.cpuTempC.toFixed(0)}°C` : '--'}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              {health?.cpuTempC == null ? "Sem sensor neste modelo" : "Sensor térmico"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground">Uso de Memória</CardTitle>
            <HardDrive className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {resources ? `${memUsagePercent.toFixed(1)}%` : '--'}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              {resources ? `${formatBytes(resources.totalMemory - resources.freeMemory)} / ${formatBytes(resources.totalMemory)}` : '--'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground">Uptime</CardTitle>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono truncate">
              {resources ? parseMikrotikUptime(resources.uptime) : '--'}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1">Tempo de atividade</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground">Sistema</CardTitle>
            <Box className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono truncate">
              {resources ? resources.boardName : '--'}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              RouterOS v{resources ? resources.version : '--'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Interfaces + Routes */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="col-span-1 bg-card/50 backdrop-blur border-border shadow-md flex flex-col">
          <CardHeader className="border-b border-border/50 pb-4">
            <div className="flex items-center gap-2">
              <Network className="w-5 h-5 text-primary" />
              <CardTitle className="font-mono">Interfaces de Rede</CardTitle>
            </div>
            <CardDescription className="font-mono text-xs">Tráfego e status atual</CardDescription>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-auto max-h-[400px]">
            <Table>
              <TableHeader className="bg-secondary/50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Nome</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Status</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">RX</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">TX</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">RX/s</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">TX/s</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {interfaces && interfaces.length > 0 ? (
                  interfaces.map((iface, i) => (
                    <TableRow key={i} className="group hover:bg-secondary/20">
                      <TableCell className="font-mono text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <span className={iface.running ? "text-foreground" : "text-muted-foreground"}>{iface.name}</span>
                          {iface.comment && <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">{iface.comment}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{iface.macAddress}</div>
                      </TableCell>
                      <TableCell>
                        {iface.disabled ? (
                          <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30 font-mono text-[10px]">Disabled</Badge>
                        ) : iface.running ? (
                          <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px]">Running</Badge>
                        ) : (
                          <Badge variant="outline" className="text-destructive border-destructive/30 bg-destructive/10 font-mono text-[10px]">Down</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatBytes(Number(iface.rxBytes))}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatBytes(Number(iface.txBytes))}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-emerald-500">
                        {formatBitsPerSecond(iface.rxRateBps)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-primary">
                        {formatBitsPerSecond(iface.txRateBps)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-muted-foreground font-mono text-sm">
                      {isInterfacesLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Nenhuma interface encontrada"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="col-span-1 bg-card/50 backdrop-blur border-border shadow-md flex flex-col">
          <CardHeader className="border-b border-border/50 pb-4">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-primary" />
              <CardTitle className="font-mono">Tabela de Roteamento</CardTitle>
            </div>
            <CardDescription className="font-mono text-xs">Rotas ativas no sistema</CardDescription>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-auto max-h-[400px]">
            <Table>
              <TableHeader className="bg-secondary/50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Destino</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Gateway</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Dist</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes && routes.length > 0 ? (
                  routes.map((route, i) => (
                    <TableRow key={i} className="group hover:bg-secondary/20">
                      <TableCell className="font-mono text-sm font-medium">
                        {route.dstAddress}
                        {route.comment && <div className="text-xs text-muted-foreground mt-0.5">{route.comment}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{route.gateway || '--'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{route.distance}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {route.active && <Badge variant="outline" className="px-1 py-0 h-4 text-[10px] bg-primary/10 text-primary border-primary/20">A</Badge>}
                          {route.dynamic && <Badge variant="outline" className="px-1 py-0 h-4 text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20">D</Badge>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-6 text-muted-foreground font-mono text-sm">
                      {isRoutesLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Nenhuma rota encontrada"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* IP Addresses */}
      <Card className="bg-card/50 backdrop-blur border-border shadow-md flex flex-col">
        <CardHeader className="border-b border-border/50 pb-4">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            <CardTitle className="font-mono">Endereços IP</CardTitle>
          </div>
          <CardDescription className="font-mono text-xs">Endereços configurados nas interfaces do roteador</CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-auto max-h-[400px]">
          <Table>
            <TableHeader className="bg-secondary/50 sticky top-0 z-10">
              <TableRow>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground">Endereço</TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground">Rede</TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground">Interface</TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {addresses && addresses.length > 0 ? (
                addresses.map((a, i) => (
                  <TableRow key={i} className="group hover:bg-secondary/20">
                    <TableCell className="font-mono text-sm font-bold text-primary">
                      {a.address}
                      {a.comment && <div className="text-xs text-muted-foreground mt-0.5 font-normal">{a.comment}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{a.network}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{a.interfaceName}</TableCell>
                    <TableCell>
                      {a.disabled ? (
                        <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30 font-mono text-[10px]">Disabled</Badge>
                      ) : (
                        <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px]">Ativo</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-6 text-muted-foreground font-mono text-sm">
                    {isAddressesLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Nenhum endereço encontrado"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* DHCP Leases */}
      <Card className="bg-card/50 backdrop-blur border-border shadow-md flex flex-col">
        <CardHeader className="border-b border-border/50 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wifi className="w-5 h-5 text-primary" />
              <CardTitle className="font-mono">Leases DHCP</CardTitle>
            </div>
            {dhcpLeases && (
              <span className="text-xs font-mono text-muted-foreground">
                {boundLeases.length} ativos / {dhcpLeases.length} total
              </span>
            )}
          </div>
          <CardDescription className="font-mono text-xs">Dispositivos com IP atribuído pelo DHCP Server</CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-auto max-h-[400px]">
          <Table>
            <TableHeader className="bg-secondary/50 sticky top-0 z-10">
              <TableRow>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleDhcpSort("address")}>
                  <span className="flex items-center">IP <DhcpSortIcon field="address" /></span>
                </TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleDhcpSort("macAddress")}>
                  <span className="flex items-center">MAC <DhcpSortIcon field="macAddress" /></span>
                </TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleDhcpSort("hostName")}>
                  <span className="flex items-center">Hostname <DhcpSortIcon field="hostName" /></span>
                </TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground">Servidor DHCP</TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground">Expira em</TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground cursor-pointer select-none" onClick={() => toggleDhcpSort("status")}>
                  <span className="flex items-center">Status <DhcpSortIcon field="status" /></span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isDhcpLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-6">
                    <Loader2 className="w-4 h-4 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : sortedDhcpLeases.length > 0 ? (
                sortedDhcpLeases.map((lease, i) => (
                  <TableRow key={i} className="group hover:bg-secondary/20">
                    <TableCell className="font-mono text-sm font-bold text-primary">{lease.address}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{lease.macAddress}</TableCell>
                    <TableCell className="font-mono text-sm">{lease.hostName || <span className="text-muted-foreground">--</span>}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{lease.server}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{lease.expiresAfter || '--'}</TableCell>
                    <TableCell>
                      {lease.status === "bound" ? (
                        <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px]">Bound</Badge>
                      ) : lease.status === "waiting" ? (
                        <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 font-mono text-[10px]">Waiting</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground border-border font-mono text-[10px]">{lease.status}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-6 text-muted-foreground font-mono text-sm">
                    Nenhum lease DHCP encontrado
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Firewall */}
      <Card className="bg-card/50 backdrop-blur border-border shadow-md flex flex-col">
        <CardHeader className="border-b border-border/50 pb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-primary" />
              <CardTitle className="font-mono">Firewall</CardTitle>
            </div>
            <div className="flex items-center gap-1 bg-secondary rounded-md p-1 border border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFirewallView("filter")}
                className={`font-mono text-xs h-7 ${firewallView === "filter" ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground" : "text-muted-foreground"}`}
              >
                Filter Rules
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFirewallView("nat")}
                className={`font-mono text-xs h-7 ${firewallView === "nat" ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground" : "text-muted-foreground"}`}
              >
                NAT
              </Button>
            </div>
          </div>
          <CardDescription className="font-mono text-xs">
            {firewallView === "filter" && "Regras de filtro ativas no roteador"}
            {firewallView === "nat" && "Regras de NAT (masquerade, port forward, etc)"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-auto max-h-[400px]">
          {firewallView === "filter" && (
            <Table>
              <TableHeader className="bg-secondary/50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Chain</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Ação</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Origem</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Destino</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Protocolo</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Pacotes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filterRules && filterRules.length > 0 ? (
                  filterRules.map((r, i) => (
                    <TableRow key={i} className="group hover:bg-secondary/20">
                      <TableCell className="font-mono text-xs">
                        <Badge variant="outline" className="font-mono text-[10px]">{r.chain}</Badge>
                        {r.disabled && <Badge variant="outline" className="ml-1 text-muted-foreground border-muted-foreground/30 font-mono text-[10px]">Off</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium">{r.action}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.srcAddress || '--'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.dstAddress || '--'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.protocol || '--'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.packets}</TableCell>
                      {r.comment && <TableCell className="font-mono text-[10px] text-muted-foreground">{r.comment}</TableCell>}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-muted-foreground font-mono text-sm">
                      {isFilterLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Nenhuma regra encontrada"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {firewallView === "nat" && (
            <Table>
              <TableHeader className="bg-secondary/50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Chain</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Ação</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Origem</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Destino</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">To Addresses</TableHead>
                  <TableHead className="font-mono text-xs font-bold text-muted-foreground">Protocolo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {natRules && natRules.length > 0 ? (
                  natRules.map((r, i) => (
                    <TableRow key={i} className="group hover:bg-secondary/20">
                      <TableCell className="font-mono text-xs">
                        <Badge variant="outline" className="font-mono text-[10px]">{r.chain}</Badge>
                        {r.disabled && <Badge variant="outline" className="ml-1 text-muted-foreground border-muted-foreground/30 font-mono text-[10px]">Off</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium">{r.action}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.srcAddress || '--'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.dstAddress || '--'}</TableCell>
                      <TableCell className="font-mono text-xs text-primary">{r.toAddresses || '--'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.protocol || '--'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-muted-foreground font-mono text-sm">
                      {isNatLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Nenhuma regra encontrada"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

        </CardContent>
      </Card>

      {/* System Log */}
      <Card className="bg-card/50 backdrop-blur border-border shadow-md flex flex-col">
        <CardHeader className="border-b border-border/50 pb-4">
          <div className="flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-primary" />
            <CardTitle className="font-mono">Log do Sistema</CardTitle>
          </div>
          <CardDescription className="font-mono text-xs">Eventos recentes registrados pelo RouterOS</CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-auto max-h-[400px]">
          <Table>
            <TableHeader className="bg-secondary/50 sticky top-0 z-10">
              <TableRow>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground w-[140px]">Horário</TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground w-[160px]">Tópicos</TableHead>
                <TableHead className="font-mono text-xs font-bold text-muted-foreground">Mensagem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logEntries && logEntries.length > 0 ? (
                logEntries.map((entry, i) => (
                  <TableRow key={i} className="group hover:bg-secondary/20">
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">{entry.time}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <Badge variant="outline" className="font-mono text-[10px]">{entry.topics}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">{entry.message}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-6 text-muted-foreground font-mono text-sm">
                    {isLogLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Nenhum evento encontrado"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
