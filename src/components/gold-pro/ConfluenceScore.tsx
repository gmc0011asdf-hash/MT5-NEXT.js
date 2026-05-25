// src/components/gold-pro/ConfluenceScore.tsx
import type { ConfluenceResult } from "@/lib/gold-pro/types";

export function ConfluenceScoreCard({ confluence }: { confluence: ConfluenceResult }) {
  const color = confluence.score >= 70 ? "text-green-400 border-green-700" :
                confluence.score <= 30 ? "text-red-400 border-red-800" : "text-yellow-400 border-yellow-800";
  const bgColor = confluence.score >= 70 ? "bg-green-950" :
                  confluence.score <= 30 ? "bg-red-950" : "bg-yellow-950";
  const label = confluence.score >= 70 ? "BUY قوي" :
                confluence.score <= 30 ? "SELL قوي" : "انتظر";
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-center">
      <p className="text-xs uppercase tracking-widest text-slate-500">Confluence Score</p>
      <div className={`mx-auto my-3 flex h-24 w-24 flex-col items-center justify-center rounded-full border-4 ${color}`}>
        <span className="text-3xl font-bold">{confluence.score}</span>
        <span className="text-xs text-slate-400">/ 100</span>
      </div>
      <span className={`rounded-full border px-4 py-1 text-sm font-bold ${color} ${bgColor}`}>{label}</span>
      <div className="mt-3">
        <div className="h-2 overflow-hidden rounded-full bg-slate-700">
          <div
            className={`h-full rounded-full transition-all ${confluence.score >= 70 ? "bg-green-500" : confluence.score <= 30 ? "bg-red-500" : "bg-yellow-500"}`}
            style={{ width: `${confluence.score}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">{confluence.bullishSignals}/{confluence.totalSignals} إشارات إيجابية</p>
      </div>
    </div>
  );
}
