"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { AlertCircle, CheckCircle2, Circle, XCircle, RefreshCw, Newspaper } from "lucide-react";

type ServiceStatus = "healthy" | "placeholder" | "disabled" | "unknown";

interface ServiceCard {
  name: string;
  nameAr: string;
  status: ServiceStatus;
  note: string;
}

const SERVICES: ServiceCard[] = [
  {
    name: "MT5 Read-only Bridge",
    nameAr: "جسر MT5 (قراءة فقط)",
    status: "healthy",
    note: "متصل — وضع القراءة فقط. لا يُنفّذ تداول.",
  },
  {
    name: "OKX Connector",
    nameAr: "موصّل OKX",
    status: "placeholder",
    note: "غير مفعّل — عنصر نائب للمرحلة القادمة.",
  },
  {
    name: "Convex Database",
    nameAr: "قاعدة بيانات Convex",
    status: "healthy",
    note: "متصل — يعمل بشكل طبيعي.",
  },
  {
    name: "Clerk Auth",
    nameAr: "مصادقة Clerk",
    status: "healthy",
    note: "مفعّل — نظام المصادقة يعمل.",
  },
  {
    name: "Finnhub News",
    nameAr: "أخبار Finnhub",
    status: "healthy",
    note: "B6.1 — جلب أخبار general / crypto / forex.",
  },
  {
    name: "Telegram Notifications",
    nameAr: "إشعارات Telegram",
    status: "placeholder",
    note: "غير مفعّل — سيتم الربط لاحقاً.",
  },
  {
    name: "Scheduler",
    nameAr: "المجدوِل",
    status: "placeholder",
    note: "غير مفعّل — سيتم الربط لاحقاً.",
  },
  {
    name: "Trading Execution",
    nameAr: "تنفيذ التداول",
    status: "disabled",
    note: "مُعطَّل عمداً — النظام في وضع العرض فقط.",
  },
];

function StatusBadge({ status }: { status: ServiceStatus }) {
  if (status === "healthy") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        يعمل
      </span>
    );
  }
  if (status === "placeholder") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
        <Circle className="h-3.5 w-3.5" />
        Placeholder
      </span>
    );
  }
  if (status === "disabled") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
        <XCircle className="h-3.5 w-3.5" />
        مُعطَّل
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <Circle className="h-3.5 w-3.5" />
      غير معروف
    </span>
  );
}

// ─── Impact badge ─────────────────────────────────────────────────────────────

function ImpactBadge({ impact }: { impact: string }) {
  const cls =
    impact === "HIGH"   ? "border-red-500/30 bg-red-500/10 text-red-300" :
    impact === "MEDIUM" ? "border-amber-500/30 bg-amber-500/10 text-amber-300" :
                          "border-border text-muted-foreground";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {impact === "HIGH" ? "مرتفع" : impact === "MEDIUM" ? "متوسط" : "منخفض"}
    </span>
  );
}

// ─── News Panel ───────────────────────────────────────────────────────────────

