// src/components/gold-pro/TradeSetupsPanel.tsx
// لوحة الصفقات المتعددة — H4 Swing + H1 Intraday + M15 Scalp
import type { TradeSetup } from "@/lib/gold-pro/types";

function SetupCard({ setup }: { setup: TradeSetup }) {
  const isBuy = setup.signal === "BUY";
  const border = isBuy ? "border-green-800" : "border-red-900";
  const sigBg  = isBuy ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400";
  const sigBorder = isBuy ? "border-green-700" : "border-red-800";
  const tpColor = isBuy ? "text-green-400" : "text-green-400";
  const slColor = "text-red-400";

  const confidenceColor =
    setup.confidence >= 70 ? "text-green-400" :
    setup.confidence >= 50 ? "text-yellow-400" : "text-orange-400";

  return (
    <div className={`rounded-xl border ${border} bg-slate-900 p-4`}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{setup.emoji}</span>
          <div>
            <p className="text-sm font-bold text-slate-200">{setup.label}</p>
            <p className="text-xs text-slate-500">ATR: ${setup.atr.toFixed(2)}</p>
          </div>
        </div>
        <div className="text-right">
          <span className={`rounded-full border px-3 py-1 text-sm font-bold ${sigBg} ${sigBorder}`}>
            {isBuy ? "▲ BUY" : "▼ SELL"}
          </span>
          <p className={`mt-0.5 text-xs ${confidenceColor}`}>ثقة {setup.confidence}%</p>
        </div>
      </div>

      {/* Price Levels Grid */}
      <div className="mb-3 grid grid-cols-4 gap-1 text-center text-xs">
        <div className="rounded bg-slate-800 p-1.5">
          <p className="text-slate-500">دخول</p>
          <p className="font-mono font-bold text-amber-400">{setup.entryPrice.toFixed(2)}</p>
        </div>
        <div className="rounded bg-slate-800 p-1.5">
          <p className={slColor}>SL</p>
          <p className={`font-mono font-bold ${slColor}`}>{setup.stopLoss.toFixed(2)}</p>
          <p className="text-slate-600">-{setup.slDistance.toFixed(1)}</p>
        </div>
        <div className="rounded bg-slate-800 p-1.5">
          <p className={tpColor}>TP 1</p>
          <p className={`font-mono font-bold ${tpColor}`}>{setup.takeProfit1.toFixed(2)}</p>
          <p className="text-slate-600">+{setup.tp1Distance.toFixed(1)}</p>
        </div>
        <div className="rounded bg-slate-800 p-1.5">
          <p className={tpColor}>TP 2</p>
          <p className={`font-mono font-bold ${tpColor}`}>{setup.takeProfit2.toFixed(2)}</p>
          <p className="text-slate-600">+{setup.tp2Distance.toFixed(1)}</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="text-slate-400">
          R/R: <span className={setup.rrRatio1 >= 1.5 ? "font-bold text-green-400" : "text-yellow-400"}>
            1:{setup.rrRatio1.toFixed(1)} / 1:{setup.rrRatio2.toFixed(1)}
          </span>
        </span>
        <span className="text-slate-400">
          Lot: <span className="font-bold text-blue-400">{setup.lotSize.toFixed(2)}</span>
        </span>
        <span className="text-slate-400">
          خسارة: <span className="text-red-400">-${setup.riskUsd.toFixed(2)}</span>
        </span>
        <span className="text-slate-400">
          ربح TP1: <span className="text-green-400">+${setup.potentialProfitUsd.toFixed(2)}</span>
        </span>
      </div>

      {/* Reasons */}
      <div className="border-t border-slate-800 pt-2">
        <div className="flex flex-wrap gap-1">
          {setup.reasons.map((r, i) => (
            <span key={i} className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{r}</span>
          ))}
        </div>
      </div>

      {setup.sessionWarning && (
        <p className="mt-2 text-xs text-yellow-500">⚠️ {setup.sessionWarning}</p>
      )}
    </div>
  );
}

interface TradeSetupsPanelProps {
  setups: TradeSetup[];
  candleCount: { H1: number; H4: number; D1: number; M15: number };
}

export function TradeSetupsPanel({ setups, candleCount }: TradeSetupsPanelProps) {
  const total = candleCount.H1 + candleCount.H4 + candleCount.M15;

  return (
    <div className="rounded-xl border border-amber-900 bg-slate-900 p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between border-b border-slate-700 pb-3">
        <div>
          <p className="text-sm font-bold text-amber-400">🎯 الصفقات المقترحة</p>
          <p className="text-xs text-slate-500">
            تحليل متعدد الإطارات — للأغراض المعلوماتية فقط
          </p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>H1: {candleCount.H1} شمعة · H4: {candleCount.H4} · M15: {candleCount.M15}</p>
          {total < 50 && (
            <p className="text-yellow-500">⚠ بيانات جزئية — ATR تقديري</p>
          )}
        </div>
      </div>

      {/* Setup Cards */}
      {setups.length === 0 ? (
        <div className="rounded-lg bg-slate-800 p-6 text-center">
          <p className="text-2xl">🔍</p>
          <p className="mt-2 text-sm text-slate-400">لا توجد إشارات كافية حالياً</p>
          <p className="mt-1 text-xs text-slate-600">
            السوق في حالة تذبذب — انتظر تأكيداً أوضح
          </p>
        </div>
      ) : (
        <div className={`grid gap-4 ${setups.length === 1 ? "grid-cols-1" : setups.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {setups.map(setup => (
            <SetupCard key={setup.id} setup={setup} />
          ))}
        </div>
      )}

      {setups.length > 0 && (
        <p className="mt-3 text-center text-xs text-slate-600">
          ⚠️ تحليل معلوماتي — ليس توصية مالية — نظام الملك الهندسي
        </p>
      )}
    </div>
  );
}
