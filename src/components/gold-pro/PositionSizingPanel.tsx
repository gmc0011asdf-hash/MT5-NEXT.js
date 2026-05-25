// src/components/gold-pro/PositionSizingPanel.tsx
import type { GoldProAnalysis } from "@/lib/gold-pro/types";

export function PositionSizingPanel({ analysis }: { analysis: GoldProAnalysis }) {
  const { positioning, indicators } = analysis;
  return (
    <div className="rounded-xl border border-blue-900 bg-slate-900 p-4">
      <p className="mb-3 border-b border-slate-700 pb-2 text-xs uppercase tracking-widest text-slate-500">⚖️ إدارة المخاطر — Position Sizing</p>
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div className="space-y-2">
          <div className="flex justify-between"><span className="text-slate-400">الرصيد</span><span className="text-blue-400">${positioning.balance.toLocaleString()}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">المخاطرة (2%)</span><span className="text-amber-400">${positioning.riskAmountUsd.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">ATR (14)</span><span className="text-blue-400">${indicators.atr.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">SL المسافة</span><span className="text-red-400">{analysis.sltp.slDistance.toFixed(2)} pts</span></div>
        </div>
        <div className="flex flex-col items-center justify-center border-r border-slate-700 pr-4">
          <p className="text-xs text-slate-400">حجم الصفقة</p>
          <p className="text-4xl font-bold text-blue-400">{positioning.lotSize.toFixed(2)}</p>
          <p className="text-xs text-slate-500">Lot</p>
        </div>
      </div>
      <div className="mt-3 space-y-1 border-t border-slate-700 pt-3 text-xs">
        <div className="flex justify-between"><span className="text-slate-400">خسارة محتملة</span><span className="text-red-400">-${positioning.potentialLossUsd.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">ربح محتمل (TP1)</span><span className="text-green-400">+${positioning.potentialProfitUsd.toFixed(2)}</span></div>
      </div>
    </div>
  );
}
