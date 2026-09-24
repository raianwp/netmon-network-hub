import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Link, useLocation } from "wouter";
import { Activity, Server, PlusSquare, Settings, LogOut, Loader2, Sun, Moon, Terminal, Info, Menu, ChevronLeft, ChevronRight, Globe, RefreshCw } from "lucide-react";
import { IaTerminalIcon } from "@/components/icons/ia-terminal-icon";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { useUpdateCheck } from "@/hooks/use-update-check";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { StatusNotifications } from "@/components/status-notifications";
import { useGetInternetStatus, getGetInternetStatusQueryKey } from "@workspace/api-client-react";

const APP_VERSION = "4.5";

function VersionFooter() {
  const { data, isFetching, refetch } = useUpdateCheck();

  return (
    <div className="flex items-center gap-2">
      {data && (
        data.hasUpdate ? (
          <Link
            href="/info"
            className="inline-flex items-center text-[11px] leading-none font-mono text-amber-500 hover:text-amber-400 cursor-pointer underline-offset-2 hover:underline"
          >
            Nova versão disponível
          </Link>
        ) : (
          <span className="inline-flex items-center text-[11px] leading-none font-mono text-muted-foreground">Versão mais recente instalada</span>
        )
      )}
      <button
        onClick={() => refetch()}
        disabled={isFetching}
        title="Verificar atualização"
        className="inline-flex items-center justify-center p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50 shrink-0"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
      </button>
      <span className="inline-flex items-center text-[11px] leading-none text-muted-foreground font-mono">v{APP_VERSION}</span>
    </div>
  );
}

const navItems = [
  { href: "/dashboard", label: "Router Dashboard", icon: Activity, adminOnly: false, requiresAiTerminal: false },
  { href: "/hosts", label: "Hosts", icon: Server, adminOnly: false, requiresAiTerminal: false },
  { href: "/ai-terminal", label: "IA Terminal", icon: IaTerminalIcon, adminOnly: false, requiresAiTerminal: true },
  { href: "/register", label: "Cadastro", icon: PlusSquare, adminOnly: true, requiresAiTerminal: false },
  { href: "/settings", label: "Configurações", icon: Settings, adminOnly: true, requiresAiTerminal: false },
  { href: "/info", label: "Informações", icon: Info, adminOnly: true, requiresAiTerminal: false },
];

function InternetStatusBadge({ status }: { status?: string }) {
  if (status === "online") return <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-500 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Ok</span>;
  if (status === "offline") return <span className="flex items-center gap-1 text-[10px] font-mono text-red-500 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />Falha</span>;
  return <span className="text-[10px] font-mono text-muted-foreground">—</span>;
}

function InternetStatusDot({ status }: { status?: string }) {
  if (status === "online") return <span className="w-2 h-2 rounded-full bg-emerald-500" />;
  if (status === "offline") return <span className="w-2 h-2 rounded-full bg-red-500" />;
  return <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />;
}

