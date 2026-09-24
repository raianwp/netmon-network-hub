import { useGetSystemInfo } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Info, Code2, Server, Database, Globe, User, Mail, Tag, Cpu, Clock, HardDrive, RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdateCheck } from "@/hooks/use-update-check";
import { useToast } from "@/hooks/use-toast";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}min`);
  return parts.join(" ");
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0">
      <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-mono uppercase text-muted-foreground tracking-wider">{label}</p>
        <p className="text-sm font-mono text-foreground mt-0.5 break-all">{value}</p>
      </div>
    </div>
  );
}

export default function SystemInfo() {
  const { data, isLoading, isError } = useGetSystemInfo();
  const { data: updateCheck, isFetching: isCheckingUpdate, refetch: refetchUpdateCheck } = useUpdateCheck();
  const { toast } = useToast();

  const handleUpdate = () => {
    toast({ title: "Em desenvolvimento", description: "A atualização automática ainda não está disponível — essa é só a parte visual." });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold font-mono tracking-tight">Informações</h1>
        <p className="text-muted-foreground font-mono text-sm mt-1">Detalhes da aplicação e do ambiente do servidor</p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-3 text-muted-foreground font-mono text-sm py-12 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" />
          Carregando informações do sistema...
        </div>
      )}

      {isError && (
        <div className="p-4 rounded-md bg-destructive/10 border border-destructive/30 text-destructive font-mono text-sm">
          Não foi possível carregar as informações do sistema.
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Aplicação */}
          <Card className="bg-card/50 backdrop-blur border-border shadow-md">
            <CardHeader className="border-b border-border/50">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-primary" />
                <CardTitle className="font-mono">Aplicação</CardTitle>
              </div>
              <CardDescription className="font-mono text-xs">Informações do sistema NetMon</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <InfoRow icon={Tag} label="Nome" value={data.appName} />
              <div className="flex items-start gap-3 py-3">
                <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Code2 className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0 flex items-center justify-between flex-wrap gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-mono uppercase text-muted-foreground tracking-wider">Versão</p>
                    <p className="text-sm font-mono text-foreground mt-0.5">v{data.appVersion}</p>
                    {updateCheck?.hasUpdate && (
                      <p className="text-[10px] font-mono text-amber-500 mt-0.5">Versão {updateCheck.latestVersion} disponível</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => refetchUpdateCheck()}
                      disabled={isCheckingUpdate}
                      className="font-mono text-[10px] h-7 px-2 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 mr-1 ${isCheckingUpdate ? "animate-spin" : ""}`} />
                      Verificar
                    </Button>
                    {updateCheck?.hasUpdate && (
                      <Button
                        size="sm"
                        onClick={handleUpdate}
                        className="font-mono text-[10px] h-7 px-2 cursor-pointer bg-amber-500 hover:bg-amber-600 text-white"
                      >
                        <Download className="w-3 h-3 mr-1" />
                        Atualizar
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Desenvolvedor */}
          <Card className="bg-card/50 backdrop-blur border-border shadow-md">
            <CardHeader className="border-b border-border/50">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-primary" />
                <CardTitle className="font-mono">Desenvolvedor</CardTitle>
              </div>
              <CardDescription className="font-mono text-xs">Responsável pelo desenvolvimento</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <InfoRow icon={User} label="Nome" value={data.developerName} />
              <InfoRow icon={Mail} label="E-mail" value={data.developerEmail} />
            </CardContent>
          </Card>

          {/* Sistema Operacional */}
          <Card className="bg-card/50 backdrop-blur border-border shadow-md">
            <CardHeader className="border-b border-border/50">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-primary" />
                <CardTitle className="font-mono">Sistema Operacional</CardTitle>
              </div>
              <CardDescription className="font-mono text-xs">Informações do servidor Linux</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <InfoRow icon={Server} label="Distribuição" value={data.osDistro} />
              <InfoRow icon={Cpu} label="Kernel" value={data.osKernel} />
              <InfoRow icon={HardDrive} label="Hostname" value={data.hostname} />
              <InfoRow icon={Clock} label="Uptime" value={formatUptime(data.uptimeSeconds)} />
            </CardContent>
          </Card>

          {/* Serviços */}
          <Card className="bg-card/50 backdrop-blur border-border shadow-md">
            <CardHeader className="border-b border-border/50">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-primary" />
                <CardTitle className="font-mono">Serviços</CardTitle>
              </div>
              <CardDescription className="font-mono text-xs">Versões dos componentes instalados</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <InfoRow icon={Code2} label="Node.js" value={data.nodeVersion} />
              <InfoRow icon={Database} label="PostgreSQL" value={data.postgresVersion} />
              <InfoRow icon={Globe} label="Nginx" value={data.nginxVersion} />
              <InfoRow icon={Database} label="Tamanho do banco" value={data.dbSize} />
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
}
