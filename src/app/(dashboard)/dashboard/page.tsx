"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketSessionsPanel } from "@/components/dashboard/MarketSessionsPanel";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { useConvexAuth, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";

type LiveMt5Account = {
  connected: boolean;
  balance:   number | null;
  equity:    number | null;
  freeMargin: number | null;
  currency:  string | null;
  readOnly:  boolean;
};

const NO_REAL_MT5_DATA_AR =
  "لا توجد بيانات MT5 حقيقية بعد — شغّل خدمة MT5 المحلية واضغط مزامنة MT5 المحلي للقراءة فقط.";

export default function DashboardPage() {
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !isConvexAuthLoading && isAuthenticated;

  const account = useQuery(
    api.coreQueries.getMyLatestRealMt5AccountSnapshot,
    canUseConvex ? {} : "skip",
  );
  const ticks = useQuery(api.coreQueries.getLatestRealMt5MarketTicks, canUseConvex ? {} : "skip");
  const governance = useQuery(api.coreQueries.getMyGovernanceState, canUseConvex ? {} : "skip");
  const monitoring = useQuery(api.coreQueries.getMyMonitoringStatus, canUseConvex ? {} : "skip");
  const protection = useQuery(api.coreQueries.getMyProtectionEvents, canUseConvex ? {} : "skip");
  const mt5Summary = useQuery(api.coreQueries.getMyMt5ReadOnlySummary, canUseConvex ? {} : "skip");

  // ── Live MT5 account — يُجلَب مباشرة من connection-status (لا Convex) ──────
  const [liveMt5, setLiveMt5] = useState<LiveMt5Account | null>(null);
  const [liveMt5Loading, setLiveMt5Loading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchLive() {
      try {
        const res = await fetch("/api/mt5-readonly/connection-status", { cache: "no-store" });
        const data = (await res.json()) as Record<string, unknown>;
        if (!cancelled) {
          setLiveMt5({
            connected:  Boolean(data.connected),
            balance:    typeof data.balance    === "number" ? data.balance    : null,
            equity:     typeof data.equity     === "number" ? data.equity     : null,
            freeMargin: typeof data.free_margin === "number" ? data.free_margin : null,
            currency:   typeof data.currency   === "string" ? data.currency   : null,
            readOnly:   data.read_only !== false,
          });
          setLiveMt5Loading(false);
        }
      } catch {
        if (!cancelled) {
          setLiveMt5({ connected: false, balance: null, equity: null, freeMargin: null, currency: null, readOnly: true });
          setLiveMt5Loading(false);
        }
      }
    }
    void fetchLive();
    const id = window.setInterval(() => void fetchLive(), 30_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  function convexFallbackLine() {
    return <p className="text-muted-foreground text-sm">{NO_REAL_MT5_DATA_AR}</p>;
  }

  function convexLoadingLine() {
    return <p className="text-muted-foreground text-sm">جاري تحميل بيانات Convex...</p>;
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <section className="space-y-3">
        <h3 className="page-title">لوحة التحكم</h3>
        <p className="label-secondary">ملخص MT5 المحلي — قراءة فقط.</p>
        {isConvexAuthLoading ? (
          <p className="text-muted-foreground text-xs">جاري التحقق من ربط Convex...</p>
        ) : null}
        {canUseConvex && mt5Summary?.hasRealMt5LocalData ? (
          <p className="text-muted-foreground text-xs">
            مصدر البيانات الحالي: MT5 المحلي للقراءة فقط — تُستبعد لقطات الوهم التجريبية من العرض الرئيسي عند توفر بيانات محلية.
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">MT5 هو مصدر البيانات الحالي — قراءة فقط.</p>
      </section>

      <MarketSessionsPanel />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">حالة الحساب</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-0 text-muted-foreground text-sm">
            {liveMt5Loading ? (
              <p className="text-muted-foreground text-sm animate-pulse">جاري جلب بيانات MT5 الحية...</p>
            ) : !liveMt5?.connected ? (
              <p className="text-muted-foreground text-sm">
                MT5 غير متصل — شغّل خدمة MT5 المحلية للقراءة
              </p>
            ) : (
              <ul className="space-y-1 text-foreground">
                <li>
                  الرصيد:{" "}
                  <span className="tabular-nums text-amber-100/90">
                    {liveMt5.balance ?? "—"}
                  </span>{" "}
                  {liveMt5.currency ?? ""}
                </li>
                <li>
                  حقوق الملكية:{" "}
                  <span className="tabular-nums text-amber-100/90">
                    {liveMt5.equity ?? "—"}
                  </span>
                </li>
                <li>
                  الهامش الحر:{" "}
                  <span className="tabular-nums text-amber-100/90">
                    {liveMt5.freeMargin ?? "—"}
                  </span>
                </li>
                <li className="text-muted-foreground text-xs">
                  قراءة فقط: {liveMt5.readOnly ? "نعم" : "لا"} — مصدر: MT5 مباشر
                </li>
                {mt5Summary?.hasRealMt5LocalData ? (
                  <>
                    <li className="border-t border-amber-500/10 pt-2 text-xs">
                      مراكز مفتوحة (آخر مزامنة):{" "}
                      <span className="tabular-nums text-amber-100/90">
                        {mt5Summary.openPositionsCount}
                      </span>
                    </li>
                    <li className="text-xs">
                      مجموع الربح العائم:{" "}
                      <span className="tabular-nums text-amber-100/90">
                        {mt5Summary.totalFloatingProfit.toFixed(2)}
                      </span>
                    </li>
                    {mt5Summary.lastSyncAt != null ? (
                      <li className="text-muted-foreground text-[11px]">
                        آخر مزامنة:{" "}
                        {new Date(mt5Summary.lastSyncAt).toLocaleString("ar-SA", { hour12: false })}
                      </li>
                    ) : null}
                  </>
                ) : null}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">تيكات السوق (Convex)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-0 text-muted-foreground text-sm">
            {!canUseConvex && !isConvexAuthLoading ? (
              convexFallbackLine()
            ) : isConvexAuthLoading ? (
              convexLoadingLine()
            ) : ticks === undefined ? (
              convexLoadingLine()
            ) : ticks.length === 0 ? (
              convexFallbackLine()
            ) : (
              <ul className="space-y-2">
                {ticks.slice(0, 8).map((t) => (
                  <li key={t._id} className="rounded-lg border border-amber-500/10 bg-muted/15 px-2 py-1.5 text-foreground text-xs">
                    <span className="font-medium">{t.symbol}</span> — bid{" "}
                    <span className="tabular-nums">{t.bid}</span> · ask{" "}
                    <span className="tabular-nums">{t.ask}</span> · انتشار{" "}
                    <span className="tabular-nums">{t.spread}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">حوكمة Convex</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-0 text-muted-foreground text-sm">
            {!canUseConvex && !isConvexAuthLoading ? (
              convexFallbackLine()
            ) : isConvexAuthLoading ? (
              convexLoadingLine()
            ) : governance === undefined ? (
              convexLoadingLine()
            ) : governance === null ? (
              convexFallbackLine()
            ) : (
              <ul className="space-y-1 text-foreground">
                <li>قراءة فقط: {governance.readOnly ? "نعم" : "لا"}</li>
                <li>التداول مفعّل: {governance.tradingEnabled ? "نعم" : "لا"}</li>
                <li>
                  حد المخاطرة الأقصى (USD):{" "}
                  <span className="tabular-nums text-amber-100/90">{governance.maxRiskUsd}</span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">مراقبة Convex</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-0 text-muted-foreground text-sm">
            {!canUseConvex && !isConvexAuthLoading ? (
              convexFallbackLine()
            ) : isConvexAuthLoading ? (
              convexLoadingLine()
            ) : monitoring === undefined ? (
              convexLoadingLine()
            ) : monitoring.length === 0 ? (
              convexFallbackLine()
            ) : (
              <ul className="space-y-1.5">
                {monitoring.slice(0, 6).map((m) => (
                  <li key={m._id} className="text-foreground text-xs leading-snug">
                    <span className="font-medium text-amber-100/85">{m.service}</span>: {m.status}
                    {m.message ? ` — ${m.message}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4 md:col-span-2 xl:col-span-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">أحداث الحماية (Convex)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-0 text-muted-foreground text-sm">
            {!canUseConvex && !isConvexAuthLoading ? convexFallbackLine() : null}
            {isConvexAuthLoading || protection === undefined ? convexLoadingLine() : null}
            {protection && protection.length === 0 ? convexFallbackLine() : null}
            {protection && protection.length > 0 ? (
              <ul className="space-y-2">
                {protection.slice(0, 8).map((e) => (
                  <li key={e._id} className="rounded-lg border border-amber-500/10 bg-muted/15 px-2 py-1.5 text-foreground text-xs">
                    [{e.severity}] {e.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Alert className="border-amber-500/25 bg-amber-500/5">
        <AlertTitle>تنبيه أمان</AlertTitle>
        <AlertDescription>
          هذه الواجهة للقراءة والمراقبة فقط ولا ترسل أوامر تداول.
        </AlertDescription>
      </Alert>
    </div>
  );
}
