import { useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLogin, useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Lock, User, Terminal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";

const loginSchema = z.object({
  username: z.string().min(1, "Usuário é obrigatório"),
  password: z.string().min(1, "Senha é obrigatória"),
  rememberMe: z.boolean().default(false),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: user, isLoading: isLoadingUser } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false, refetchOnWindowFocus: false },
  });

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "", rememberMe: false },
  });

  const loginMutation = useLogin({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setLocation("/dashboard");
      },
      onError: () => {
        toast({
          title: "Erro de Autenticação",
          description: "Usuário ou senha inválidos. Acesso negado.",
          variant: "destructive",
        });
      },
    },
  });

  useEffect(() => {
    if (user) {
      setLocation("/dashboard");
    }
  }, [user, setLocation]);

  const onSubmit = (values: z.infer<typeof loginSchema>) => {
    loginMutation.mutate({ data: values });
  };

  if (isLoadingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden text-foreground selection:bg-primary/30">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />

      <div className="w-full max-w-[400px] z-10">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-card border border-border shadow-2xl rounded-xl flex items-center justify-center mb-6 relative group">
            <div className="absolute inset-0 rounded-xl bg-primary/20 blur-xl opacity-50 group-hover:opacity-100 transition-opacity" />
            <Activity className="w-8 h-8 text-primary relative z-10" />
          </div>
          <h1 className="text-3xl font-bold font-mono tracking-tight text-foreground mb-2">NETMON</h1>
          <p className="text-sm text-muted-foreground font-mono tracking-wider">NETWORK HUB</p>
          <p className="text-[10px] text-muted-foreground/60 font-mono tracking-widest mt-1">v4.8</p>
        </div>

        <div className="bg-card/50 backdrop-blur-md border border-border rounded-xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Usuário</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <div className="absolute left-3 top-2.5 text-muted-foreground">
                          <User className="w-4 h-4" />
                        </div>
                        <Input
                          placeholder="admin"
                          {...field}
                          data-testid="input-username"
                          className="pl-9 bg-background/50 border-border focus-visible:ring-primary font-mono h-11"
                          autoComplete="username"
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="font-mono text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Senha</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <div className="absolute left-3 top-2.5 text-muted-foreground">
                          <Lock className="w-4 h-4" />
                        </div>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          {...field}
                          data-testid="input-password"
                          className="pl-9 bg-background/50 border-border focus-visible:ring-primary font-mono h-11"
                          autoComplete="current-password"
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="font-mono text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rememberMe"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-remember-me"
                        className="cursor-pointer"
                      />
                    </FormControl>
                    <FormLabel className="font-mono text-xs text-muted-foreground cursor-pointer !mt-0">
                      Lembrar Login
                    </FormLabel>
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                data-testid="button-submit"
                className="w-full h-11 font-mono uppercase tracking-widest text-xs font-bold"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> AUTENTICANDO...</>
                ) : (
                  <><Terminal className="w-4 h-4 mr-2" /> INICIAR SESSÃO</>
                )}
              </Button>
            </form>
          </Form>
        </div>

        <div className="mt-8 text-center">
          <p className="text-[10px] text-muted-foreground/50 font-mono tracking-widest uppercase">
            Acesso Restrito • Monitoramento Ativo
          </p>
        </div>
      </div>
    </div>
  );
}
