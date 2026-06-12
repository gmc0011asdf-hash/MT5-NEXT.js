"use client";

/**
 * /dashboard — لوحة التحكم المحلية
 *
 * Local-First: تسحب البيانات من FastAPI المحلي (port 8010) فقط.
 * لا Convex — لا Clerk — لا auth gates.
 * READ_ONLY_MODE محفوظ — نظام معلوماتي تحليلي فقط.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";

import { MarketSessionsPanel } from "@/components/dashboard/MarketSessionsPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { institutionalCardClass } from "@/lib/ui-institutional";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Mt5Status {
  connected:     boolean;
  account_login: number | null;
  balance:       number | null;
  equity:        number | null;
  free_margin:   number | null;
  currency:      string | null;
  server:        string | null;
  company:       string | null;
  name:          string | null;
  read_only:     boolean;
}

interface FastApiSignal {
  id:             number;
  symbol:         string;
  direction:      "BUY" | "SELL" | null;
  signal_strength: number;
  sl:             number | null;
  tp:             number | null;
  atr:            number | null;
  status:         string;
  timestamp:      string;
}

interface SignalsResponse {
  ok:      boolean;
  count:   number;
  signals: FastApiSignal[];
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

const FASTAPI_BASE = "http://127.0.0.1:8010";

async function fetchMt5Status(): Promise<Mt5Status> {
  const res = await fetch("/api/mt5-readonly/connection-status", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Mt5Status>;
}

async function fetchSignals(): Promise<SignalsResponse> {
  const res = await fetch(`${FASTAPI_BASE}/api/signals?limit=15`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<SignalsResponse>;
}

// ---------------------------------------------------------------------------
// Skeleton block
// ---------------------------------------------------------------------------

function SkeletonBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded-md bg-muted/30"
          style={{ width: `${75 + (i % 3) * 10}%` }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Safety banner
// ---------------------------------------------------------------------------

function LocalSystemBanner() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
      <p className="text-[11px] leading-relaxed text-amber-300/85">
        <span className="font-bold text-amber-300">[نظام محلي] </span>
        واجهة مراقبة وقراءة محلية فقط — لا تنفيذ صفقات — READ_ONLY_MODE محفوظ.
        مصدر البيانات: MT5 محلي على المنفذ 8010.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MT5 Account Card
// ---------------------------------------------------------------------------

function Mt5AccountCard() {
  const { data, isLoading, isError } = useQuery<Mt5Status>({
    queryKey:       ["mt5-connection-status"],
    queryFn:        fetchMt5Status,
    refetchInterval: 30_000,
    retry:          false,
  });

  return (
    <Card className={institutionalCardClass("p-4")}>
      <CardHeader className="p-0 pb-3">
        <CardTitle className="card-title-inst flex items-center gap-2">
          <Activity className="h-4 w-4 text-amber-400" />
          حالة حساب MT5
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <SkeletonBlock rows={4} />
        ) : isError || !data ? (
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <p className="text-xs text-muted-foreground">
              خدمة MT5 غير متوفرة — شغّل الخدمة المحلية
            </p>
          </div>
        ) : !data.connected ? (
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <p className="text-xs text-muted-foreground">
              MT5 غير متصل — افتح منصة MetaTrader 5
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">الرصيد</span>
              <span className="tabular-nums font-medium text-amber-100/90">
                {data.balance?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "--"}{" "}
                <span className="text-[10px] text-muted-foreground">{data.currency ?? ""}</span>
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">حقوق الملكية</span>
              <span className="tabular-nums font-medium text-amber-100/90">
                {data.equity?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "--"}
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">الهامش الحر</span>
              <span className="tabular-nums font-medium text-amber-100/90">
                {data.free_margin?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "--"}
              </span>
            </li>
            <li className="flex items-center justify-between border-t border-amber-500/10 pt-2">
              <span className="text-muted-foreground text-[10px]">قراءة فقط</span>
              <span className="text-[10px] text-emerald-400">
                {data.read_only ? "نعم" : "لا"}
              </span>
            </li>
            {data.server ? (
              <li className="text-[10px] text-muted-foreground/60 truncate">
                الخادم: {data.server}
              </li>
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Signals stats card
// ---------------------------------------------------------------------------

function SignalsStatsCard({ count }: { count: number | null }) {
  return (
    <Card className={institutionalCardClass("p-4")}>
      <CardHeader className="p-0 pb-3">
        <CardTitle className="card-title-inst flex items-center gap-2">
          <Zap className="h-4 w-4 text-cyan-400" />
          إشارات مجلس الوكلاء
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {count === null ? (
          <SkeletonBlock rows={2} />
        ) : count === 0 ? (
          <p className="text-xs text-muted-foreground">
            لا توجد إشارات بعد — المجلس يمسح كل 5 دقائق
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">إجمالي الإشارات</span>
              <span className="text-2xl font-black tabular-nums text-cyan-400">
                {count}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span className="text-[11px] text-muted-foreground">
                محلّل عبر 4 وكلاء متخصصين
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// System status card
// ---------------------------------------------------------------------------

function SystemStatusCard({ mt5Online }: { mt5Online: boolean | null }) {
  return (
    <Card className={institutionalCardClass("p-4")}>
      <CardHeader className="p-0 pb-3">
        <CardTitle className="card-title-inst flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          حالة النظام
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">وضع التشغيل</span>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
            محلي
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">خدمة FastAPI</span>
          {mt5Online === null ? (
            <span className="text-[10px] text-muted-foreground animate-pulse">جاري التحقق...</span>
          ) : mt5Online ? (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              تعمل على 8010
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-rose-400">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              غير متاحة
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Stage 14</span>
          <span className="rounded-full border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-400">
            مقفل
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">READ_ONLY_MODE</span>
          <span className="text-[10px] text-emerald-400">نشط</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Signal direction badge
// ---------------------------------------------------------------------------

function DirectionBadge({ dir }: { dir: "BUY" | "SELL" | null }) {
  if (dir === "BUY")
    return (
      <span className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
        <TrendingUp className="h-3 w-3" />
        شراء
      </span>
    );
  if (dir === "SELL")
    return (
      <span className="flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-300">
        <TrendingDown className="h-3 w-3" />
        بيع
      </span>
    );
  return (
    <span className="rounded-lg border border-border/30 bg-muted/20 px-2 py-0.5 text-[11px] text-muted-foreground">
      انتظار
    </span>
  );
}

// ---------------------------------------------------------------------------
// Signals table
// ---------------------------------------------------------------------------

function SignalsTable() {
  const { data, isLoading, isError } = useQuery<SignalsResponse>({
    queryKey:        ["fastapi-signals"],
    queryFn:         fetchSignals,
    refetchInterval: 60_000,
    retry:           false,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-xl bg-muted/20"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/20 bg-card/30 px-4 py-5">
        <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
        <p className="text-sm text-muted-foreground">
          تعذّر الاتصال بخدمة FastAPI — تأكد من تشغيل الخدمة على المنفذ 8010
        </p>
      </div>
    );
  }

  const signals = data?.signals ?? [];

  if (signals.length === 0) {
    return (
      <div className="rounded-xl border border-border/20 bg-card/30 px-4 py-8 text-center">
        <Zap className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground/70">
          لا توجد إشارات محللة بعد
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground/40">
          مجلس الوكلاء يعمل كل 5 دقائق — تأكد من تشغيل خدمة FastAPI
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/20">
      {/* Table header */}
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 border-b border-border/20 bg-muted/10 px-4 py-2.5">
        {["الرمز", "الاتجاه", "القوة", "وقف الخسارة", "الهدف", "الوقت"].map((h) => (
          <p key={h} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {h}
          </p>
        ))}
      </div>

      {/* Table rows */}
      <div className="divide-y divide-border/15">
        {signals.map((sig) => (
          <div
            key={sig.id}
            className={cn(
              "grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/5",
              sig.direction === "BUY"  && "border-r-2 border-r-emerald-500/40",
              sig.direction === "SELL" && "border-r-2 border-r-rose-500/40",
            )}
          >
            <span className="font-mono text-sm font-bold tracking-wider text-foreground/90">
              {sig.symbol}
            </span>

            <DirectionBadge dir={sig.direction} />

            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted/30">
                <div
                  className={cn(
                    "h-full rounded-full",
                    sig.direction === "BUY"  ? "bg-emerald-500" :
                    sig.direction === "SELL" ? "bg-rose-500"    : "bg-muted-foreground/30",
                  )}
                  style={{ width: `${Math.round((sig.signal_strength ?? 0) * 100)}%` }}
                />
              </div>
              <span className="tabular-nums text-[11px] text-muted-foreground">
                {Math.round((sig.signal_strength ?? 0) * 100)}%
              </span>
            </div>

            <span className="tabular-nums text-xs text-rose-400/80">
              {sig.sl != null
                ? sig.sl.toLocaleString("en-US", { maximumFractionDigits: 2 })
                : "--"}
            </span>

            <span className="tabular-nums text-xs text-emerald-400/80">
              {sig.tp != null
                ? sig.tp.toLocaleString("en-US", { maximumFractionDigits: 2 })
                : "--"}
            </span>

            <span className="tabular-nums text-[10px] text-muted-foreground/60">
              {new Date(sig.timestamp).toLocaleTimeString("ar-SA", {
                hour:   "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const mt5Query = useQuery<Mt5Status>({
    queryKey:        ["mt5-connection-status"],
    queryFn:         fetchMt5Status,
    refetchInterval: 30_000,
    retry:           false,
  });

  const signalsQuery = useQuery<SignalsResponse>({
    queryKey:        ["fastapi-signals"],
    queryFn:         fetchSignals,
    refetchInterval: 60_000,
    retry:           false,
  });

  const mt5Online =
    mt5Query.isLoading ? null :
    mt5Query.isError   ? false :
    (mt5Query.data?.connected ?? false);

  const signalCount =
    signalsQuery.isLoading ? null :
    signalsQuery.isError   ? 0  :
    (signalsQuery.data?.count ?? 0);

  return (
    <div dir="rtl" className="mx-auto flex max-w-7xl flex-col gap-7">

      {/* Page title + safety banner */}
      <section className="space-y-3">
        <div>
          <h3 className="page-title">لوحة التحكم</h3>
          <p className="label-secondary mt-1">
            نظام الملك الهندسي — مراقبة محلية — قراءة فقط
          </p>
        </div>
        <LocalSystemBanner />
      </section>

      {/* Market sessions */}
      <MarketSessionsPanel />

      {/* Stats row */}
      <div className="grid gap-4 md:grid-cols-3">
        <Mt5AccountCard />
        <SignalsStatsCard count={signalCount} />
        <SystemStatusCard mt5Online={mt5Online} />
      </div>

      {/* Signals table */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-cyan-400" />
            <p className="text-sm font-semibold text-foreground/90">
              أحدث إشارات مجلس الوكلاء الأربعة
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground/50">
            MT5 + OKX — H1 — تحديث كل دقيقة
          </p>
        </div>
        <SignalsTable />
      </section>

    </div>
  );
}
