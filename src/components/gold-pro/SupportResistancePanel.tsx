// src/components/gold-pro/SupportResistancePanel.tsx
import type { GoldProAnalysis } from "@/lib/gold-pro/types";

export function SupportResistancePanel({ analysis }: { analysis: GoldProAnalysis }) {
  const { indicators, price } = analysis;
  const { supportResistance: sr, fibonacci: fib } = indicators;
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <p className="mb-2 text-xs uppercase tracking-widest text-slate-500">🎯 دعم · مقاومة · فيبوناتشي</p>
      <div className="space-y-1 text-xs">
        {sr.resistances.slice(0, 2).map((r, i) => (
          <div key={i} className="flex justify-between border-b border-slate-800 py-1">
            <span className="text-red-400">مقاومة {i + 1}</span>
            <span className="font-mono text-red-400">{r.toFixed(2)}</span>
          </div>
        ))}
        <div className="flex justify-between border-b border-slate-700 bg-slate-800 px-1 py-1.5">
          <span className="text-amber-400">● السعر الحالي</span>
          <span className="font-mono font-bold text-amber-400">{price.toFixed(2)}</span>
        </div>
        {sr.supports.slice(0, 2).map((s, i) => (
          <div key={i} className="flex justify-between border-b border-slate-800 py-1">
            <span className="text-green-400">دعم {i + 1}</span>
            <span className="font-mono text-green-400">{s.toFixed(2)}</span>
          </div>
        ))}
        <div className="mt-2 border-t border-slate-700 pt-2">
          <p className="mb-1 text-slate-500">فيبوناتشي H4</p>
          <div className="flex justify-between py-0.5"><span className="text-slate-400">38.2%</span><span className="font-mono text-blue-400">{fib.level382.toFixed(2)}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-slate-400">61.8%</span><span className="font-mono text-blue-400">{fib.level618.toFixed(2)}</span></div>
        </div>
      </div>
    </div>
  );
}
