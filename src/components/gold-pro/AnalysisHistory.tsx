// src/components/gold-pro/AnalysisHistory.tsx
interface Stats { total: number; wins: number; losses: number; pending: number; accuracy: number; }

interface AnalysisRecord {
  _id: number;
  timestamp: number | null;
  signal: string | null;
  confluenceScore: number | null;
  outcome: string;
}

export function AnalysisHistory({
  history,
  stats,
}: {
  history: AnalysisRecord[];
  stats: Stats;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <p className="mb-3 text-xs uppercase tracking-widest text-slate-500">📋 آخر التوصيات المحفوظة</p>
        {history.length === 0 ? (
          <p className="text-xs text-slate-500">لا توجد توصيات محفوظة بعد</p>
        ) : (
          <div className="space-y-2">
            {history.slice(0, 5).map((h) => (
              <div key={h._id} className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{h.timestamp ? new Date(h.timestamp).toLocaleDateString("ar") : "—"}</span>
                <span className={`rounded-full px-2 py-0.5 font-bold ${h.signal === "BUY" ? "bg-green-950 text-green-400" : h.signal === "SELL" ? "bg-red-950 text-red-400" : "bg-yellow-950 text-yellow-400"}`}>{h.signal}</span>
                <span className="text-slate-400">{h.confluenceScore}%</span>
                <span className={`rounded-full px-2 py-0.5 ${h.outcome === "win" ? "bg-green-950 text-green-400" : h.outcome === "loss" ? "bg-red-950 text-red-400" : "bg-slate-800 text-slate-500"}`}>
                  {h.outcome === "win" ? "✓ ناجحة" : h.outcome === "loss" ? "✗ خاسرة" : "⏳ مفتوحة"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <p className="mb-3 text-xs uppercase tracking-widest text-slate-500">📊 إحصاءات الدقة</p>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between"><span className="text-slate-400">إجمالي التحليلات</span><span className="text-blue-400">{stats.total}</span></div>
          <div className="flex justify-between"><span className="text-green-400">ناجحة</span><span className="text-green-400">{stats.wins}</span></div>
          <div className="flex justify-between"><span className="text-red-400">خاسرة</span><span className="text-red-400">{stats.losses}</span></div>
          <div className="flex justify-between"><span className="text-yellow-400">مفتوحة</span><span className="text-yellow-400">{stats.pending}</span></div>
          <div className="mt-2 flex justify-between border-t border-slate-700 pt-2">
            <span className="text-slate-400">دقة التوصيات</span>
            <span className={`text-lg font-bold ${stats.accuracy >= 60 ? "text-green-400" : "text-yellow-400"}`}>{stats.accuracy}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
