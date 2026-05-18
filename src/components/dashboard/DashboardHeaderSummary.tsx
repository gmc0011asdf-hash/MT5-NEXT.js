"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/common/status-indicator";
import { useReadOnlyMonitoringSnapshot } from "@/lib/hooks/use-read-only-monitoring-snapshot";
import { useMockMarketStream } from "@/hooks/use-mock-market-stream";

const TITLE = "نظام الملك الهندسي للتداول العالمي";

const TIME_PLACEHOLDER = "--:--:--";

export function DashboardHeaderSummary() {
  const snap = useReadOnlyMonitoringSnapshot();
  const { lastTickAt } = useMockMarketStream();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const referenceTimeLabel =
    mounted && lastTickAt
      ? new Date(lastTickAt).toLocaleTimeString("ar-SA", { hour12: false })
      : TIME_PLACEHOLDER;

  const mt5Ok = snap.phase === "live" && snap.live.mt5.status === "connected";
  const mt5Label =
    snap.phase === "live" ? (mt5Ok ? "MT5: متصل (قراءة)" : `MT5: ${snap.live.mt5.status}`) : "MT5: غير متصل";

  return (
    <div className="rounded-2xl border border-amber-500/15 bg-gradient-to-br from-card via-card to-amber-500/[0.06] p-4 md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="font-semibold text-2xl tracking-tight text-foreground md:text-3xl">{TITLE}</h2>
          <p className="text-muted-foreground text-xs sm:text-sm">
            آخر تحديث مرجعي للواجهة:{" "}
            <span className="tabular-nums text-amber-100/90">{referenceTimeLabel}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge variant="neutral">محكوم بالقواعد</StatusBadge>
          <Badge variant="outline" className="border-amber-500/25 bg-amber-500/10 text-amber-100">
            MT5 Governed
          </Badge>
          <Badge variant="outline" className="border-amber-500/20 text-muted-foreground">
            Pending معطّل
          </Badge>
          <Badge
            variant="outline"
            className={
              mt5Ok
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/20 bg-rose-500/5 text-rose-200/90"
            }
          >
            {mt5Label}
          </Badge>
        </div>
      </div>
    </div>
  );
}
