import { useState, useRef, useEffect, useCallback } from "react";
import { Terminal, Play, Square, Wifi, WifiOff, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

interface PingLine {
  seq: number;
  alive: boolean;
  ms: number | null;
  raw: string;
  done?: boolean;
  timestamp: Date;
}

interface PingTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialIp?: string;
}

const MAX_LINES = 5;

export function PingTestDialog({ open, onOpenChange, initialIp = "" }: PingTestDialogProps) {
  const [ip, setIp] = useState(initialIp);
  const [continuous, setContinuous] = useState(false);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<PingLine[]>([]);
  const [ipError, setIpError] = useState("");

  const esRef = useRef<EventSource | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Scroll terminal to bottom whenever lines change
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      stopPing();
      setLines([]);
      setIpError("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stopPing = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setRunning(false);
  }, []);

  const validateIp = (value: string): boolean => {
    const isValid = /^(\d{1,3}\.){3}\d{1,3}$/.test(value) &&
      value.split(".").every(n => parseInt(n) >= 0 && parseInt(n) <= 255);
    if (!isValid) {
      setIpError("Digite um endereço IPv4 válido (ex: 192.168.1.1 ou 8.8.8.8)");
      return false;
    }
    setIpError("");
    return true;
  };

  const startPing = () => {
    if (!validateIp(ip)) return;

    // Clear previous results
    setLines([]);
    setRunning(true);

    const params = new URLSearchParams({ ip, continuous: String(continuous) });
    const url = `/api/monitoring/ping-test?${params}`;

    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          seq: number;
          alive: boolean;
          ms: number | null;
          raw: string;
          done?: boolean;
        };

        if (data.done) {
          stopPing();
          return;
        }

        setLines(prev => {
          const next = [...prev, { ...data, timestamp: new Date() }];
          return next.slice(-MAX_LINES);
        });
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      stopPing();
    };
  };

  const handleToggle = () => {
    if (running) {
      stopPing();
    } else {
      startPing();
    }
  };

  // Stats from current lines
  const stats = (() => {
    if (lines.length === 0) return null;
    const sent = lines[lines.length - 1].seq;
    const recv = lines.filter(l => l.alive).length;
    const lost = lines.filter(l => !l.alive).length;
    const times = lines.filter(l => l.ms !== null).map(l => l.ms!);
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
    const min = times.length ? Math.min(...times) : null;
    const max = times.length ? Math.max(...times) : null;
    return { sent, recv, lost, avg, min, max };
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-mono flex items-center gap-2 text-base">
            <Terminal className="w-4 h-4 text-primary" />
            Teste de Ping
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* IP input */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs text-muted-foreground">ENDEREÇO IP</Label>
            <div className="flex gap-2">
              <Input
                value={ip}
                onChange={e => {
                  setIp(e.target.value);
                  if (ipError) validateIp(e.target.value);
                }}
                onKeyDown={e => { if (e.key === "Enter" && !running) handleToggle(); }}
                placeholder="ex: 192.168.1.1  ou  8.8.8.8"
                className="font-mono text-sm bg-secondary/50 border-border"
                disabled={running}
              />
            </div>
            {ipError && (
              <p className="text-xs text-destructive font-mono">{ipError}</p>
            )}
          </div>

          {/* Continuous checkbox */}
          <div className="flex items-center gap-2.5">
            <Checkbox
              id="continuous"
              checked={continuous}
              onCheckedChange={v => setContinuous(!!v)}
              disabled={running}
              className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            />
            <Label
              htmlFor="continuous"
              className="font-mono text-xs text-muted-foreground cursor-pointer select-none"
            >
              Testar continuamente
            </Label>
          </div>

          {/* Terminal output */}
          <div className="rounded-md border border-border overflow-hidden">
            {/* Terminal title bar */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-secondary border-b border-border">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                ping — últimas {MAX_LINES} respostas
              </span>
              {running && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-mono border-primary/40 text-primary animate-pulse">
                  ● AO VIVO
                </Badge>
              )}
              {!running && lines.length > 0 && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-mono border-border text-muted-foreground">
                  PARADO
                </Badge>
              )}
              {!running && lines.length === 0 && <span />}
            </div>

            {/* Terminal body */}
            <div
              ref={terminalRef}
              className="bg-[#0d1117] min-h-[140px] h-[140px] overflow-y-auto p-3 font-mono text-xs space-y-0.5"
            >
              {lines.length === 0 ? (
                <p className="text-muted-foreground/40 select-none">
                  {running
                    ? "Aguardando resposta..."
                    : `Informe um IP e clique em Iniciar.`}
                </p>
              ) : (
                lines.map((line, i) => (
                  <div key={i} className="flex items-baseline gap-2 leading-relaxed">
                    {line.alive ? (
                      <>
                        <Wifi className="w-2.5 h-2.5 text-emerald-500 shrink-0 mt-0.5" />
                        <span className="text-emerald-400 break-all">{line.raw}</span>
                      </>
                    ) : (
                      <>
                        <WifiOff className="w-2.5 h-2.5 text-destructive shrink-0 mt-0.5" />
                        <span className="text-red-400 break-all">{line.raw}</span>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Stats bar */}
            {stats && (
              <div className="flex items-center gap-4 px-3 py-1.5 bg-secondary/60 border-t border-border text-[10px] font-mono text-muted-foreground">
                <span>enviados: <span className="text-foreground">{stats.sent}</span></span>
                <span className="text-border">|</span>
                <span>recebidos: <span className="text-emerald-500">{stats.recv}</span></span>
                <span className="text-border">|</span>
                <span>perdidos: <span className={stats.lost > 0 ? "text-destructive" : "text-foreground"}>{stats.lost}</span></span>
                {stats.avg !== null && (
                  <>
                    <span className="text-border">|</span>
                    <span>
                      min/avg/max:{" "}
                      <span className="text-foreground">
                        {stats.min!.toFixed(1)}/{stats.avg.toFixed(1)}/{stats.max!.toFixed(1)} ms
                      </span>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-[10px] font-mono text-muted-foreground/60">
              {!continuous ? `5 pings — encerra automaticamente` : `modo contínuo — clique em Parar para encerrar`}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="font-mono text-xs border-border text-muted-foreground"
              >
                <X className="w-3.5 h-3.5 mr-1.5" />
                Fechar
              </Button>
              <Button
                size="sm"
                onClick={handleToggle}
                className={`font-mono text-xs ${
                  running
                    ? "bg-destructive hover:bg-destructive/80 text-destructive-foreground"
                    : "bg-primary hover:bg-primary/80 text-primary-foreground"
                }`}
              >
                {running ? (
                  <><Square className="w-3.5 h-3.5 mr-1.5 fill-current" />Parar</>
                ) : (
                  <><Play className="w-3.5 h-3.5 mr-1.5 fill-current" />Iniciar</>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
