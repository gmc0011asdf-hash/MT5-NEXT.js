// src/components/gold-pro/PriceHeader.tsx
import type { GoldProAnalysis } from "@/lib/gold-pro/types";

export function PriceHeader({ analysis }: { analysis: GoldProAnalysis }) {
  return (
    <div className="rounded-xl border border-yellow-900 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-widest text-slate-500">السعر الحي · XAUUSD</p>
      <p className="mt-1 text-3xl font-bold text-amber-400">{analysis.ask.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-green-700 bg-green-950 px-2 py-0.5 text-green-400">
          BID: {analysis.bid.toFixed(2)}
        </span>
        <span className="text-slate-500">Spread: {analysis.spread} pts</span>
      </div>
      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-400">Session</span>
          <span className={`font-medium ${analysis.sessionLabel === "Asian" ? "text-yellow-400" : "text-green-400"}`}>
            {analysis.sessionLabel}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">جودة البيانات</span>
          <span className={analysis.dataQuality === "good" ? "text-green-400" : "text-yellow-400"}>
            {analysis.dataQuality === "good" ? "✓ جيدة" : "⚠ جزئية"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">السوق</span>
          <span className={analysis.marketClosed ? "text-red-400" : "text-green-400"}>
            {analysis.marketClosed ? "مغلق" : "مفتوح"}
          </span>
        </div>
      </div>
    </div>
  );
}
