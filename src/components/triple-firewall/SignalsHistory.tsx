// src/components/triple-firewall/SignalsHistory.tsx
// سجل تحليلات الجدار الثلاثي (Triple Firewall) — قراءة فقط
// مقسّم إلى: الذهب والفوركس (MT5) + الكريبتو (OKX) — وآخر تحليل لكل رمز
"use client";

import { useQuery } from "@tanstack/react-query";
import type { TripleFirewallSignal, FirewallConfluenceLevel } from "@/lib/triple-firewall/types";

const CONFLUENCE_STYLES: Record<FirewallConfluenceLevel, string> = {
  STRONG: "bg-green-950 text-green-400 border border-green-800",
  MEDIUM: "bg-amber-950 text-amber-400 border border-amber-800",
  WEAK:   "bg-slate-800 text-slate-400 border border-slate-700",
  NONE:   "bg-slate-900 text-slate-600 border border-slate-800",
};

const CONFLUENCE_LABELS_AR: Record<FirewallConfluenceLevel, string> = {
  STRONG: "قوي 3/3",
  MEDIUM: "متوسط 2/3",
  WEAK:   "ضعيف 1/3",
  NONE:   "لا يوجد",
};

// رموز الكريبتو من OKX تُكتب بصيغة BASE-QUOTE (مثل BTC-USDT) — كل ما عداها يُعتبر MT5/فوركس/ذهب
function isCryptoSymbol(symbol: string): boolean {
  return symbol.includes("-");
}

function FirewallDot({ ok, label }: { ok: boolean | null; label: string }) {
  const color = ok === true ? "bg-green-500" : ok === false ? "bg-slate-700" : "bg-slate-800";
  return (
    <span className="flex items-center gap-1" title={label}>
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-[10px] text-slate-500">{label}</span>
    </span>
  );
}

function SignalRow({ s }: { s: TripleFirewallSignal }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-slate-500">
          {s.timestamp ? new Date(s.timestamp).toLocaleString("ar") : "—"}
        </span>
        <span className="text-slate-400">{s.symbol}</span>
        <span className={`rounded-full px-2 py-0.5 font-bold ${
          s.direction === "BUY" ? "bg-green-950 text-green-400" :
          s.direction === "SELL" ? "bg-red-950 text-red-400" :
          "bg-slate-800 text-slate-500"
        }`}>
          {s.direction ?? "—"}
        </span>
        <span className={`rounded-full px-2 py-0.5 font-bold ${CONFLUENCE_STYLES[s.confluenceLevel ?? "NONE"]}`}>
          {CONFLUENCE_LABELS_AR[s.confluenceLevel ?? "NONE"]}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-3">
          <FirewallDot ok={s.firewalls.trend} label="الاتجاه EMA200" />
          <FirewallDot ok={s.firewalls.volatility} label="التذبذب BB" />
          <FirewallDot ok={s.firewalls.momentum} label="الزخم RSI" />
        </div>
        <div className="flex gap-3 text-slate-500">
          {s.atr != null && <span>ATR: <span className="text-slate-300">{s.atr.toFixed(2)}</span></span>}
          {s.rr != null && <span>R:R: <span className="text-slate-300">{s.rr.toFixed(2)}</span></span>}
          {s.sl != null && <span>SL: <span className="text-red-400">{s.sl.toFixed(2)}</span></span>}
          {s.tp != null && <span>TP: <span className="text-green-400">{s.tp.toFixed(2)}</span></span>}
        </div>
        {s.sessionLabel && (
          <span className="text-slate-500">{s.sessionLabel} ({s.baghdadHour}:00)</span>
        )}
      </div>
    </div>
  );
}

