// src/components/gold-pro/ScreenerWatchlistPanel.tsx
"use client";

import { useState, useCallback, useEffect } from "react";

interface RankedCandidate {
  symbol: string;
  source: "mt5" | "okx" | string;
  approved: boolean;
  direction: string | null;
  signal_strength: number;
  confluence_level: string | null;
  reason: string;
  last_scan_ts: string | null;
}

interface MTFResultRow {
  timeframe: string;
  approved: boolean;
  direction: string | null;
  signal_strength: number | null;
  entry: number | null;
  sl: number | null;
  tp: number | null;
  lot_size: number | null;
  risk_amount: number | null;
  risk_percent: number | null;
  profit_amount: number | null;
  duration: string | null;
  digits: number | null;
  confluence: string | null;
}

const MAX_WATCHLIST = 5;

function directionBadge(direction: string | null) {
  if (direction === "BUY") return <span className="rounded border border-green-700 bg-green-950 px-2 py-0.5 text-green-400">شراء</span>;
  if (direction === "SELL") return <span className="rounded border border-red-800 bg-red-950 px-2 py-0.5 text-red-400">بيع</span>;
  return <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-slate-400">—</span>;
}

function fmtNum(value: number | null, digits: number | null): string {
  if (value === null || value === undefined) return "—";
  const d = digits ?? 2;
  return value.toFixed(d);
}