function NewsPanel() {
  const { isAuthenticated } = useConvexAuth();
  const fetchNews  = useAction(api.newsIngestion.fetchFinnhubNews);
  const counts     = useQuery(api.newsIngestion.getNewsCounts,  isAuthenticated ? {} : "skip");
  const recentNews = useQuery(api.newsIngestion.listRecentNews, isAuthenticated ? { limit: 10 } : "skip");

  const [fetching, setFetching]       = useState(false);
  const [fetchResult, setFetchResult] = useState<{
    ok: boolean;
    inserted: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  async function handleFetch() {
    if (fetching) return;
    setFetching(true);
    setFetchResult(null);
    try {
      const result = await fetchNews({});
      setFetchResult(result);
    } catch (e) {
      setFetchResult({
        ok: false,
        inserted: 0,
        skipped: 0,
        errors: [e instanceof Error ? e.message : "خطأ غير معروف"],
      });
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-amber-400" />
          <div>
            <p className="font-semibold text-foreground">أخبار Finnhub — B6.1</p>
            <p className="text-xs text-muted-foreground">general / crypto / forex</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleFetch()}
          disabled={fetching || !isAuthenticated}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            fetching || !isAuthenticated
              ? "border-border text-muted-foreground cursor-not-allowed"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 cursor-pointer"
          }`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${fetching ? "animate-spin" : ""}`} />
          {fetching ? "جارٍ الجلب…" : "جلب الأخبار"}
        </button>
      </div>

      {/* Counts */}
      {counts !== undefined && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "عام",    count: counts.general, color: "text-sky-300" },
            { label: "Crypto", count: counts.crypto,  color: "text-violet-300" },
            { label: "Forex",  count: counts.forex,   color: "text-emerald-300" },
            { label: "المجموع", count: counts.total,  color: "text-amber-300" },
          ].map(({ label, count, color }) => (
            <div key={label} className="rounded-lg border border-border bg-muted/5 px-3 py-2 text-center">
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p className={`text-xl font-bold ${color}`}>{count}</p>
            </div>
          ))}
        </div>
      )}

      {/* Last fetch time */}
      {counts?.latestAt && (
        <p className="text-[10px] text-muted-foreground/60 font-mono">
          آخر خبر مُخزَّن: {new Date(counts.latestAt).toLocaleString("ar-IQ")}
        </p>
      )}

      {/* Fetch result */}
      {fetchResult && (
        <div className={`rounded-md border px-3 py-2 text-xs space-y-0.5 ${
          fetchResult.ok
            ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-300"
            : "border-red-500/30 bg-red-500/8 text-red-300"
        }`}>
          <p className="font-semibold">
            {fetchResult.ok ? "✓ تم الجلب بنجاح" : "✗ خطأ أثناء الجلب"}
          </p>
          <p>مُضاف: {fetchResult.inserted} | موجود مسبقاً: {fetchResult.skipped}</p>
          {fetchResult.errors.map((e, i) => (
            <p key={i} className="text-[10px] opacity-80">⚠ {e}</p>
          ))}
        </div>
      )}

      {/* Recent news list */}
      {recentNews && recentNews.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">آخر الأخبار المخزنة:</p>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {recentNews.map((item) => (
              <div
                key={item._id}
                className="rounded border border-border bg-muted/5 px-3 py-2 space-y-0.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] text-foreground/90 leading-tight flex-1">
                    {item.headline}
                  </p>
                  <ImpactBadge impact={item.impact} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[9px] text-muted-foreground/60 font-mono">
                    {item.source ?? item.provider} •{" "}
                    {new Date(item.publishedAt).toLocaleDateString("ar-IQ")}
                  </span>
                  <span className={`text-[9px] font-medium ${
                    item.category === "crypto" ? "text-violet-400" :
                    item.category === "forex"  ? "text-emerald-400" : "text-sky-400"
                  }`}>
                    {item.category}
                  </span>
                  {item.affectedSymbols.slice(0, 3).map((s) => (
                    <span key={s} className="text-[9px] font-mono text-amber-400/70">{s}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : recentNews !== undefined && recentNews.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 text-center py-4">
          لا توجد أخبار مخزنة بعد — اضغط "جلب الأخبار" لبدء الاستيعاب
        </p>
      ) : null}

      <p className="text-[9px] text-muted-foreground/40 border-t border-border/30 pt-2">
        B6.1 — بيانات إخبارية للمراقبة فقط — لا تؤثر على قرارات التداول تلقائياً.
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SystemHealthPage() {
  return (
    <div dir="rtl" className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-amber-500">
          مركز صحة النظام
        </h1>
        <p className="text-muted-foreground">
          مراقبة حالة الخدمات الأساسية
        </p>
      </div>

      {/* Read-only banner */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-amber-200/90 text-sm flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Read-only / لا يوجد تنفيذ تداول</p>
          <p className="opacity-80">
            هذه الشاشة للمراقبة فقط. الحالات الموضحة هي بيانات ثابتة (Placeholder) ولا تعكس API حقيقياً في هذه المرحلة.
          </p>
        </div>
      </div>

      {/* Service cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SERVICES.map((svc) => (
          <div
            key={svc.name}
            className="rounded-xl border border-border bg-card p-5 shadow flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-foreground leading-tight">
                  {svc.nameAr}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {svc.name}
                </p>
              </div>
              <StatusBadge status={svc.status} />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-3">
              {svc.note}
            </p>
          </div>
        ))}
      </div>

      {/* ── B6.1: News Panel ─────────────────────────────────────────────────── */}
      <NewsPanel />
    </div>
  );
}
