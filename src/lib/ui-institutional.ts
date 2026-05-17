import { cn } from "@/lib/utils";

/** Primary institutional surface: dark card + subtle gold wash + amber border. */
export function institutionalCardClass(extra?: string) {
  return cn(
    "rounded-2xl border border-amber-500/15 bg-gradient-to-br from-card to-amber-500/[0.04] shadow-sm",
    extra,
  );
}

export function institutionalCardInner() {
  return "rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm";
}
