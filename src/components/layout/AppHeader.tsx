"use client";

import { useEffect, useState } from "react";
import { Shield } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/common/status-indicator";
import { useMt5ConnectionStatus } from "@/lib/hooks/use-mt5-connection-status";

const SYSTEM_NAME = "نظام الملك الهندسي للتداول العالمي";

export function AppHeader() {
  const { status, lastCheckedAt } = useMt5ConnectionStatus();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const lastUpdateLabel =
    mounted && lastCheckedAt
      ? new Date(lastCheckedAt).toLocaleTimeString("ar-SA", { hour12: false })
      : "--";

  const mt5Connected = status?.connected === true;

  return (
    <header className="shrink-0 border-b border-amber-500/10 bg-gradient-to-l from-card/90 to-card/40 px-4 py-3 backdrop-blur-md md:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2 md:gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-foreground sm:text-base">
            {SYSTEM_NAME}
          </h1>
          <p className="tabular-nums text-[11px] text-muted-foreground sm:text-xs">
            آخر تحقق MT5: {lastUpdateLabel}
          </p>
        </div>

        <Badge
          variant="outline"
          className={
            mt5Connected
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/20 bg-rose-500/5 text-rose-200/90"
          }
        >
          {mt5Connected ? "متصل بمنصة MT5" : "غير متصل بمنصة MT5"}
        </Badge>

        {/* Local-mode identity badge — no auth required */}
        <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1">
          <Shield className="h-3 w-3 text-amber-400" />
          <span className="text-[11px] font-medium text-amber-300">نظام محلي</span>
        </div>
      </div>

      <Separator className="my-3 border-amber-500/10" />

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <StatusBadge variant="neutral">محكوم بالقواعد</StatusBadge>

        {!mt5Connected ? (
          <span className="text-xs leading-relaxed text-muted-foreground">
            افتح منصة MT5 وشغّل خدمة MT5 المحلية
          </span>
        ) : (
          <>
            {status?.account_login ? (
              <Badge
                variant="outline"
                className="tabular-nums border-amber-500/20 bg-amber-500/10 text-amber-100"
              >
                الحساب: {status.account_login}
              </Badge>
            ) : null}
            {status?.name ? (
              <Badge
                variant="outline"
                className="max-w-[220px] truncate border-border text-muted-foreground"
              >
                الاسم: {status.name}
              </Badge>
            ) : null}
            {status?.server ? (
              <Badge
                variant="outline"
                className="max-w-[260px] truncate border-border text-muted-foreground"
              >
                الخادم: {status.server}
              </Badge>
            ) : null}
            {status?.balance != null ? (
              <Badge
                variant="outline"
                className="tabular-nums border-border text-muted-foreground"
              >
                الرصيد: {status.balance} {status.currency ?? ""}
              </Badge>
            ) : null}
            {status?.equity != null ? (
              <Badge
                variant="outline"
                className="tabular-nums border-border text-muted-foreground"
              >
                حقوق الملكية: {status.equity}
              </Badge>
            ) : null}
            {status?.free_margin != null ? (
              <Badge
                variant="outline"
                className="tabular-nums border-border text-muted-foreground"
              >
                الهامش الحر: {status.free_margin}
              </Badge>
            ) : null}
          </>
        )}

        <Badge variant="outline" className="border-border text-muted-foreground">
          مصدر البيانات: MT5 الحقيقي
        </Badge>
        <Badge variant="outline" className="border-border text-muted-foreground">
          READ_ONLY_MODE
        </Badge>
      </div>
    </header>
  );
}
