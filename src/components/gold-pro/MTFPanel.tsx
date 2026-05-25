// src/components/gold-pro/MTFPanel.tsx
import type { MTFResult, ADXResult } from "@/lib/gold-pro/types";

export function MTFPanel({ mtf, adx }: { mtf: MTFResult; adx: ADXResult }) {
  const tfs = [
    { label: "M15", data: mtf.m15 },
    { label: "H1",  data: mtf.h1 },
    { label: "H4",  data: mtf.h4 },
    { label: "D1",  data: mtf.d1 },
  ];
  return (
    <div className="rounded-xl border border-purple-900 bg-slate-900 p-4">
      <p className="mb-3 border-b border-slate-700 pb-2 text-xs uppercase tracking-widest text-slate-500">📊 تحليل متعدد الإطارات (MTF)</p>
      <div className="grid grid-cols-4 gap-2">
        {tfs.map(({ label, data }) => (
          <div key={label} className="rounded-lg bg-slate-800 p-2 text-center">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-sm font-bold ${data.bias === "bullish" ? "text-green-400" : data.bias === "bearish" ? "text-red-400" : "text-yellow-400"}`}>
              {data.bias === "bullish" ? "▲ صاعد" : data.bias === "bearish" ? "▼ هابط" : "◆ محايد"}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">RSI:{data.rsi.toFixed(0)}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-400">توافق الإطارات</span>
          <span className={`font-bold ${mtf.bullishCount >= 3 ? "text-green-400" : "text-yellow-400"}`}>{mtf.bullishCount}/4 صاعد</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">ADX قوة الاتجاه</span>
          <span className={`font-bold ${adx.strength === "strong" ? "text-green-400" : adx.strength === "moderate" ? "text-yellow-400" : "text-slate-400"}`}>
            {adx.adx.toFixed(1)} — {adx.strength === "strong" ? "قوي" : adx.strength === "moderate" ? "متوسط" : "ضعيف"}
          </span>
        </div>
      </div>
    </div>
  );
}
