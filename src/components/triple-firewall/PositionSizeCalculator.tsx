// src/components/triple-firewall/PositionSizeCalculator.tsx
// حاسبة حجم اللوت بنموذج المخاطرة كنسبة من رأس المال (Risk % of Equity)
// لا تنفيذ تداول — أداة معلوماتية فقط
"use client";

import { useState } from "react";
import type { PositionSizeResult } from "@/lib/triple-firewall/types";

// قيم افتراضية لـ XAUUSD (متوافقة مع src/lib/gold-pro/position-sizing.ts):
// point = 1.0 (تحرك سعري كامل) | tick_size = 0.01 | tick_value = 0.1 لكل 0.01 لوت
const DEFAULTS = {
  accountEquity: 3000,
  riskPercent: 1,
  entryPrice: 2000,
  stopLoss: 1990,
  tradeTickValue: 0.1,
  tradeTickSize: 0.01,
  point: 1.0,
  volumeMin: 0.01,
  volumeMax: 10,
  volumeStep: 0.01,
};

export function PositionSizeCalculator() {
  const [form, setForm] = useState(DEFAULTS);
  const [result, setResult] = useState<PositionSizeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (key: keyof typeof DEFAULTS) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setForm((f) => ({ ...f, [key]: Number.isFinite(v) ? v : 0 }));
  };

  const calculate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/lab/triple-firewall/position-size", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "فشل الحساب");
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ غير معروف");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-blue-900 bg-slate-900 p-4">
      <p className="mb-3 border-b border-slate-700 pb-2 text-xs uppercase tracking-widest text-slate-500">
        ⚖️ حاسبة حجم الصفقة — مخاطرة % من رأس المال
      </p>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">رأس المال (equity)</span>
          <input type="number" value={form.accountEquity} onChange={update("accountEquity")}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">نسبة المخاطرة %</span>
          <input type="number" step="0.1" value={form.riskPercent} onChange={update("riskPercent")}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">سعر الدخول</span>
          <input type="number" step="0.01" value={form.entryPrice} onChange={update("entryPrice")}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">وقف الخسارة</span>
          <input type="number" step="0.01" value={form.stopLoss} onChange={update("stopLoss")}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200" />
        </label>
      </div>

      <details className="mt-3 text-xs text-slate-500">
        <summary className="cursor-pointer select-none">⚙️ إعدادات متقدمة (خصائص الرمز)</summary>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            <span>tick value</span>
            <input type="number" step="0.01" value={form.tradeTickValue} onChange={update("tradeTickValue")}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200" />
          </label>
          <label className="flex flex-col gap-1">
            <span>tick size</span>
            <input type="number" step="0.01" value={form.tradeTickSize} onChange={update("tradeTickSize")}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200" />
          </label>
          <label className="flex flex-col gap-1">
            <span>point</span>
            <input type="number" step="0.01" value={form.point} onChange={update("point")}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200" />
          </label>
        </div>
      </details>

      <button
        onClick={calculate}
        disabled={loading}
        className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {loading ? "⏳ جاري الحساب..." : "احسب حجم اللوت"}
      </button>

      {error && (
        <p className="mt-3 rounded-lg border border-red-800 bg-red-950 p-2 text-xs text-red-400">⚠️ {error}</p>
      )}

      {result && (
        <div className="mt-3 space-y-2 border-t border-slate-700 pt-3 text-xs">
          <div className="flex flex-col items-center justify-center py-2">
            <p className="text-slate-400">حجم اللوت المقترح</p>
            <p className="text-3xl font-bold text-blue-400">{result.normalized_lot.toFixed(2)}</p>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">المخاطرة بالدولار</span>
            <span className="text-amber-400">${result.risk_usd.toFixed(2)}</span>
          </div>
          {result.sl_dist_points != null && (
            <div className="flex justify-between">
              <span className="text-slate-400">مسافة وقف الخسارة (نقاط)</span>
              <span className="text-slate-300">{result.sl_dist_points.toFixed(2)}</span>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-900 bg-amber-950/40 p-2">
              {result.warnings.map((w, i) => (
                <p key={i} className="text-amber-400">⚠️ {w}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-center text-[10px] text-slate-600">
        أداة معلوماتية فقط — ليست توصية مالية ولا تنفذ أي صفقة
      </p>
    </div>
  );
}
