// src/components/gold-pro/SignalCard.tsx
import type { GoldProAnalysis } from "@/lib/gold-pro/types";

export function SignalCard({ analysis }: { analysis: GoldProAnalysis }) {
  const { confluence, sltp } = analysis;
  const isBuy = confluence.signal === "BUY";
  const isSell = confluence.signal === "SELL";
  const signalColor = isBuy ? "border-green-700 bg-green-950 text-green-400" :
                      isSell ? "border-red-800 bg-red-950 text-red-400" :
                               "border-yellow-800 bg-yellow-950 text-yellow-400";
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-widest text-slate-500">التوصية النهائية</p>
      <div className={`mt-2 rounded-lg border p-3 text-center ${signalColor}`}>
        <p className="text-2xl font-bold">{isBuy ? "● BUY" : isSell ? "● SELL" : "◆ WAIT"}</p>
        <p className="text-xs text-slate-400">ثقة {confluence.score}%</p>
      </div>
      <div className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between"><span className="text-slate-400">دخول</span><span className="font-mono text-amber-400">{sltp.entryPrice.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-red-400">Stop Loss</span><span className="font-mono text-red-400">{sltp.stopLoss.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-green-400">TP 1</span><span className="font-mono text-green-400">{sltp.takeProfit1.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-green-400">TP 2</span><span className="font-mono text-green-400">{sltp.takeProfit2.toFixed(2)}</span></div>
        <div className="flex justify-between border-t border-slate-700 pt-1.5">
          <span className="text-slate-400">R/R Ratio</span>
          <span className={`font-bold ${sltp.rrRatio1 >= 1.5 ? "text-green-400" : "text-yellow-400"}`}>1 : {sltp.rrRatio1.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
