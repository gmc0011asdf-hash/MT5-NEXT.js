"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";

import { Button } from "@/components/ui/button";
import { api } from "../../../../convex/_generated/api";
import { institutionalCardClass } from "@/lib/ui-institutional";

export default function ConvexCorePage() {
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const canUseConvex = !isConvexAuthLoading && isAuthenticated;

  const account = useQuery(
    api.coreQueries.getMyLatestAccountSnapshot,
    canUseConvex ? {} : "skip",
  );
  const ticks = useQuery(api.coreQueries.getLatestMarketTicks, canUseConvex ? {} : "skip");
  const signals = useQuery(api.coreQueries.getMyLatestSignals, canUseConvex ? {} : "skip");
  const positions = useQuery(api.coreQueries.getMyOpenPositions, canUseConvex ? {} : "skip");
  const protection = useQuery(api.coreQueries.getMyProtectionEvents, canUseConvex ? {} : "skip");
  const governance = useQuery(api.coreQueries.getMyGovernanceState, canUseConvex ? {} : "skip");
  const monitoring = useQuery(api.coreQueries.getMyMonitoringStatus, canUseConvex ? {} : "skip");
  const audit = useQuery(api.coreQueries.getMyAuditEvents, canUseConvex ? {} : "skip");

  const seedCoreDemoData = useMutation(api.coreSeed.seedCoreDemoData);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const buttonDisabled = isConvexAuthLoading || !isAuthenticated || pending;

  async function handleSeed() {
    if (isConvexAuthLoading || !isAuthenticated) {
      setMessage("يجب تسجيل الدخول أولًا لإنشاء البيانات التجريبية.");
      return;
    }
    setMessage(null);
    setPending(true);
    try {
      await seedCoreDemoData({});
      setMessage("تم إنشاء البيانات التجريبية بنجاح.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "تعذر إنشاء البيانات التجريبية. حاول مرة أخرى.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-4" dir="rtl">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">اختبار قاعدة النظام في Convex</h1>
        <p className="text-muted-foreground text-sm">
          Convex مصادق:{" "}
          <span className="text-amber-100/90 tabular-nums">{String(isAuthenticated)}</span>
          {isConvexAuthLoading && (
            <span className="text-muted-foreground"> · جاري التحميل…</span>
          )}
        </p>
        <p className="mt-2 text-amber-200/85 text-sm leading-relaxed">
          هذه بيانات تجريبية فقط ولا يوجد ربط MT5 أو تنفيذ صفقات.
        </p>
      </div>

      <div className={institutionalCardClass("flex flex-col gap-3 p-4")}>
        <h2 className="font-medium text-amber-100/90">بيانات تجريبية</h2>
        <Button type="button" disabled={buttonDisabled} onClick={() => void handleSeed()}>
          إنشاء بيانات تجريبية للنظام
        </Button>
        {message && (
          <p
            className={
              message.startsWith("تم")
                ? "text-emerald-300/95 text-sm"
                : "text-rose-300/95 text-sm"
            }
          >
            {message}
          </p>
        )}
      </div>

      {canUseConvex && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className={institutionalCardClass("space-y-2 p-4")}>
            <h3 className="font-medium text-amber-100/90">أحدث لقطة حساب</h3>
            {account === undefined ? (
              <p className="text-muted-foreground text-sm">جاري التحميل...</p>
            ) : !account ? (
              <p className="text-muted-foreground text-sm">لا توجد لقطة بعد. أنشئ بيانات تجريبية.</p>
            ) : (
              <ul className="space-y-1 text-foreground text-xs sm:text-sm">
                <li>العملة: {account.currency}</li>
                <li>الرصيد: {account.balance}</li>
                <li>حقوق الملكية: {account.equity}</li>
                <li>الهامش الحر: {account.freeMargin}</li>
                <li>المصدر: {account.source}</li>
              </ul>
            )}
          </div>

          <div className={institutionalCardClass("space-y-2 p-4")}>
            <h3 className="font-medium text-amber-100/90">تيكات السوق</h3>
            {ticks === undefined ? (
              <p className="text-muted-foreground text-sm">جاري التحميل...</p>
            ) : ticks.length === 0 ? (
              <p className="text-muted-foreground text-sm">لا توجد تيكات بعد.</p>
            ) : (
              <ul className="space-y-1 text-xs sm:text-sm">
                {ticks.map((t) => (
                  <li key={t._id} className="text-foreground">
                    {t.symbol} — bid {t.bid} / ask {t.ask} ({t.source})
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={institutionalCardClass("space-y-2 p-4")}>
            <h3 className="font-medium text-amber-100/90">إشارات المختبر</h3>
            {signals === undefined ? (
              <p className="text-muted-foreground text-sm">جاري التحميل...</p>
            ) : signals.length === 0 ? (
              <p className="text-muted-foreground text-sm">لا توجد إشارات بعد.</p>
            ) : (
              <ul className="space-y-1 text-xs sm:text-sm">
                {signals.map((s) => (
                  <li key={s._id} className="text-foreground">
                    {s.symbol} {s.timeframe} — {s.verdict} ({Math.round(s.probability * 100)}٪)
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={institutionalCardClass("space-y-2 p-4")}>
            <h3 className="font-medium text-amber-100/90">مراكز مفتوحة (تجريبي)</h3>
            {positions === undefined ? (
              <p className="text-muted-foreground text-sm">جاري التحميل...</p>
            ) : positions.length === 0 ? (
              <p className="text-muted-foreground text-sm">لا توجد مراكز بعد.</p>
            ) : (
              <ul className="space-y-1 text-xs sm:text-sm">
                {positions.map((p) => (
                  <li key={p._id} className="text-foreground">
                    {p.symbol} {p.type} vol {p.volume} — ربح {p.profit}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={institutionalCardClass("space-y-2 p-4")}>
            <h3 className="font-medium text-amber-100/90">أحداث الحماية</h3>
            {protection === undefined ? (
              <p className="text-muted-foreground text-sm">جاري التحميل...</p>
            ) : protection.length === 0 ? (
              <p className="text-muted-foreground text-sm">لا توجد أحداث بعد.</p>
            ) : (
              <ul className="space-y-1 text-xs sm:text-sm">
                {protection.map((e) => (
                  <li key={e._id} className="text-foreground">
                    [{e.severity}] {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={institutionalCardClass("space-y-2 p-4")}>
            <h3 className="font-medium text-amber-100/90">حوكمة التداول</h3>
            {governance === undefined ? (
              <p className="text-muted-foreground text-sm">جاري التحميل...</p>
            ) : !governance ? (
              <p className="text-muted-foreground text-sm">لا توجد حالة بعد.</p>
            ) : (
              <ul className="space-y-1 text-foreground text-xs sm:text-sm">
                <li>الوضع: {governance.mode}</li>
                <li>التداول مفعّل: {String(governance.tradingEnabled)}</li>
                <li>للقراءة فقط: {String(governance.readOnly)}</li>
                <li>حد المخاطرة اليومي (USD): {governance.maxRiskUsd}</li>
              </ul>
            )}
          </div>

          <div className={institutionalCardClass("space-y-2 p-4")}>
            <h3 className="font-medium text-amber-100/90">حالة المراقبة</h3>
            {monitoring === undefined ? (
              <p className="text-muted-foreground text-sm">جاري التحميل...</p>
            ) : monitoring.length === 0 ? (
              <p className="text-muted-foreground text-sm">لا توجد سجلات مراقبة بعد.</p>
            ) : (
              <ul className="space-y-1 text-xs sm:text-sm">
                {monitoring.map((m) => (
                  <li key={m._id} className="text-foreground">
                    {m.service}: {m.status}
                    {m.message ? ` — ${m.message}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={`md:col-span-2 ${institutionalCardClass("space-y-2 p-4")}`}>
            <h3 className="font-medium text-amber-100/90">سجل التدقيق</h3>
            {audit === undefined ? (
              <p className="text-muted-foreground text-sm">جاري التحميل...</p>
            ) : audit.length === 0 ? (
              <p className="text-muted-foreground text-sm">لا توجد أحداث تدقيق بعد.</p>
            ) : (
              <ul className="space-y-1 text-xs sm:text-sm">
                {audit.map((a) => (
                  <li key={a._id} className="text-foreground">
                    {a.action} / {a.entity}: {a.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
