"use client";

/**
 * /lab/okx — طرفية مراقبة الكريبتو المباشرة
 *
 * تتصل بمجلس وكلاء FastAPI عبر WebSocket وتفرز إشارات مصدر OKX.
 * نظام معلوماتي تحليلي — قراءة بيانات السوق العامة فقط — لا تنفيذ صفقات.
 * READ_ONLY_MODE محفوظ — Stage 14 مقفل — لا ربط محافظ — لا أوامر تنفيذ.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Lock,
  Shield,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
  Zap,
  RefreshCcw,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OkxChartAnalyzer } from "@/components/lab/OkxChartAnalyzer";
import { ScreenerWatchlistPanel } from "@/components/gold-pro/ScreenerWatchlistPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Direction = "BUY" | "SELL" | null;
type WsStatus  = "connecting" | "connected" | "disconnected" | "error";
type OkxSymbol = string;

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
  data_source:     string;
}

interface ScannerCoin {
  symbol: string;
  base: string;
  quote: string;
  status: "approved" | "rejected";
  reason: string;
}

interface ScannerStats {
  total: number;
  approved_count: number;
  rejected_count: number;
  coins: ScannerCoin[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_URL        = "ws://127.0.0.1:8010/ws/live-market";
const API_URL       = "http://127.0.0.1:8010";
const PING_INTERVAL = 25_000;
const ATR_SL_MULT   = 1.5; // mirrors agents.py ATR_SL_MULT


function getSymbolMeta(sym: string) {
  if (sym === "BTC-USDT") {
    return {
      short:     "BTC",
      name:      "Bitcoin",
      accent:    "text-amber-400",
      tabActive: "border-amber-500/50 bg-amber-500/15 text-amber-200",
    };
  }
  if (sym === "ETH-USDT") {
    return {
      short:     "ETH",
      name:      "Ethereum",
      accent:    "text-cyan-400",
      tabActive: "border-cyan-500/50 bg-cyan-500/15 text-cyan-200",
    };
  }
  return {
    short:     sym.split('-')[0] || sym,
    name:      sym,
    accent:    "text-purple-400",
    tabActive: "border-purple-500/50 bg-purple-500/15 text-purple-200",
  };
}

const AGENT_CONFIG: Record<
  string,
  { label: string; indicator: string; veto: boolean }
> = {
  TrendAgent:      { label: "وكيل الاتجاه",   indicator: "EMA 200",         veto: true  },
  VolatilityAgent: { label: "وكيل التقلب",     indicator: "Bollinger Bands",  veto: false },
  MomentumAgent:   { label: "وكيل الزخم",      indicator: "RSI 14",           veto: false },
  RiskAgent:       { label: "وكيل المخاطرة",   indicator: "ATR 14 & RR",      veto: true  },
};

const AGENT_ORDER = [
  "TrendAgent",
  "VolatilityAgent",
  "MomentumAgent",
  "RiskAgent",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _formatCryptoPrice(val: number | null): string {
  if (val == null) return "--";
  const abs = Math.abs(val);
  if (abs >= 1_000) return val.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1)     return val.toFixed(4);
  return val.toFixed(6);
}

function _computeEntry(signal: AgentSignal): number | null {
  if (signal.sl == null || signal.atr == null) return null;
  if (signal.direction === "BUY")  return signal.sl + ATR_SL_MULT * signal.atr;
  if (signal.direction === "SELL") return signal.sl - ATR_SL_MULT * signal.atr;
  return null;
}

// ---------------------------------------------------------------------------
// OKX Safety Banner — Stage 14 compliance
// ---------------------------------------------------------------------------

function OkxSafetyBanner() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
      <div>
        <p className="mb-0.5 text-[11px] font-bold text-amber-300">
          Stage 14 مقفل — READ_ONLY_MODE
        </p>
        <p className="text-[11px] leading-relaxed text-amber-300/80">
          نظام معلوماتي تحليلي فقط لقراءة بيانات السوق العامة لمنصة OKX ولا يحتوي
          على أي ربط للمحافظ أو تنفيذ لعمليات السحب أو التداول الحقيقي المالي
          لحماية أصولك الرقمية.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection Badge
// ---------------------------------------------------------------------------

function ConnectionBadge({ status }: { status: WsStatus }) {
  const cfg: Record<WsStatus, { label: string; cls: string; dot: string }> = {
    connecting:   { label: "جاري الاتصال...", cls: "text-amber-400",   dot: "bg-amber-400 animate-pulse"   },
    connected:    { label: "متصل",            cls: "text-emerald-400", dot: "bg-emerald-400 animate-pulse" },
    disconnected: { label: "منقطع",           cls: "text-gray-400",    dot: "bg-gray-500"                  },
    error:        { label: "خطأ في الاتصال",  cls: "text-rose-400",    dot: "bg-rose-500"                  },
  };
  const m    = cfg[status];
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
// Symbol Tabs (BTC-USDT / ETH-USDT)
// ---------------------------------------------------------------------------

function SymbolTabs({
  active,
  symbolsList,
  onChange,
  hasSignal,
}: {
  active:    OkxSymbol;
  symbolsList: OkxSymbol[];
  onChange:  (s: OkxSymbol) => void;
  hasSignal: Record<OkxSymbol, boolean>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {symbolsList.map((sym) => {
        const meta     = getSymbolMeta(sym);
        const isActive = active === sym;
        return (
          <button
            key={sym}
            onClick={() => onChange(sym)}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-4 py-2.5 transition-all duration-200",
              isActive
                ? meta.tabActive
                : "border-border/25 bg-card/40 text-muted-foreground hover:border-border/50 hover:text-foreground",
            )}
          >
            {hasSignal[sym] && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            )}
            <span
              className={cn(
                "text-sm font-black tracking-wider",
                isActive && meta.accent,
              )}
            >
              {meta.short}
            </span>
            <span className="text-[11px] font-normal opacity-60">
              {sym}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crypto Terminal Card
// ---------------------------------------------------------------------------

function CryptoTerminalCard({
  signal,
  symbol,
}: {
  signal: AgentSignal | null;
  symbol: OkxSymbol;
}) {
  const dir     = signal?.direction ?? null;
  const symMeta = getSymbolMeta(symbol);

  const theme =
    dir === "BUY"
      ? {
          wrap:  "from-emerald-950/50 to-card border-emerald-500/50",
          icon:  "border-emerald-500/40 bg-emerald-500/15",
          badge: "border-emerald-500/40 bg-emerald-500/20 text-emerald-200",
          bar:   "bg-emerald-500",
          pct:   "text-emerald-400",
          dot:   "bg-emerald-400 animate-pulse",
          label: "شراء",
          node:  <TrendingUp  className="h-6 w-6 text-emerald-400" />,
        }
      : dir === "SELL"
      ? {
          wrap:  "from-rose-950/50 to-card border-rose-500/50",
          icon:  "border-rose-500/40 bg-rose-500/15",
          badge: "border-rose-500/40 bg-rose-500/20 text-rose-200",
          bar:   "bg-rose-500",
          pct:   "text-rose-400",
          dot:   "bg-rose-400 animate-pulse",
          label: "بيع",
          node:  <TrendingDown className="h-6 w-6 text-rose-400"    />,
        }
      : {
          wrap:  "from-card to-card border-border/30",
          icon:  "border-border/40 bg-muted/20",
          badge: "border-border/40 bg-muted/30 text-muted-foreground",
          bar:   "bg-muted-foreground/20",
          pct:   "text-muted-foreground",
          dot:   "bg-gray-500",
          label: "انتظار",
          node:  <Activity className="h-6 w-6 text-muted-foreground" />,
        };

  const strength = signal ? Math.round(signal.signal_strength * 100) : 0;
  const entry    = signal ? _computeEntry(signal) : null;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-gradient-to-br p-6 shadow-xl",
        theme.wrap,
      )}
    >
      {/* Header row */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl border",
              theme.icon,
            )}
          >
            {theme.node}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
              الزوج النشط
            </p>
            <p className={cn("text-2xl font-black tracking-widest", symMeta.accent)}>
              {symMeta.short}
            </p>
            <p className="text-[10px] tabular-nums text-muted-foreground/50">
              {symbol}
            </p>
          </div>
        </div>

        <div
          className={cn(
            "flex items-center gap-2.5 rounded-xl border px-5 py-3",
            theme.badge,
          )}
        >
          {dir && (
            <span className={cn("h-2.5 w-2.5 rounded-full", theme.dot)} />
          )}
          <span className="text-base font-black tracking-widest">
            {theme.label}
          </span>
        </div>
      </div>

      {/* Signal strength bar */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-muted-foreground/70">
            قوة إشارة مجلس الوكلاء
          </p>
          <p className={cn("text-2xl font-black tabular-nums", theme.pct)}>
            {strength}%
          </p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/30">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-700",
              theme.bar,
            )}
            style={{ width: `${strength}%` }}
          />
        </div>
      </div>

      {/* Protection levels grid */}
      {signal && (signal.sl != null || signal.tp != null) ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              {
                key:   "entry",
                label: "سعر الدخول",
                val:   entry,
                color: "text-cyan-300",
                sub:   "تقريبي",
              },
              {
                key:   "sl",
                label: "وقف الخسارة SL",
                val:   signal.sl,
                color: "text-rose-400",
                sub:   "1.5 ATR",
              },
              {
                key:   "tp",
                label: "الهدف TP",
                val:   signal.tp,
                color: "text-emerald-400",
                sub:   "3.0 ATR",
              },
              {
                key:   "atr",
                label: "ATR",
                val:   signal.atr,
                color: "text-amber-400",
                sub:   "تقلب الفترة",
              },
            ] as const
          ).map(({ key, label, val, color, sub }) => (
            <div
              key={key}
              className="rounded-xl border border-border/25 bg-card/40 px-3 py-3 text-center"
            >
              <p className="text-[9px] leading-snug text-muted-foreground/60">
                {label}
              </p>
              <p
                className={cn(
                  "mt-1 font-mono text-sm font-bold tabular-nums",
                  color,
                )}
              >
                {_formatCryptoPrice(val ?? null)}
              </p>
              <p className="mt-0.5 text-[9px] text-muted-foreground/40">
                {sub}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border/20 bg-card/30 px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground/60">
            {signal === null
              ? `في انتظار إشارة ${symbol} من مجلس الوكلاء...`
              : "لا توجد مستويات حماية متاحة"}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground/40">
            المجلس يفحص OKX كل 5 دقائق — الدورة القادمة قريباً
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
        <p className="mt-5 text-center text-[10px] tabular-nums text-muted-foreground/40">
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
          : "border-border/25 bg-card/40",
      )}
    >
      {meta.veto && (
        <div className="absolute right-2 top-2">
          <div className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5">
            <Shield className="h-2.5 w-2.5 text-amber-400" />
            <span className="text-[9px] font-medium text-amber-400">فيتو</span>
          </div>
        </div>
      )}

      <div className={cn("mt-1", meta.veto && "mt-5")}>
        <p
          className={cn(
            "text-xs font-semibold",
            vote.approved ? "text-emerald-300" : "text-foreground/80",
          )}
        >
          {meta.label}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground/55">
          {meta.indicator}
        </p>
      </div>

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

      {vote.reason && (
        <p className="mt-2.5 line-clamp-3 text-[10px] leading-relaxed text-muted-foreground/65">
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

        if (vote) return <AgentCard key={name} vote={vote} />;

        return (
          <div
            key={name}
            className="relative flex min-h-28 flex-col items-center justify-center overflow-hidden rounded-xl border border-border/10 bg-card/10 p-4"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-border/5 to-transparent animate-pulse" />
            <p className="relative z-10 text-center text-xs font-semibold text-muted-foreground/60">{meta?.label}</p>
            <p className="relative z-10 mt-1 text-center text-[10px] text-muted-foreground/40">{meta?.indicator}</p>
            <div className="relative z-10 mt-4 flex items-center gap-2">
               <span className="h-1.5 w-1.5 rounded-full bg-cyan-500/60 animate-ping" />
               <span className="text-[10px] font-medium text-cyan-500/70 animate-pulse">جاري الفحص...</span>
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

export default function OkxLabPage() {
  const [wsStatus,     setWsStatus]     = useState<WsStatus>("connecting");
  const [statusText,   setStatusText]   = useState("جاري تهيئة الاتصال...");
  const [totalCount,   setTotalCount]   = useState(0);
  const [symbolsList,  setSymbolsList]  = useState<OkxSymbol[]>(["BTC-USDT", "ETH-USDT"]);
  const [activeSymbol, setActiveSymbol] = useState<OkxSymbol>("BTC-USDT");
  const [signals,      setSignals]      = useState<Record<OkxSymbol, AgentSignal | null>>({
    "BTC-USDT": null,
    "ETH-USDT": null,
  });

  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerStats, setScannerStats] = useState<ScannerStats | null>(null);
  const [scannerFilter, setScannerFilter] = useState<"all" | "approved" | "rejected">("all");
  const [selectedScannerCoin, setSelectedScannerCoin] = useState<string | null>(null);

  // Fetch watchlist on mount
  useEffect(() => {
    fetch("/api/lab/watchlist?source=okx")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.symbols && data.symbols.length > 0) {
          setSymbolsList(data.symbols);
          if (!data.symbols.includes(activeSymbol)) {
            setActiveSymbol(data.symbols[0]);
          }
        }
      })
      .catch((err) => console.error("Failed to load watchlist", err));
  }, []);

  const handleWatchlistChange = useCallback((newSymbols: string[]) => {
    if (newSymbols.length > 0) {
      setSymbolsList(newSymbols);
      setActiveSymbol((prev) => (newSymbols.includes(prev) ? prev : newSymbols[0]));
      // Update WebSocket subscription
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "subscribe", symbols: newSymbols }));
      }
    }
  }, []);

  const handleScan = async () => {
    setScannerLoading(true);
    setSelectedScannerCoin(null);
    try {
      const res = await fetch(`${API_URL}/api/okx/scanner`);
      if (res.ok) {
        const data = await res.json();
        setScannerStats(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setScannerLoading(false);
    }
  };

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
      setStatusText("متصل — في انتظار إشارات OKX من مجلس الوكلاء");

      ws.send(
        JSON.stringify({ type: "subscribe", symbols: symbolsList }),
      );

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

      // Only handle agent_signal events from the OKX data source.
      if (parsed.type === "agent_signal" && parsed.data_source === "okx") {
        const sig = parsed as unknown as AgentSignal;
        const sym = sig.symbol as OkxSymbol;

        setSignals((prev) => ({ ...prev, [sym]: sig }));
        setTotalCount((n) => n + 1);
        setStatusText(
          `إشارة ${sig.direction ?? "WAIT"} — ${sym} — ${new Date().toLocaleTimeString("ar-SA")}`,
        );
      } else if (parsed.type === "connected") {
        setStatusText("مجلس الوكلاء جاهز — يُمسَح كل 5 دقائق");
      }
      // ping / pong / ack events are silently ignored
    };

    ws.onerror = () => {
      setWsStatus("error");
      setStatusText("خطأ في الاتصال — تأكد من تشغيل خدمة FastAPI على المنفذ 8010");
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

  const activeSignal  = signals[activeSymbol];
  const hasSignal = symbolsList.reduce((acc, sym) => {
    acc[sym] = signals[sym] !== undefined && signals[sym] !== null;
    return acc;
  }, {} as Record<OkxSymbol, boolean>);
  const approvedCount = activeSignal
    ? activeSignal.votes.filter((v) => v.approved).length
    : 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-10">
      {/* Page header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Zap className="h-4 w-4 text-cyan-400" />
              <h2 className="page-title">طرفية الكريبتو المباشرة</h2>
            </div>
            <p className="label-secondary">
              مجلس الوكلاء الكمي — تحليل كريبتو عبر 4 وكلاء متخصصين
            </p>
          </div>
          <ConnectionBadge status={wsStatus} />
        </div>

        <OkxSafetyBanner />
      </div>

      {/* Status bar */}
      <div className="mt-6 flex items-center justify-between rounded-xl border border-border/20 bg-card/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-xs text-muted-foreground/80">{statusText}</span>
        </div>
        {(wsStatus === "disconnected" || wsStatus === "error") && (
          <button
            onClick={connect}
            className="text-[11px] text-cyan-400 underline underline-offset-2 hover:text-cyan-300"
          >
            إعادة الاتصال
          </button>
        )}
      </div>

      {/* Crypto terminal card */}
      <section>
        <p className="mb-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground/55">
          قرار مجلس الوكلاء — {activeSymbol}
        </p>
        <CryptoTerminalCard signal={activeSignal} symbol={activeSymbol} />
      </section>

      {/* 4-Agent voting grid */}
      <section>
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/55">
            رادار تصويت الوكلاء الأربعة
          </p>
          {activeSignal && (
            <p className="text-[10px] text-muted-foreground/45">
              {approvedCount} / 4 موافقين
            </p>
          )}
        </div>
        <AgentVotingGrid votes={activeSignal?.votes ?? []} />
      </section>

      {/* Crypto Scanner Section */}
      <section className="rounded-2xl border border-cyan-500/20 bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-foreground">الماسح الآلي للعملات (Crypto Scanner)</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              سحب وفرز جميع عملات Spot المتاحة لاستبعاد العملات المرفوضة واعتماد المسموح بها للتداول.
            </p>
          </div>
          <button
            onClick={handleScan}
            disabled={scannerLoading}
            className="flex items-center gap-2 rounded-lg bg-cyan-500/10 px-4 py-2.5 text-sm font-bold text-cyan-400 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
          >
            <RefreshCcw className={cn("h-4 w-4", scannerLoading && "animate-spin")} />
            {scannerLoading ? "جاري الفرز..." : "بدء المسح والفلترة"}
          </button>
        </div>

        {scannerStats && (
          <div className="mt-6">
            <div className="grid grid-cols-3 gap-3">
              <div 
                onClick={() => setScannerFilter("all")}
                className={cn("cursor-pointer rounded-xl border p-4 text-center transition-colors", scannerFilter === "all" ? "border-cyan-500/50 bg-cyan-500/10" : "border-border/30 bg-muted/20 hover:bg-muted/30")}
              >
                <p className="text-xs text-muted-foreground">العدد الكلي</p>
                <p className="mt-1 text-2xl font-black text-foreground">{scannerStats.total}</p>
              </div>
              <div 
                onClick={() => setScannerFilter("approved")}
                className={cn("cursor-pointer rounded-xl border p-4 text-center transition-colors", scannerFilter === "approved" ? "border-emerald-500/60 bg-emerald-500/20" : "border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15")}
              >
                <p className="text-xs text-emerald-400/80">المقبولة</p>
                <p className="mt-1 text-2xl font-black text-emerald-400">{scannerStats.approved_count}</p>
              </div>
              <div 
                onClick={() => setScannerFilter("rejected")}
                className={cn("cursor-pointer rounded-xl border p-4 text-center transition-colors", scannerFilter === "rejected" ? "border-rose-500/60 bg-rose-500/20" : "border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/15")}
              >
                <p className="text-xs text-rose-400/80">المرفوضة</p>
                <p className="mt-1 text-2xl font-black text-rose-400">{scannerStats.rejected_count}</p>
              </div>
            </div>

            <div className="mt-4 max-h-[300px] overflow-y-auto rounded-xl border border-border/20 bg-background/50">
              <table className="w-full text-right text-[11px]">
                <thead className="sticky top-0 border-b border-border/20 bg-card/90 backdrop-blur">
                  <tr>
                    <th className="px-4 py-2 font-semibold text-muted-foreground">العملة</th>
                    <th className="px-4 py-2 font-semibold text-muted-foreground">الحالة</th>
                    <th className="px-4 py-2 font-semibold text-muted-foreground">السبب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/10">
                  {scannerStats.coins
                    .filter((c) => scannerFilter === "all" || c.status === scannerFilter)
                    .map((c) => (
                    <tr 
                      key={c.symbol} 
                      onClick={() => {
                        if (c.status === "approved") {
                          setSelectedScannerCoin(c.symbol);
                          
                          setSymbolsList(prev => {
                            if (!prev.includes(c.symbol)) {
                              return [...prev, c.symbol];
                            }
                            return prev;
                          });
                          setActiveSymbol(c.symbol);
                          
                          if (wsRef.current?.readyState === WebSocket.OPEN) {
                             wsRef.current.send(JSON.stringify({ type: "subscribe", symbols: [c.symbol] }));
                          }
                        }
                      }}
                      className={cn(
                        "transition-colors",
                        c.status === "approved" ? "cursor-pointer hover:bg-emerald-500/5" : "hover:bg-muted/10",
                        selectedScannerCoin === c.symbol && "bg-emerald-500/10"
                      )}
                    >
                      <td className="px-4 py-2 font-bold font-mono">{c.symbol}</td>
                      <td className="px-4 py-2">
                        {c.status === "approved" ? (
                          <div className="flex items-center gap-1.5 text-emerald-400">
                            <CheckCircle className="h-3 w-3" />
                            <span>مقبول</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-rose-400">
                            <XCircle className="h-3 w-3" />
                            <span>مرفوض</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground/80">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedScannerCoin && (
              <OkxChartAnalyzer symbol={selectedScannerCoin} />
            )}
          </div>
        )}
      </section>

      {/* شاشة الترشيح + قائمة المتابعة (عملات OKX فقط — حتى 5 رموز) */}
      <ScreenerWatchlistPanel 
        source="okx" 
        onWatchlistChange={handleWatchlistChange} 
      />

      {/* Info footer */}
      <div className="rounded-xl border border-border/15 bg-card/20 px-4 py-4">
        <div className="flex items-center justify-center gap-1.5">
          <AlertTriangle className="h-3 w-3 shrink-0 text-muted-foreground/40" />
          <p className="text-center text-[10px] leading-relaxed text-muted-foreground/50">
            وكيلا TrendAgent و RiskAgent يمتلكان حق الفيتو — يجب موافقتهما لإصدار أي إشارة.
            بيانات الشموع من OKX REST API العامة بدون مصادقة — لا محافظ — لا تنفيذ صفقات.
            الإطار الزمني H1 — مسح كل 5 دقائق.
          </p>
        </div>
      </div>
    </div>
  );
}
