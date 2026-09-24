import { useEffect, useRef, useState } from "react";
import {
  useListHosts,
  useListHostStatuses,
  useGetSettings,
  useGetInternetStatus,
  getListHostStatusesQueryKey,
  getGetInternetStatusQueryKey,
} from "@workspace/api-client-react";
import { CheckCircle2, XCircle, X, Bell, Globe } from "lucide-react";
import { format } from "date-fns";

interface ToastItem {
  id: string;
  kind: "host" | "internet";
  direction: "online" | "offline";
  title: string;
  subtitle: string;
  time: Date;
}

function sendDesktopNotification(title: string, body: string, tag: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new window.Notification(title, { body, icon: "/favicon.svg", tag });
  } catch {
    // silently ignore — some browsers block in certain contexts
  }
}

export function StatusNotifications() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null);
  const prevHostStatusesRef = useRef<Record<number, string>>({});
  const prevInternetStatusRef = useRef<string>("unknown");
  const isFirstHostRun = useRef(true);
  const isFirstInternetRun = useRef(true);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const { data: settings } = useGetSettings();
  const { data: hosts } = useListHosts();
  const { data: statuses } = useListHostStatuses({
    query: { queryKey: getListHostStatusesQueryKey(), refetchInterval: 10000 },
  });
  const { data: internetStatus } = useGetInternetStatus({
    query: { queryKey: getGetInternetStatusQueryKey(), refetchInterval: 30000 },
  });

  const durationMs = (settings?.notificationDurationSeconds ?? 10) * 1000;

  // Whether we need desktop notification permission at all
  const needsDesktopPermission =
    (hosts?.some((h) => h.notifyDesktop && h.enabled) ?? false) ||
    (settings?.internetCheckEnabled && settings?.internetCheckNotifyDesktop);

  // Sync current browser permission state
  useEffect(() => {
    if (!("Notification" in window)) return;
    setNotifPermission(Notification.permission);
  }, []);

  const requestPermission = async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  };

  // ── Host status change detection ────────────────────────────────────────────
  useEffect(() => {
    if (!statuses || !hosts) return;

    const currentMap: Record<number, string> = {};
    statuses.forEach((s) => { currentMap[s.hostId] = s.status ?? "unknown"; });

    if (isFirstHostRun.current) {
      isFirstHostRun.current = false;
      prevHostStatusesRef.current = currentMap;
      return;
    }

    const toAdd: ToastItem[] = [];

    for (const [hostIdStr, newStatus] of Object.entries(currentMap)) {
      const hostId = Number(hostIdStr);
      const oldStatus = prevHostStatusesRef.current[hostId];
      if (!oldStatus || oldStatus === "unknown" || newStatus === oldStatus) continue;
      if (newStatus !== "online" && newStatus !== "offline") continue;

      const host = hosts.find((h) => h.id === hostId);
      if (!host?.enabled) continue;

      if (host.notifyDesktop) {
        const title = newStatus === "online"
          ? `✅ ${host.name} voltou online`
          : `🔴 ${host.name} ficou offline`;
        const body = `IP: ${host.ipAddress} · ${format(new Date(), "HH:mm:ss")}`;
        sendDesktopNotification(title, body, `netmon-host-${host.ipAddress}-${newStatus}`);
      }

      toAdd.push({
        id: `host-${hostId}-${Date.now()}-${Math.random()}`,
        kind: "host",
        direction: newStatus as "online" | "offline",
        title: host.name,
        subtitle: host.ipAddress,
        time: new Date(),
      });
    }

    prevHostStatusesRef.current = currentMap;
    addToasts(toAdd);
  }, [statuses, hosts]);

  // ── Internet status change detection ────────────────────────────────────────
  useEffect(() => {
    if (!internetStatus) return;
    const newStatus = internetStatus.status;

    if (isFirstInternetRun.current) {
      isFirstInternetRun.current = false;
      prevInternetStatusRef.current = newStatus;
      return;
    }

    const oldStatus = prevInternetStatusRef.current;
    if (oldStatus === newStatus || oldStatus === "unknown") {
      prevInternetStatusRef.current = newStatus;
      return;
    }

    prevInternetStatusRef.current = newStatus;

    if (newStatus !== "online" && newStatus !== "offline") return;

    // Desktop notification for internet (if enabled in settings)
    if (settings?.internetCheckEnabled && settings?.internetCheckNotifyDesktop) {
      const title = newStatus === "online"
        ? "✅ Internet voltou online"
        : "🔴 Internet ficou offline";
      const body = format(new Date(), "HH:mm:ss");
      sendDesktopNotification(title, body, `netmon-internet-${newStatus}`);
    }

    // Always show in-app toast for internet changes
    addToasts([{
      id: `internet-${Date.now()}-${Math.random()}`,
      kind: "internet",
      direction: newStatus,
      title: newStatus === "online" ? "Internet online" : "Internet offline",
      subtitle: newStatus === "online" ? "Conectividade restaurada" : "Sem conectividade externa",
      time: new Date(),
    }]);
  }, [internetStatus, settings]);

  // ── Toast helpers ────────────────────────────────────────────────────────────
  function addToasts(items: ToastItem[]) {
    if (items.length === 0) return;
    setToasts((prev) => [...prev, ...items]);
    items.forEach((n) => {
      timersRef.current[n.id] = setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== n.id));
        delete timersRef.current[n.id];
      }, durationMs);
    });
  }

  const dismiss = (id: string) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    setToasts((prev) => prev.filter((x) => x.id !== id));
  };

  const showPermissionBanner = needsDesktopPermission && notifPermission === "default";
  const showPermissionDenied = needsDesktopPermission && notifPermission === "denied";

  return (
    <>
      {/* Permission request banner */}
      {showPermissionBanner && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-primary/40 shadow-lg rounded-xl px-4 py-3 font-mono text-xs max-w-sm w-full">
          <Bell className="w-4 h-4 text-primary shrink-0" />
          <span className="flex-1 text-muted-foreground">Notificações na área de trabalho estão ativadas.</span>
          <button
            onClick={requestPermission}
            className="text-primary font-semibold hover:underline shrink-0"
          >
            Permitir
          </button>
        </div>
      )}

      {/* Permission denied warning */}
      {showPermissionDenied && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-destructive/40 shadow-lg rounded-xl px-4 py-3 font-mono text-xs max-w-sm w-full">
          <Bell className="w-4 h-4 text-destructive shrink-0" />
          <span className="flex-1 text-muted-foreground">
            Notificações bloqueadas. Habilite nas configurações do navegador.
          </span>
          <button
            onClick={() => setNotifPermission(null)}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* In-app toast stack */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map((n) => (
            <div
              key={n.id}
              className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-md min-w-[260px] max-w-[320px] animate-in slide-in-from-right-5 fade-in duration-300 ${
                n.direction === "online"
                  ? "bg-card/90 border-emerald-500/30"
                  : "bg-card/90 border-destructive/30"
              }`}
            >
              <div className="shrink-0 mt-0.5">
                {n.kind === "internet" ? (
                  <Globe className={`w-4 h-4 ${n.direction === "online" ? "text-emerald-500" : "text-destructive"}`} />
                ) : n.direction === "online" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <XCircle className="w-4 h-4 text-destructive" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono font-semibold text-foreground truncate">{n.title}</p>
                <p className="text-[11px] font-mono text-muted-foreground">{n.subtitle}</p>
                <p className={`text-[11px] font-mono font-medium mt-0.5 ${n.direction === "online" ? "text-emerald-500" : "text-destructive"}`}>
                  {n.direction === "online" ? "Online" : "Offline"}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">
                  {format(n.time, "HH:mm:ss")}
                </p>
              </div>
              <button
                onClick={() => dismiss(n.id)}
                className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
