"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MarketPulseIndicator } from "@/components/dashboard/MarketPulseIndicator";
import { StatusBadge } from "@/components/common/status-indicator";
import { useMockMarketStream } from "@/hooks/use-mock-market-stream";
import { useReadOnlyMonitoringSnapshot } from "@/lib/hooks/use-read-only-monitoring-snapshot";

const SYSTEM_NAME = "نظام الملك الهندسي للتداول العالمي";

export function AppHeader() {
  const snap = useReadOnlyMonitoringSnapshot();
  const { lastTickAt } = useMockMarketStream();

  const mt5Connected = snap.phase === "live" && snap.live.mt5.status === "connected";
  const mt5Badge = snap.phase === "live" ? (mt5Connected ? "MT5 (قراءة): متصل" : `MT5: ${snap.live.mt5.status}`) : "MT5 غير متصل";

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-amber-500/10 bg-gradient-to-l from-card/90 to-card/40 px-4 py-2 backdrop-blur-md md:flex-nowrap md:px-5">
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-semibold text-sm text-foreground sm:text-base">{SYSTEM_NAME}</h1>
        <p className="text-muted-foreground text-[11px] tabular-nums sm:text-xs">
          آخر تحديث واجهة:{" "}
          {lastTickAt ? new Date(lastTickAt).toLocaleTimeString("ar-SA", { hour12: false }) : "—"}
        </p>
      </div>
      <Separator orientation="vertical" className="hidden h-8 sm:block" />
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <MarketPulseIndicator mockLive />
        <StatusBadge variant="neutral">قراءة فقط</StatusBadge>
        <Badge
          variant="outline"
          className={
            mt5Connected
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/20 bg-rose-500/5 text-rose-200/90"
          }
        >
          {mt5Badge}
        </Badge>
        <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-100">
          Demo Mode
        </Badge>
        <Badge variant="outline" className="border-border text-muted-foreground">
          Pending معطّل
        </Badge>
      </div>
    </header>
  );
}