export function ScreenerWatchlistPanel({ 
  source,
  onWatchlistChange 
}: { 
  source?: "mt5" | "okx";
  onWatchlistChange?: (symbols: string[]) => void;
} = {}) {
  const [candidates, setCandidates] = useState<RankedCandidate[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mtfResults, setMtfResults] = useState<Record<string, MTFResultRow[]>>({});
  const [mtfLoading, setMtfLoading] = useState<Record<string, boolean>>({});
  const [mtfError, setMtfError] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const candUrl = source ? `/api/lab/ranked-candidates?source=${source}` : "/api/lab/ranked-candidates";
      const wlUrl = source ? `/api/lab/watchlist?source=${source}` : "/api/lab/watchlist";
      const [candRes, wlRes] = await Promise.all([
        fetch(candUrl, { cache: "no-store" }),
        fetch(wlUrl, { cache: "no-store" }),
      ]);
      const candBody = await candRes.json();
      const wlBody = await wlRes.json();

      if (candBody.ok) {
        setCandidates(candBody.candidates ?? []);
      } else {
        setError(candBody.error ?? "تعذر تحميل قائمة الترشيح");
      }

      if (wlBody.ok) {
        const symbols: string[] = wlBody.symbols ?? [];
        setWatchlist(symbols);
        setSelected(symbols);
      }
    } catch {
      setError("تعذر الاتصال بخدمة MT5 المحلية");
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleSelected = (symbol: string) => {
    setSelected((prev) => {
      if (prev.includes(symbol)) return prev.filter((s) => s !== symbol);
      if (prev.length >= MAX_WATCHLIST) return prev;
      return [...prev, symbol];
    });
  };

  const confirmWatchlist = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const wlUrl = source ? `/api/lab/watchlist?source=${source}` : "/api/lab/watchlist";
      const res = await fetch(wlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: selected }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error ?? "تعذر حفظ قائمة المتابعة");
        return;
      }
      setWatchlist(body.symbols ?? selected);
      if (onWatchlistChange) {
        onWatchlistChange(body.symbols ?? selected);
      }
    } catch {
      setError("تعذر الاتصال بخدمة MT5 المحلية");
    } finally {
      setSaving(false);
    }
  }, [selected]);

  const runMultiTimeframe = useCallback(async (symbol: string) => {
    setMtfLoading((prev) => ({ ...prev, [symbol]: true }));
    setMtfError((prev) => ({ ...prev, [symbol]: "" }));
    try {
      const res = await fetch("/api/lab/multi-timeframe-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const body = await res.json();
      if (!body.ok) {
        setMtfError((prev) => ({ ...prev, [symbol]: body.error ?? "تعذر تنفيذ التحليل" }));
        return;
      }
      setMtfResults((prev) => ({ ...prev, [symbol]: body.results ?? [] }));
    } catch {
      setMtfError((prev) => ({ ...prev, [symbol]: "تعذر الاتصال بخدمة MT5 المحلية" }));
    } finally {
      setMtfLoading((prev) => ({ ...prev, [symbol]: false }));
    }
  }, []);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-2">
        <p className="text-xs uppercase tracking-widest text-slate-500">🔎 شاشة الترشيح + قائمة المتابعة</p>
        <button
          onClick={loadData}
          disabled={loading}
          className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "⏳ جاري التحديث..." : "🔄 تحديث"}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-800 bg-red-950 p-2 text-xs text-red-400">
          ⚠️ {error}
        </div>
      )}

      {candidates.length === 0 && !loading && (
        <p className="text-center text-sm text-slate-500">لا توجد بيانات ترشيح بعد — بانتظار أول دورة فحص</p>
      )}

      {candidates.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-slate-500">
                  <th className="p-2 text-right">اختيار</th>
                  <th className="p-2 text-right">الرمز</th>
                  <th className="p-2 text-right">المصدر</th>
                  <th className="p-2 text-right">الاتجاه</th>
                  <th className="p-2 text-right">قوة الإشارة</th>
                  <th className="p-2 text-right">التوافق</th>
                  <th className="p-2 text-right">السبب</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const checked = selected.includes(c.symbol);
                  const disabled = !checked && selected.length >= MAX_WATCHLIST;
                  return (
                    <tr key={`${c.source}-${c.symbol}`} className="border-b border-slate-800">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleSelected(c.symbol)}
                        />
                      </td>
                      <td className="p-2 font-bold text-slate-200">{c.symbol}</td>
                      <td className="p-2 text-slate-400">{c.source === "mt5" ? "MT5" : "OKX"}</td>
                      <td className="p-2">{directionBadge(c.direction)}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded bg-slate-800">
                            <div
                              className="h-full bg-amber-500"
                              style={{ width: `${Math.min(100, Math.max(0, c.signal_strength * 100))}%` }}
                            />
                          </div>
                          <span className="text-slate-400">{(c.signal_strength * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="p-2 text-slate-400">{c.confluence_level ?? "—"}</td>
                      <td className="p-2 text-slate-400">{c.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              المحدد: {selected.length} / {MAX_WATCHLIST}
            </p>
            <button
              onClick={confirmWatchlist}
              disabled={saving}
              className="rounded-lg bg-amber-500 px-6 py-2 text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {saving ? "💾..." : `✅ تأكيد القائمة (حتى ${MAX_WATCHLIST})`}
            </button>
          </div>
        </>
      )}

      {watchlist.length > 0 && (
        <div className="mt-5 border-t border-slate-700 pt-3">
          <p className="mb-2 text-xs uppercase tracking-widest text-slate-500">📋 قائمة المتابعة الحالية</p>
          <div className="flex flex-col gap-3">
            {watchlist.map((symbol) => (
              <div key={symbol} className="rounded-lg border border-slate-700 bg-slate-800 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-200">{symbol}</span>
                  <button
                    onClick={() => runMultiTimeframe(symbol)}
                    disabled={mtfLoading[symbol]}
                    className="rounded border border-indigo-500 px-3 py-1 text-xs text-indigo-400 hover:bg-indigo-950 disabled:opacity-50"
                  >
                    {mtfLoading[symbol] ? "⏳ جاري التحليل..." : "📈 تحليل متعدد الفريمات"}
                  </button>
                </div>

                {mtfError[symbol] && (
                  <p className="mt-2 text-xs text-red-400">⚠️ {mtfError[symbol]}</p>
                )}

                {mtfResults[symbol] && mtfResults[symbol].length > 0 && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[640px] text-xs">
                      <thead>
                        <tr className="border-b border-slate-700 text-slate-500">
                          <th className="p-1.5 text-right">الفريم</th>
                          <th className="p-1.5 text-right">معتمد</th>
                          <th className="p-1.5 text-right">الاتجاه</th>
                          <th className="p-1.5 text-right">القوة</th>
                          <th className="p-1.5 text-right">الدخول</th>
                          <th className="p-1.5 text-right">SL</th>
                          <th className="p-1.5 text-right">TP</th>
                          <th className="p-1.5 text-right">اللوت</th>
                          <th className="p-1.5 text-right">المخاطرة%</th>
                          <th className="p-1.5 text-right">الربح المتوقع</th>
                          <th className="p-1.5 text-right">المدة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mtfResults[symbol].map((r) => (
                          <tr key={r.timeframe} className="border-b border-slate-800">
                            <td className="p-1.5 font-bold text-slate-300">{r.timeframe}</td>
                            <td className="p-1.5">
                              {r.approved ? (
                                <span className="rounded border border-green-700 bg-green-950 px-1.5 py-0.5 text-green-400">معتمد</span>
                              ) : (
                                <span className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-slate-500">—</span>
                              )}
                            </td>
                            <td className="p-1.5">{directionBadge(r.direction)}</td>
                            <td className="p-1.5 text-slate-400">
                              {r.signal_strength !== null ? `${(r.signal_strength * 100).toFixed(0)}%` : "—"}
                            </td>
                            <td className="p-1.5 text-slate-400">{fmtNum(r.entry, r.digits)}</td>
                            <td className="p-1.5 text-slate-400">{fmtNum(r.sl, r.digits)}</td>
                            <td className="p-1.5 text-slate-400">{fmtNum(r.tp, r.digits)}</td>
                            <td className="p-1.5 text-slate-400">{r.lot_size ?? "—"}</td>
                            <td className="p-1.5 text-slate-400">
                              {r.risk_percent !== null ? `${r.risk_percent.toFixed(2)}%` : "—"}
                            </td>
                            <td className="p-1.5 text-slate-400">
                              {r.profit_amount !== null ? r.profit_amount.toFixed(2) : "—"}
                            </td>
                            <td className="p-1.5 text-slate-400">{r.duration ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-center text-xs text-slate-600">
        ⚠️ ترتيب وترشيح للأغراض التحليلية المعلوماتية فقط — ليس توصية مالية
      </p>
    </div>
  );
}
