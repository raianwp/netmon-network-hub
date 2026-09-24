import { Terminal, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function IaTerminalIcon({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex items-center justify-center shrink-0", className)}>
      <Terminal className="w-full h-full" />
      <Sparkles className="absolute -top-[15%] -right-[20%] w-[50%] h-[50%] text-primary fill-primary" strokeWidth={1.5} />
    </span>
  );
}
