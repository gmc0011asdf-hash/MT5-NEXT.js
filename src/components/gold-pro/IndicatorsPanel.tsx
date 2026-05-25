// src/components/gold-pro/IndicatorsPanel.tsx
import type { GoldProAnalysis } from "@/lib/gold-pro/types";

export function IndicatorsPanel({ analysis }: { analysis: GoldProAnalysis }) {
  const { indicators, price } = analysis;
  const row = (label: string, value: string, badge: string, badgeColor: string) => (
    <div className="flex items-center justify-between border-b border-slate-800 py-1.5 text-xs last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono text-slate-300">{value}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${badgeColor}`}>{badge}</span>
    </div>
  );
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <p className="mb-2 text-xs uppercase tracking-widest text-slate-500">📈 المؤشرات</p>
      {row("EMA 21", indicators.ema21.toFixed(2), price > indicators.ema21 ? "فوق ↗" : "تحت ↘", price > indicators.ema21 ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400")}
      {row("EMA 50", indicators.ema50.toFixed(2), price > indicators.ema50 ? "فوق ↗" : "تحت ↘", price > indicators.ema50 ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400")}
      {row("EMA 200", indicators.ema200.toFixed(2), price > indicators.ema200 ? "فوق ↗" : "تحت ↘", price > indicators.ema200 ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400")}
      {row("MACD", indicators.macd.value.toFixed(2), indicators.macd.histogram > 0 ? "↗ صاعد" : "↘ هابط", indicators.macd.histogram > 0 ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400")}
      {row("RSI (14)", indicators.rsi.toFixed(1), indicators.rsi > 70 ? "تشبع شراء" : indicators.rsi < 30 ? "تشبع بيع" : "طبيعي", indicators.rsi > 70 ? "bg-yellow-950 text-yellow-400" : indicators.rsi < 30 ? "bg-red-950 text-red-400" : "bg-green-950 text-green-400")}
      {row("Stoch RSI K", indicators.stochRsi.k.toFixed(1), indicators.stochRsi.zone === "overbought" ? "تشبع ↑" : indicators.stochRsi.zone === "oversold" ? "تشبع ↓" : "طبيعي", indicators.stochRsi.zone === "overbought" ? "bg-yellow-950 text-yellow-400" : indicators.stochRsi.zone === "oversold" ? "bg-blue-950 text-blue-400" : "bg-green-950 text-green-400")}
      {row("ATR (14)", `$${indicators.atr.toFixed(2)}`, "تقلب", "bg-slate-800 text-slate-400")}
      {row("BB Position", indicators.bollingerBands.middle.toFixed(2), indicators.bollingerBands.position === "above" ? "فوق" : indicators.bollingerBands.position === "below" ? "تحت" : "وسط", "bg-slate-800 text-slate-400")}
    </div>
  );
}
