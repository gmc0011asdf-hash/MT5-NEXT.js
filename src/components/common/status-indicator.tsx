"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Activity, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

const pulseDot = cva("relative inline-flex size-2 shrink-0 rounded-full", {
  variants: {
    tone: {
      ok: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.45)]",
      warning: "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.35)]",
      danger: "bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.4)]",
      neutral: "bg-slate-500",
      mock: "bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.35)]",
    },
    pulse: {
      true: "after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-current after:opacity-35",
      false: "",
    },
  },
  defaultVariants: { tone: "neutral", pulse: false },
});

export type StatusTone = NonNullable<VariantProps<typeof pulseDot>["tone"]>;

export function PulseDot({
  tone,
  pulse = false,
  className,
}: {
  tone: StatusTone;
  pulse?: boolean;
  className?: string;
}) {
  return <span className={cn(pulseDot({ tone, pulse }), className)} aria-hidden />;
}

const badgeWrap = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
  {
    variants: {
      variant: {
        ok: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
        warning: "border-amber-500/20 bg-amber-500/10 text-amber-200",
        danger: "border-rose-500/20 bg-rose-500/10 text-rose-300",
        neutral: "border-border bg-muted/50 text-muted-foreground",
        mock: "border-sky-500/25 bg-sky-500/10 text-sky-200",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export type StatusBadgeVariant = NonNullable<VariantProps<typeof badgeWrap>["variant"]>;

export function StatusBadge({
  variant,
  children,
  icon,
  className,
}: {
  variant: StatusBadgeVariant;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(badgeWrap({ variant }), className)}>
      {icon}
      {children}
    </span>
  );
}

export function MarketMoveIcon({ direction }: { direction: "up" | "down" | "flat" }) {
  if (direction === "up") return <TrendingUp className="size-3.5 text-emerald-300" aria-hidden />;
  if (direction === "down") return <TrendingDown className="size-3.5 text-rose-300" aria-hidden />;
  return <Activity className="size-3.5 text-amber-200/80" aria-hidden />;
}

export function ActivityMicroBar({ active = true }: { active?: boolean }) {
  const heights = [10, 16, 12, 18, 14];
  return (
    <div
      className={cn(
        "flex h-6 w-12 items-end justify-center gap-0.5 rounded-md border border-amber-500/15 bg-black/25 px-1 py-0.5",
        !active && "opacity-40",
      )}
      aria-hidden
    >
      {heights.map((px, i) => (
        <span
          key={i}
          className={cn(
            "w-1 rounded-sm bg-gradient-to-t from-amber-700/50 to-amber-300/90",
            active && "animate-pulse",
          )}
          style={{ height: px, animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}

