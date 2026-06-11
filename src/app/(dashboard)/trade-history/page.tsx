"use client";

import { useState, useCallback, useEffect } from "react";
import { History, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";

interface MatchedSignal {
  id: number;
  confluenceLevel: string | null;
  signalStrength: number;
  sl: number | null;
  tp: number | null;
  rr: number | null;
  timestamp: string | null;
  matchedTimeDeltaSeconds: number | null;
}

interface ClosedTrade {
  id: number;
  positionId: number;
  symbol: string;
  direction: string;
  volume: number;
  openPrice: number;
  openTime: string | null;
  closePrice: number;
  closeTime: string | null;
  closeVolume: number;
  dealsCount: number;
  profit: number;
  commission: number;
  swap: number;
  matchedSignal: MatchedSignal | null;
}

interface OpenPosition {
  id: number;
  ticket: number;
  symbol: string;
  direction: string;
  volume: number;
  openPrice: number;
  openTime: string | null;
  currentPrice: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  matchedSignal: MatchedSignal | null;
}

interface ClosedResponse {
  ok: boolean;
  total: number;
  trades: ClosedTrade[];
  error?: string;
}

interface OpenResponse {
  ok: boolean;
  total: number;
  positions: OpenPosition[];
  error?: string;
}

interface SummaryResponse {
  ok: boolean;
  days: number;
  totalTrades: number;
  matchedTrades: number;
  unmatchedTrades: number;
  overallWinRatePct: number | null;
  matchedWinRatePct: number | null;
  unmatchedWinRatePct: number | null;
  netProfit: number;
  error?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatTimeDelta(seconds: number | null): string {
  if (seconds === null) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `قبل ${hours} ساعة و${minutes} دقيقة من فتح الصفقة`;
  return `قبل ${minutes} دقيقة من فتح الصفقة`;
}

function directionLabel(direction: string): string {
  return direction === "BUY" ? "شراء" : "بيع";
}

function profitClass(profit: number): string {
  if (profit > 0) return "text-green-400";
  if (profit < 0) return "text-red-400";
  return "text-slate-400";
}

function signalBadge(signal: MatchedSignal | null) {
  if (!signal) {
    return (
      <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
        لا توجد إشارة مطابقة
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="rounded border border-green-700 bg-green-950 px-2 py-0.5 text-xs text-green-400 w-fit">
        ✅ مرتبطة بإشارة — {signal.confluenceLevel ?? "—"}
      </span>
      <span className="text-[10px] text-slate-500">{formatTimeDelta(signal.matchedTimeDeltaSeconds)}</span>
    </div>
  );
}

export default function TradeHistoryPage() {
  const [closed, setClosed] = useState<ClosedResponse | null>(null);
  const [open, setOpen] = useState<OpenResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [closedRes, openRes, summaryRes] = await Promise.all([
        fetch("/api/trade-history/closed?days=30&limit=50&offset=0", { cache: "no-store" }),
        fetch("/api/trade-history/open", { cache: "no-store" }),
        fetch("/api/trade-history/summary?days=30", { cache: "no-store" }),
      ]);
      const [closedBody, openBody, summaryBody]: [ClosedResponse, OpenResponse, SummaryResponse] =
        await Promise.all([closedRes.json(), openRes.json(), summaryRes.json()]);

      if (!closedBody.ok || !openBody.ok || !summaryBody.ok) {
        setError(closedBody.error ?? openBody.error ?? summaryBody.error ?? "تعذّر تحميل سجل الصفقات");
      }
      setClosed(closedBody);
      setOpen(openBody);
      setSummary(summaryBody);
    } catch {
      setError("تعذّر الاتصال بخدمة MT5 المحلية");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/trade-history/sync-now", { method: "POST", cache: "no-store" });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error ?? "تعذّر تنفيذ المزامنة");
        return;
      }
      await loadData();
    } catch {
      setError("تعذّر الاتصال بخدمة MT5 المحلية");
    } finally {
      setSyncing(false);
    }
  }, [loadData]);

  const closedTrades = closed?.trades ?? [];
  const openPositions = open?.positions ?? [];

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/25">
            <History className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">سجل الصفقات وربطها بإشارات النظام</h1>
            <p className="text-xs text-muted-foreground">
              الصفقات المغلقة والمفتوحة من MT5، مع ربط تلقائي بإشارات الجدار الثلاثي لقياس دقة التوصيات
            </p>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-300">
          ⚠️ هذه البيانات لأغراض التحليل والتعلم من النتائج فقط، وليست توصية مالية أو أمر تداول.
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950 p-2 text-xs text-red-400">
            ⚠️ {error}
          </div>
        )}

        {/* Summary cards */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-5 text-center">
            <p className="text-2xl font-bold text-slate-200">{summary?.totalTrades ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">إجمالي الصفقات المغلقة (30 يوم)</p>
          </div>
          <div className="rounded-xl border border-green-800 bg-green-950/30 px-4 py-5 text-center">
            <p className="text-2xl font-bold text-green-400">{summary?.matchedTrades ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">
              مرتبطة بإشارة — نسبة الربح {summary?.matchedWinRatePct ?? "—"}%
            </p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-5 text-center">
            <p className="text-2xl font-bold text-slate-200">{summary?.unmatchedTrades ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">
              غير مرتبطة (يدوية) — نسبة الربح {summary?.unmatchedWinRatePct ?? "—"}%
            </p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-5 text-center">
            <p className={`text-2xl font-bold ${profitClass(summary?.netProfit ?? 0)}`}>
              {summary?.netProfit ?? 0}
            </p>
            <p className="mt-1 text-xs text-slate-400">صافي الربح/الخسارة</p>
          </div>
        </div>

        {/* Open positions */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-2">
            <p className="text-xs uppercase tracking-widest text-slate-500">الصفقات المفتوحة</p>
            <div className="flex gap-2">
              <button
                onClick={syncNow}
                disabled={syncing}
                className="flex items-center gap-1 rounded border border-amber-700 px-3 py-1 text-xs text-amber-300 hover:bg-amber-950 disabled:opacity-50"
              >
                <RefreshCw className="h-3 w-3" />
                {syncing ? "جاري المزامنة..." : "مزامنة الآن"}
              </button>
              <button
                onClick={loadData}
                disabled={loading}
                className="flex items-center gap-1 rounded border border-slate-600 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                <RefreshCw className="h-3 w-3" />
                {loading ? "جاري التحديث..." : "تحديث"}
              </button>
            </div>
          </div>

          {openPositions.length === 0 && !loading && (
            <p className="text-center text-sm text-slate-500 py-6">لا توجد صفقات مفتوحة حالياً</p>
          )}

          {openPositions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-500">
                    <th className="p-2 text-right">الرمز</th>
                    <th className="p-2 text-right">الاتجاه</th>
                    <th className="p-2 text-right">الحجم</th>
                    <th className="p-2 text-right">سعر الفتح</th>
                    <th className="p-2 text-right">السعر الحالي</th>
                    <th className="p-2 text-right">الربح العائم</th>
                    <th className="p-2 text-right">إشارة النظام</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map((p) => (
                    <tr key={p.ticket} className="border-b border-slate-800">
                      <td className="p-2 font-bold text-slate-200">{p.symbol}</td>
                      <td className="p-2">
                        <span className="flex items-center gap-1 text-slate-300">
                          {p.direction === "BUY" ? (
                            <TrendingUp className="h-3 w-3 text-green-400" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-red-400" />
                          )}
                          {directionLabel(p.direction)}
                        </span>
                      </td>
                      <td className="p-2 text-slate-400">{p.volume}</td>
                      <td className="p-2 text-slate-400">{p.openPrice}</td>
                      <td className="p-2 text-slate-400">{p.currentPrice}</td>
                      <td className={`p-2 font-bold ${profitClass(p.profit)}`}>{p.profit}</td>
                      <td className="p-2">{signalBadge(p.matchedSignal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Closed trades */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-2">
            <p className="text-xs uppercase tracking-widest text-slate-500">الصفقات المغلقة (آخر 30 يوم)</p>
          </div>

          {closedTrades.length === 0 && !loading && (
            <p className="text-center text-sm text-slate-500 py-6">لا توجد صفقات مغلقة ضمن آخر 30 يوم</p>
          )}

          {closedTrades.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-500">
                    <th className="p-2 text-right">الرمز</th>
                    <th className="p-2 text-right">الاتجاه</th>
                    <th className="p-2 text-right">الحجم</th>
                    <th className="p-2 text-right">وقت الفتح</th>
                    <th className="p-2 text-right">وقت الإغلاق</th>
                    <th className="p-2 text-right">الربح/الخسارة</th>
                    <th className="p-2 text-right">إشارة النظام</th>
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.map((t) => (
                    <tr key={t.positionId} className="border-b border-slate-800">
                      <td className="p-2 font-bold text-slate-200">{t.symbol}</td>
                      <td className="p-2">
                        <span className="flex items-center gap-1 text-slate-300">
                          {t.direction === "BUY" ? (
                            <TrendingUp className="h-3 w-3 text-green-400" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-red-400" />
                          )}
                          {directionLabel(t.direction)}
                        </span>
                      </td>
                      <td className="p-2 text-slate-400">{t.volume}</td>
                      <td className="p-2 text-slate-400">{formatDate(t.openTime)}</td>
                      <td className="p-2 text-slate-400">{formatDate(t.closeTime)}</td>
                      <td className={`p-2 font-bold ${profitClass(t.profit)}`}>{t.profit}</td>
                      <td className="p-2">{signalBadge(t.matchedSignal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-600">
          ⚠️ نظام تحليل معلوماتي مؤسسي — لا يمثل توصية مالية ولا يقوم بتنفيذ أي صفقات
        </p>
      </div>
    </div>
  );
}