// بطاقة "آخر تحليل" لرمز واحد — تُستخدم في شبكة كل قسم
function LatestSignalCard({ s }: { s: TripleFirewallSignal }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-200">{s.symbol}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
          s.direction === "BUY" ? "bg-green-950 text-green-400" :
          s.direction === "SELL" ? "bg-red-950 text-red-400" :
          "bg-slate-800 text-slate-500"
        }`}>
          {s.direction ?? "—"}
        </span>
      </div>
      <div className="mb-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${CONFLUENCE_STYLES[s.confluenceLevel ?? "NONE"]}`}>
          {CONFLUENCE_LABELS_AR[s.confluenceLevel ?? "NONE"]}
        </span>
      </div>
      <div className="mb-2 flex gap-3">
        <FirewallDot ok={s.firewalls.trend} label="الاتجاه EMA200" />
        <FirewallDot ok={s.firewalls.volatility} label="التذبذب BB" />
        <FirewallDot ok={s.firewalls.momentum} label="الزخم RSI" />
      </div>
      <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-500">
        {s.atr != null && <span>ATR: <span className="text-slate-300">{s.atr.toFixed(2)}</span></span>}
        {s.rr != null && <span>R:R: <span className="text-slate-300">{s.rr.toFixed(2)}</span></span>}
        {s.sl != null && <span>SL: <span className="text-red-400">{s.sl.toFixed(2)}</span></span>}
        {s.tp != null && <span>TP: <span className="text-green-400">{s.tp.toFixed(2)}</span></span>}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-600">
        <span>{s.sessionLabel ? `${s.sessionLabel} (${s.baghdadHour}:00)` : ""}</span>
        <span>{s.timestamp ? new Date(s.timestamp).toLocaleString("ar") : "—"}</span>
      </div>
    </div>
  );
}

// قسم كامل: شبكة "آخر تحليل لكل رمز" + سجل آخر التحليلات لهذه المجموعة
function SignalsSection({
  title,
  emoji,
  latestPerSymbol,
  history,
  emptyText,
}: {
  title: string;
  emoji: string;
  latestPerSymbol: TripleFirewallSignal[];
  history: TripleFirewallSignal[];
  emptyText: string;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold text-slate-300">{emoji} {title}</p>
      {latestPerSymbol.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyText}</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {latestPerSymbol.map((s) => (
              <LatestSignalCard key={s.symbol} s={s} />
            ))}
          </div>
          {history.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer select-none text-[11px] text-slate-500 hover:text-slate-400">
                السجل الكامل ({history.length})
              </summary>
              <div className="mt-2 space-y-2">
                {history.map((s) => (
                  <SignalRow key={s.id} s={s} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export function SignalsHistory() {
  const { data, isLoading } = useQuery<TripleFirewallSignal[]>({
    queryKey: ["triple-firewall-signals"],
    queryFn: async () => {
      const res = await fetch("/api/lab/triple-firewall/signals?limit=100");
      if (!res.ok) return [];
      const json = await res.json();
      return json.signals ?? [];
    },
    refetchInterval: 30_000,
  });

  const signals = data ?? [];
  const mt5Signals    = signals.filter((s) => !isCryptoSymbol(s.symbol));
  const cryptoSignals = signals.filter((s) => isCryptoSymbol(s.symbol));

  // آخر تحليل لكل رمز — يفترض أن السجل مرتب من الأحدث إلى الأقدم
  const latestPerSymbol = (list: TripleFirewallSignal[]) => {
    const seen = new Set<string>();
    const out: TripleFirewallSignal[] = [];
    for (const s of list) {
      if (!seen.has(s.symbol)) {
        seen.add(s.symbol);
        out.push(s);
      }
    }
    return out;
  };

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <p className="mb-3 border-b border-slate-700 pb-2 text-xs uppercase tracking-widest text-slate-500">
        🛡️ سجل تحليلات الجدار الثلاثي (Triple Firewall)
      </p>
      {isLoading ? (
        <p className="text-xs text-slate-500">جاري التحميل…</p>
      ) : signals.length === 0 ? (
        <p className="text-xs text-slate-500">
          لا توجد تحليلات محفوظة بعد — يعمل المحرك التحليلي دورياً في الخلفية
        </p>
      ) : (
        <div className="space-y-5">
          <SignalsSection
            title="الذهب والفوركس (MT5)"
            emoji="🥇"
            latestPerSymbol={latestPerSymbol(mt5Signals)}
            history={mt5Signals}
            emptyText="لا توجد تحليلات MT5 محفوظة بعد"
          />
          <SignalsSection
            title="الكريبتو (OKX)"
            emoji="🪙"
            latestPerSymbol={latestPerSymbol(cryptoSignals)}
            history={cryptoSignals}
            emptyText="لا توجد تحليلات كريبتو محفوظة بعد"
          />
        </div>
      )}
      <p className="mt-3 text-center text-[10px] text-slate-600">
        تحليل معلوماتي مؤسسي — ليس توصية مالية
      </p>
    </div>
  );
}
