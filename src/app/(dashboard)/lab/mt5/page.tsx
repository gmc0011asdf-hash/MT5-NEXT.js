"use client";

/**
 * /lab/mt5 — طرفية الوكلاء المباشرة
 *
 * تتصل بمجلس وكلاء FastAPI عبر WebSocket وتعرض التصويتات فور صدورها.
 * نظام معلوماتي تحليلي — لا تنفيذ صفقات — READ_ONLY_MODE محفوظ.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ListTree,
  Shield,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SymbolAnalysisExplorer } from "@/components/lab/SymbolAnalysisExplorer";
import { ScreenerWatchlistPanel } from "@/components/gold-pro/ScreenerWatchlistPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Direction = "BUY" | "SELL" | null;
type WsStatus  = "connecting" | "connected" | "disconnected" | "error";

interface AgentVote {
  agent:      string;
  approved:   boolean;
  confidence: number;
  reason:     string;
}

interface AgentSignal {
  type:            "agent_signal";
  symbol:          string;
  direction:       Direction;
  signal_strength: number;
  entry:           number | null;
  sl:              number | null;
  tp:              number | null;
  atr:             number | null;
  risk_amount:     number | null;
  profit_amount:   number | null;
  lot_size:        number | null;
  duration:        string | null;
  votes:           AgentVote[];
  ts:              string;
  read_only:       true;
}

// ---------------------------------------------------------------------------
// Static configuration
// ---------------------------------------------------------------------------

const WS_URL          = "ws://127.0.0.1:8010/ws/live-market";
const PING_INTERVAL   = 25_000; // ms — keepalive ping before most proxies timeout

const AGENT_CONFIG: Record<string, { label: string; indicator: string; veto: boolean }> = {
  TrendAgent:      { label: "وكيل الاتجاه",    indicator: "EMA 200",         veto: true  },
  VolatilityAgent: { label: "وكيل التقلب",      indicator: "Bollinger Bands",  veto: false },
  MomentumAgent:   { label: "وكيل الزخم",       indicator: "RSI 14",           veto: false },
  RiskAgent:       { label: "وكيل المخاطرة",    indicator: "ATR 14 & RR",      veto: true  },
};

const AGENT_ORDER = ["TrendAgent", "VolatilityAgent", "MomentumAgent", "RiskAgent"];

// ---------------------------------------------------------------------------
// Tiny sub-components
// ---------------------------------------------------------------------------

function SafetyBanner() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-2.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
      <p className="text-xs leading-relaxed text-amber-300/90">
        نظام محلي متصل بمنصة MT5 — حقيقي/تجريبي
      </p>
    </div>
  );
}

function ConnectionBadge({ status }: { status: WsStatus }) {
  const cfg: Record<WsStatus, { label: string; cls: string; dot: string }> = {
    connecting:   { label: "جاري الاتصال...",  cls: "text-amber-400",   dot: "bg-amber-400 animate-pulse"   },
    connected:    { label: "متصل",             cls: "text-emerald-400", dot: "bg-emerald-400 animate-pulse" },
    disconnected: { label: "منقطع",            cls: "text-gray-400",    dot: "bg-gray-500"                  },
    error:        { label: "خطأ في الاتصال",   cls: "text-rose-400",    dot: "bg-rose-500"                  },
  };
  const m = cfg[status];
  const Icon = status === "connected" ? Wifi : WifiOff;
  return (
    <div className={cn("flex items-center gap-1.5 text-xs", m.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      <Icon className="h-3 w-3" />
      <span>{m.label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Master Terminal Card
// ---------------------------------------------------------------------------

function TerminalCard({ signal, symbol }: { signal: AgentSignal | null; symbol: string }) {
  const dir = signal?.direction ?? null;

  const theme =
    dir === "BUY"
      ? {
          wrap:   "from-emerald-950/50 to-card border-emerald-500/50",
          icon:   "border-emerald-500/40 bg-emerald-500/15",
          badge:  "border-emerald-500/40 bg-emerald-500/20 text-emerald-300",
          bar:    "bg-emerald-500",
          pct:    "text-emerald-400",
          dot:    "bg-emerald-400 animate-pulse",
          label:  "شراء",
          node:   <TrendingUp  className="h-6 w-6 text-emerald-400" />,
        }
      : dir === "SELL"
      ? {
          wrap:   "from-rose-950/50 to-card border-rose-500/50",
          icon:   "border-rose-500/40 bg-rose-500/15",
          badge:  "border-rose-500/40 bg-rose-500/20 text-rose-300",
          bar:    "bg-rose-500",
          pct:    "text-rose-400",
          dot:    "bg-rose-400 animate-pulse",
          label:  "بيع",
          node:   <TrendingDown className="h-6 w-6 text-rose-400"    />,
        }
      : {
          wrap:   "from-card to-card border-border/30",
          icon:   "border-border/40 bg-muted/20",
          badge:  "border-border/40 bg-muted/30 text-muted-foreground",
          bar:    "bg-muted-foreground/20",
          pct:    "text-muted-foreground",
          dot:    "bg-gray-500",
          label:  "انتظار",
          node:   <Activity     className="h-6 w-6 text-muted-foreground" />,
        };

  const strength = signal ? Math.round(signal.signal_strength * 100) : 0;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-gradient-to-br p-6 shadow-xl",
        theme.wrap,
      )}
    >
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl border", theme.icon)}>
            {theme.node}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">الرمز</p>
            <p className="text-xl font-black tracking-widest text-foreground">{symbol}</p>
          </div>
        </div>

        <div className={cn("flex items-center gap-2 rounded-full border px-5 py-2.5", theme.badge)}>
          {dir && <span className={cn("h-2 w-2 rounded-full", theme.dot)} />}
          <span className="text-sm font-black tracking-widest">{theme.label}</span>
        </div>
      </div>

      {/* Signal strength */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">قوة الإشارة الإجمالية</p>
          <p className={cn("text-2xl font-black tabular-nums", theme.pct)}>
            {strength}%
          </p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/30">
          <div
            className={cn("h-full rounded-full transition-all duration-700", theme.bar)}
            style={{ width: `${strength}%` }}
          />
        </div>
      </div>

      {/* Risk levels */}
      {signal && (signal.sl != null || signal.tp != null) ? (
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: "sl",  label: "وقف الخسارة SL", val: signal.sl,  color: "text-rose-400"    },
            { key: "tp",  label: "الهدف TP",         val: signal.tp,  color: "text-emerald-400" },
            { key: "atr", label: "ATR (تقلب)",        val: signal.atr, color: "text-amber-400"   },
          ].map(({ key, label, val, color }) => (
            <div
              key={key}
              className="rounded-xl border border-border/25 bg-card/40 px-3 py-3 text-center"
            >
              <p className="text-[10px] leading-tight text-muted-foreground/70 mb-1">{label}</p>
              <p className={cn("text-sm font-bold tabular-nums", color)}>
                {val != null ? val.toFixed(2) : "--"}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border/20 bg-card/30 px-4 py-5 text-center">
          <p className="text-sm text-muted-foreground/60">
            {signal === null
              ? "في انتظار إشارة مجلس الوكلاء..."
              : "لا توجد مستويات حماية متاحة"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/40">
            المجلس يعمل كل 5 دقائق — الفحص التالي قريباً
          </p>
        </div>
      )}

      {/* Trade Management & Duration */}
      {signal && signal.risk_amount != null && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border/25 bg-card/40 px-3 py-3 text-center">
            <p className="text-[9px] text-muted-foreground/60">حجم اللوت</p>
            <p className="mt-1 font-mono text-xs font-bold text-indigo-400">
              {signal.lot_size}
            </p>
          </div>
          <div className="rounded-xl border border-border/25 bg-card/40 px-3 py-3 text-center">
            <p className="text-[9px] text-muted-foreground/60">المخاطرة</p>
            <p className="mt-1 font-mono text-xs font-bold text-rose-400">
              ${signal.risk_amount.toFixed(2)}
            </p>
          </div>
          <div className="rounded-xl border border-border/25 bg-card/40 px-3 py-3 text-center">
            <p className="text-[9px] text-muted-foreground/60">الربح المتوقع</p>
            <p className="mt-1 font-mono text-xs font-bold text-emerald-400">
              ${signal.profit_amount?.toFixed(2)}
            </p>
          </div>
          <div className="rounded-xl border border-border/25 bg-card/40 px-3 py-3 text-center">
            <p className="text-[9px] text-muted-foreground/60">مدة الصفقة</p>
            <p className="mt-1 text-xs font-bold text-amber-200/80">
              {signal.duration}
            </p>
          </div>
        </div>
      )}

      {/* Timestamp */}
      {signal?.ts && (
        <p className="mt-4 text-center text-[10px] text-muted-foreground/50 tabular-nums">
          آخر إشارة: {new Date(signal.ts).toLocaleTimeString("ar-SA")}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single agent vote card
// ---------------------------------------------------------------------------

function AgentCard({ vote }: { vote: AgentVote }) {
  const meta = AGENT_CONFIG[vote.agent] ?? {
    label:     vote.agent,
    indicator: "",
    veto:      false,
  };

  return (
    <div
      className={cn(
        "relative rounded-xl border p-4 transition-all duration-500",
        vote.approved
          ? "border-emerald-500/40 bg-emerald-950/30 shadow-sm"
          : "border-border/30 bg-card/40",
      )}
    >
      {/* Veto badge */}
      {meta.veto && (
        <div className="absolute right-2 top-2">
          <div className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5">
            <Shield className="h-2.5 w-2.5 text-amber-400" />
            <span className="text-[9px] font-medium text-amber-400">فيتو</span>
          </div>
        </div>
      )}

      {/* Agent identity */}
      <div className={cn("mt-1", meta.veto && "mt-5")}>
        <p className={cn(
          "text-xs font-semibold",
          vote.approved ? "text-emerald-300" : "text-foreground/80",
        )}>
          {meta.label}
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">{meta.indicator}</p>
      </div>

      {/* Approval chip */}
      <div
        className={cn(
          "mt-3 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5",
          vote.approved
            ? "border-emerald-500/30 bg-emerald-500/15"
            : "border-rose-500/20 bg-rose-950/30",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            vote.approved ? "bg-emerald-400 animate-pulse" : "bg-rose-500",
          )}
        />
        <span
          className={cn(
            "text-[11px] font-medium",
            vote.approved ? "text-emerald-400" : "text-rose-400",
          )}
        >
          {vote.approved ? "موافق" : "رفض"}
        </span>
        {vote.approved && (
          <span className="mr-auto text-[10px] tabular-nums text-emerald-500/80">
            {Math.round(vote.confidence * 100)}%
          </span>
        )}
      </div>

      {/* Reason text */}
      {vote.reason && (
        <p className="mt-2.5 line-clamp-3 text-[10px] leading-relaxed text-muted-foreground/70">
          {vote.reason}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent voting grid (4 cards)
// ---------------------------------------------------------------------------

function AgentVotingGrid({ votes }: { votes: AgentVote[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {AGENT_ORDER.map((name) => {
        const vote = votes.find((v) => v.agent === name);
        const meta = AGENT_CONFIG[name];

        if (vote) {
          return <AgentCard key={name} vote={vote} />;
        }

        // Animated scanning placeholder while waiting for first signal
        return (
          <div
            key={name}
            className="relative flex min-h-28 flex-col items-center justify-center overflow-hidden rounded-xl border border-border/10 bg-card/10 p-4"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-border/5 to-transparent animate-pulse" />
            <p className="relative z-10 text-center text-xs font-semibold text-muted-foreground/60">{meta?.label}</p>
            <p className="relative z-10 mt-1 text-center text-[10px] text-muted-foreground/40">{meta?.indicator}</p>
            <div className="relative z-10 mt-4 flex items-center gap-2">
               <span className="h-1.5 w-1.5 rounded-full bg-amber-500/60 animate-ping" />
               <span className="text-[10px] font-medium text-amber-500/70 animate-pulse">جاري الفحص...</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function LabMt5Page() {
  const [wsStatus,    setWsStatus]    = useState<WsStatus>("connecting");
  const [activeSymbol, setActiveSymbol] = useState("XAUUSD");
  const [signals,     setSignals]     = useState<Record<string, AgentSignal | null>>({});
  const [statusText,  setStatusText]  = useState("جاري تهيئة الاتصال...");
  const [signalCount, setSignalCount] = useState(0);

  const wsRef   = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPing = () => {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
  };

  const connect = useCallback(() => {
    stopPing();
    if (wsRef.current) wsRef.current.close();

    setWsStatus("connecting");
    setStatusText("جاري الاتصال بمجلس الوكلاء...");

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus("connected");
      setStatusText("متصل — في انتظار إشارات مجلس الوكلاء");

      ws.send(JSON.stringify({ type: "subscribe", symbols: [activeSymbol] }));

      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, PING_INTERVAL);
    };

    ws.onmessage = (evt: MessageEvent) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(evt.data as string) as Record<string, unknown>;
      } catch {
        return;
      }

      if (parsed.type === "agent_signal") {
        const sig = parsed as unknown as AgentSignal;
        const sym = sig.symbol;
        setSignals((prev) => ({ ...prev, [sym]: sig }));
        setSignalCount((n) => n + 1);
        const dir = sig.direction ?? "WAIT";
        setStatusText(
          `إشارة ${dir} — ${sym} — ${new Date().toLocaleTimeString("ar-SA")}`,
        );
      } else if (parsed.type === "connected") {
        setStatusText("مجلس الوكلاء جاهز — يُمسَح كل 5 دقائق");
      }
      // ping / pong / ack are silently ignored
    };

    ws.onerror = () => {
      setWsStatus("error");
      setStatusText("خطأ في الاتصال — تأكد من تشغيل خدمة MT5 على المنفذ 8010");
    };

    ws.onclose = () => {
      setWsStatus("disconnected");
      setStatusText("الاتصال مقطوع");
      stopPing();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect();
    return () => {
      stopPing();
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const lastSignal = signals[activeSymbol] ?? null;

  const approvedCount = lastSignal
    ? lastSignal.votes.filter((v) => v.approved).length
    : 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-10">
      {/* Page header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              <h2 className="page-title">طرفية الوكلاء المباشرة</h2>
            </div>
            <p className="label-secondary">
              مجلس الوكلاء الكمي — تحليل السوق عبر 4 وكلاء متخصصين
            </p>
          </div>
          <ConnectionBadge status={wsStatus} />
        </div>

        <SafetyBanner />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between rounded-xl border border-border/20 bg-card/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-xs text-muted-foreground/80">{statusText}</span>
        </div>
        <div className="flex items-center gap-3">
          {signalCount > 0 && (
            <span className="rounded-full border border-amber-500/20 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">
              {signalCount} إشارة مستلمة
            </span>
          )}
          {(wsStatus === "disconnected" || wsStatus === "error") && (
            <button
              onClick={connect}
              className="text-[11px] text-amber-400 underline underline-offset-2 hover:text-amber-300"
            >
              إعادة الاتصال
            </button>
          )}
        </div>
      </div>

      {/* Master terminal card */}
      <section>
        <p className="mb-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
          قرار مجلس الوكلاء
        </p>
        <TerminalCard signal={lastSignal} symbol={activeSymbol} />
      </section>

      {/* 4-Agent voting grid */}
      <section>
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            رادار تصويت الوكلاء الأربعة
          </p>
          {lastSignal && (
            <p className="text-[10px] text-muted-foreground/50">
              {approvedCount} / 4 موافقين
            </p>
          )}
        </div>
        <AgentVotingGrid votes={lastSignal?.votes ?? []} />
      </section>

      {/* Info footer */}
      <div className="rounded-xl border border-border/15 bg-card/20 px-4 py-4">
        <p className="text-center text-[10px] leading-relaxed text-muted-foreground/50">
          وكيلا TrendAgent و RiskAgent يمتلكان حق الفيتو — يجب موافقتهما لإصدار أي إشارة.
          المسح يتم على الإطار الزمني H1 كل 5 دقائق.
          الإشارات معلوماتية تحليلية فقط — لا تنفيذ صفقات.
        </p>
      </div>

      {/* مستكشف رموز Market Watch */}
      <section>
        <div className="mb-3 flex items-center gap-2 px-1">
          <ListTree className="h-3.5 w-3.5 text-amber-400" />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            مستكشف الرموز — كل أدوات Market Watch القابلة للتداول
          </p>
        </div>
        <SymbolAnalysisExplorer onSelectApprovedSymbol={(sym) => {
          setActiveSymbol(sym);
          if (wsRef.current?.readyState === WebSocket.OPEN) {
             wsRef.current.send(JSON.stringify({ type: "subscribe", symbols: [sym] }));
          }
        }} />
      </section>

      {/* شاشة الترشيح + قائمة المتابعة (رموز MT5 فقط — حتى 5 رموز) */}
      <ScreenerWatchlistPanel source="mt5" />
    </div>
  );
}
