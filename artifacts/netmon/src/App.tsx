import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/components/auth-provider";
import { AppLayout } from "@/components/layout/app-layout";
import Login from "@/pages/login";
import RouterDashboard from "@/pages/dashboard";
import Hosts from "@/pages/hosts";
import AiTerminal from "@/pages/ai-terminal";
import Register from "@/pages/register";
import Settings from "@/pages/settings";
import SystemInfo from "@/pages/info";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RootRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/dashboard");
  }, [setLocation]);
  return null;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAdmin, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      setLocation("/dashboard");
    }
  }, [isLoading, isAdmin, setLocation]);

  if (isLoading) return null;
  if (!isAdmin) return null;
  return <Component />;
}

function AiTerminalRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user?.canAccessAiTerminal) {
      setLocation("/dashboard");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) return null;
  if (!user?.canAccessAiTerminal) return null;
  return <Component />;
}

function ProtectedRoutes() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/dashboard" component={RouterDashboard} />
        <Route path="/hosts" component={Hosts} />
        <Route path="/ai-terminal" component={() => <AiTerminalRoute component={AiTerminal} />} />
        <Route path="/register" component={() => <AdminRoute component={Register} />} />
        <Route path="/settings" component={() => <AdminRoute component={Settings} />} />
        <Route path="/info" component={() => <AdminRoute component={SystemInfo} />} />
        <Route path="/" component={RootRedirect} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="*">
        <ProtectedRoutes />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
