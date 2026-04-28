"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardActivitySection } from "@/components/dashboard/DashboardActivitySection";
import { DashboardHeaderSummary } from "@/components/dashboard/DashboardHeaderSummary";
import { DashboardSystemCards } from "@/components/dashboard/DashboardSystemCards";
import { LiveMarketTicker } from "@/components/dashboard/LiveMarketTicker";
import { MarketSessionsPanel } from "@/components/dashboard/MarketSessionsPanel";
import { mockSignals } from "@/lib/constants/mock-data";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { useConvexAuth, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";

const NO_CONVEX_DATA_AR =
  "لا توجد بيانات Convex بعد — استخدم صفحة قاعدة Convex لإنشاء بيانات تجريبية.";

export default function DashboardPage() {
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !isConvexAuthLoading && isAuthenticated;

  const account = useQuery(
    api.coreQueries.getMyLatestAccountSnapshot,
    canUseConvex ? {} : "skip",
  );
  const ticks = useQuery(api.coreQueries.getLatestMarketTicks, canUseConvex ? {} : "skip");
  const governance = useQuery(api.coreQueries.getMyGovernanceState, canUseConvex ? {} : "skip");
  const monitoring = useQuery(api.coreQueries.getMyMonitoringStatus, canUseConvex ? {} : "skip");
  const protection = useQuery(api.coreQueries.getMyProtectionEvents, canUseConvex ? {} : "skip");
  const mt5Summary = useQuery(api.coreQueries.getMyMt5ReadOnlySummary, canUseConvex ? {} : "skip");

  function convexFallbackLine() {
    return <p className="text-muted-foreground text-sm">{NO_CONVEX_DATA_AR}</p>;
  }

  function convexLoadingLine() {
    return <p className="text-muted-foreground text-sm">جاري تحميل بيانات Convex...</p>;
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <DashboardHeaderSummary />

      <section className="space-y-3">
        <h3 className="page-title">لوحة التحكم</h3>
        <p className="label-secondary">ملخص مؤسسي — بيانات السوق أدناه وهمية للواجهة فقط.</p>
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

      <LiveMarketTicker />

      <MarketSessionsPanel />

      <section className="space-y-3">
        <h3 className="card-title-inst text-foreground">حالة الأنظمة</h3>
        <DashboardSystemCards />
      </section>

      <DashboardActivitySection />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className={institutionalCardClass("p-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">حالة الحساب</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-0 text-muted-foreground text-sm">
            {!canUseConvex && !isConvexAuthLoading ? (
              convexFallbackLine()
            ) : isConvexAuthLoading ? (
              convexLoadingLine()
            ) : account === undefined ? (
              convexLoadingLine()
            ) : account === null ? (
              convexFallbackLine()
            ) : (
              <ul className="space-y-1 text-foreground">
                <li>
                  الرصيد:{" "}
                  <span className="tabular-nums text-amber-100/90">{account.balance}</span>{" "}
                  {account.currency}
                </li>
                <li>
                  حقوق الملكية:{" "}
                  <span className="tabular-nums text-amber-100/90">{account.equity}</span>
                </li>
                <li>
                  الهامش الحر:{" "}
                  <span className="tabular-nums text-amber-100/90">{account.freeMargin}</span>
                </li>
                <li className="text-muted-foreground text-xs">المصدر: {account.source}</li>
                {mt5Summary?.hasRealMt5LocalData ? (
                  <>
                    <li className="border-t border-amber-500/10 pt-2 text-xs">
                      مراكز مفتوحة (عرض محلي):{" "}
                      <span className="tabular-nums text-amber-100/90">{mt5Summary.openPositionsCount}</span>
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
                        {new Date(mt5Summary.lastSyncAt).toLocaleString("ar-SA", {
                          hour12: false,
                        })}
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
            {!canUseConvex && !isConvexAuthLoading ? (
              convexFallbackLine()
            ) : isConvexAuthLoading ? (
              convexLoadingLine()
            ) : protection === undefined ? (
              convexLoadingLine()
            ) : protection.length === 0 ? (
              convexFallbackLine()
            ) : (
              <ul className="space-y-2">
                {protection.slice(0, 8).map((e) => (
                  <li key={e._id} className="rounded-lg border border-amber-500/10 bg-muted/15 px-2 py-1.5 text-foreground text-xs">
                    [{e.severity}] {e.message}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={institutionalCardClass("p-4 md:col-span-2 xl:col-span-4")}>
          <CardHeader className="p-0 pb-2">
            <CardTitle className="card-title-inst">لمحة من المختبر</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-0 text-sm">
            {mockSignals.slice(0, 2).map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/10 bg-muted/20 px-3 py-2"
              >
                <span className="font-medium text-amber-100/90 tabular-nums">{s.pair}</span>
                <span className="text-muted-foreground">{s.verdict}</span>
                <span className="text-muted-foreground text-xs tabular-nums">{s.timeframe}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Alert className="border-amber-500/25 bg-amber-500/5">
        <AlertTitle>تنبيه أمان</AlertTitle>
        <AlertDescription>
          هذه الواجهة للقراءة والمراقبة فقط ولا ترسل أوامر تداول. بيانات الأسعار أعلاه تيار وهمي للعرض.
        </AlertDescription>
      </Alert>
    </div>
  );
}
