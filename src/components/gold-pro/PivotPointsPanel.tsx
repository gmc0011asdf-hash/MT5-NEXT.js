// src/components/gold-pro/PivotPointsPanel.tsx
import type { PivotPoints } from "@/lib/gold-pro/types";

export function PivotPointsPanel({ pivots, currentPrice }: { pivots: PivotPoints; currentPrice: number }) {
  const items = [
    { label: "R2", value: pivots.r2, color: "text-red-400" },
    { label: "R1", value: pivots.r1, color: "text-red-300" },
    { label: "PP", value: pivots.pp, color: "text-amber-400" },
    { label: "S1", value: pivots.s1, color: "text-green-300" },
    { label: "S2", value: pivots.s2, color: "text-green-400" },
  ];
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <p className="mb-2 text-xs uppercase tracking-widest text-slate-500">📌 Pivot Points يومية</p>
      <div className="grid grid-cols-5 gap-1">
        {items.map(({ label, value, color }) => (
          <div
            key={label}
            className={`rounded-lg bg-slate-800 p-2 text-center ${Math.abs(value - currentPrice) < 5 ? "ring-1 ring-amber-500" : ""}`}
          >
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-xs font-bold ${color}`}>{value.toFixed(0)}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">السعر الحالي: {currentPrice.toFixed(2)}</p>
    </div>
  );
}