function NavContent({ location, onNavigate }: { location: string; onNavigate?: () => void }) {
  const { user, logout, isAdmin } = useAuth();
  const { theme, toggle } = useTheme();
  const { data: internetStatus } = useGetInternetStatus({ query: { queryKey: getGetInternetStatusQueryKey(), refetchInterval: 30000 } });

  const visibleNavItems = navItems.filter(item =>
    (!item.adminOnly || isAdmin) && (!item.requiresAiTerminal || user?.canAccessAiTerminal)
  );

  return (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center justify-between pl-6 pr-14 border-b border-border bg-background/50 shrink-0">
        <div className="flex items-center gap-2 text-primary font-bold text-lg font-mono tracking-tight">
          <Activity className="w-5 h-5" />
          <span>NETMON</span>
        </div>
        <button
          onClick={toggle}
          title={theme === "dark" ? "Tema claro" : "Tema escuro"}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-4 flex flex-col gap-1 px-3">
        {visibleNavItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} onClick={onNavigate}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-all cursor-pointer font-medium text-sm font-mono",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>
      <div className="mx-3 mb-1 mt-1 border-t border-border/50 pt-2 pb-1">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] font-mono text-muted-foreground">Internet</span>
          </div>
          <InternetStatusBadge status={internetStatus?.status} />
        </div>
      </div>

      <div className="p-4 border-t border-border bg-background/50 flex flex-col gap-3 shrink-0">
        <div className="flex items-center gap-3 px-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-mono font-bold text-xs shrink-0">
            {user?.username.substring(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate font-mono">{user?.username}</p>
            <p className="text-xs text-muted-foreground font-mono">{user?.role === "viewer" ? "Viewer" : "Admin"}</p>
          </div>
        </div>
        {isAdmin && (
          <a
            href={`ssh://root@${typeof window !== "undefined" ? window.location.hostname : "localhost"}`}
            className="flex items-center justify-center gap-2 w-full py-2 px-3 text-xs font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md transition-colors border border-transparent hover:border-primary/20 font-mono uppercase tracking-wider"
            title="Abrir terminal SSH (requer PuTTY configurado)"
          >
            <Terminal className="w-3 h-3" />
            Terminal SSH
          </a>
        )}
        <button
          onClick={() => logout()}
          className="flex items-center justify-center gap-2 w-full py-2 px-3 text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors border border-transparent hover:border-destructive/20 font-mono uppercase tracking-wider"
        >
          <LogOut className="w-3 h-3" />
          Sair
        </button>
      </div>
    </div>
  );
}

function CollapsedSidebar({ location, collapsed, onToggle }: { location: string; collapsed: boolean; onToggle: () => void }) {
  const { user, logout, isAdmin } = useAuth();
  const { theme, toggle } = useTheme();
  const { data: internetStatus } = useGetInternetStatus({ query: { queryKey: getGetInternetStatusQueryKey(), refetchInterval: 30000 } });

  const visibleNavItems = navItems.filter(item =>
    (!item.adminOnly || isAdmin) && (!item.requiresAiTerminal || user?.canAccessAiTerminal)
  );

  return (
    <div className="flex flex-col h-full items-center">
      <div className="h-16 flex items-center justify-center border-b border-border bg-background/50 shrink-0 w-full relative">
        <Activity className="w-5 h-5 text-primary" />
        <button
          onClick={onToggle}
          title="Expandir menu"
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors z-20 shadow-sm"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-4 flex flex-col gap-1 w-full px-2">
        {visibleNavItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href}>
              <div
                title={item.label}
                className={cn(
                  "flex items-center justify-center p-2 rounded-md transition-all cursor-pointer",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                <item.icon className="w-4 h-4" />
              </div>
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col items-center w-full px-2 pt-2 pb-1 border-t border-border/50 gap-1" title={`Internet: ${internetStatus?.status ?? 'verificando'}`}>
        <Globe className="w-3.5 h-3.5 text-muted-foreground" />
        <InternetStatusDot status={internetStatus?.status} />
      </div>

      <div className="pb-4 border-t border-border bg-background/50 flex flex-col gap-2 items-center w-full pt-4 px-2">
        <div
          title={user?.username}
          className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-mono font-bold text-xs shrink-0"
        >
          {user?.username.substring(0, 2).toUpperCase()}
        </div>
        <button
          onClick={toggle}
          title={theme === "dark" ? "Tema claro" : "Tema escuro"}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors w-full flex justify-center"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        {isAdmin && (
          <a
            href={`ssh://root@${typeof window !== "undefined" ? window.location.hostname : "localhost"}`}
            title="Terminal SSH"
            className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors w-full flex justify-center"
          >
            <Terminal className="w-4 h-4" />
          </a>
        )}
        <button
          onClick={() => logout()}
          title="Sair"
          className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors w-full flex justify-center"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout: _logout } = useAuth();
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("netmon-sidebar-collapsed") === "true"; } catch { return false; }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("netmon-sidebar-collapsed", String(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "border-r border-border bg-card hidden md:flex flex-col shrink-0 relative z-10 shadow-2xl transition-all duration-300",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {collapsed ? (
          <CollapsedSidebar location={location} collapsed={collapsed} onToggle={toggleCollapsed} />
        ) : (
          <div className="relative h-full">
            <NavContent location={location} />
            <button
              onClick={toggleCollapsed}
              title="Recolher menu"
              className="absolute -right-3 top-8 w-6 h-6 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors z-20 shadow-sm"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
          </div>
        )}
      </aside>

      {/* Mobile sidebar (Sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-64 bg-card border-r border-border">
          <NavContent location={location} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-background overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none -z-10" />

        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 h-14 border-b border-border bg-card/80 backdrop-blur shrink-0">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <Menu className="w-5 h-5" />
              </button>
            </SheetTrigger>
          </Sheet>
          <div className="flex items-center gap-2 text-primary font-bold font-mono tracking-tight">
            <Activity className="w-4 h-4" />
            <span>NETMON</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto p-4 md:p-8 space-y-8 z-0">
          {children}
        </div>
        <footer className="shrink-0 border-t border-border bg-card/30 px-8 py-1.5 flex items-center justify-between">
          <p className="text-[11px] leading-none text-muted-foreground font-mono tracking-wide">
            Desenvolvido por <span className="text-foreground/70">Raian William</span>
          </p>
          <VersionFooter />
        </footer>
      </main>

      <StatusNotifications />
    </div>
  );
}
