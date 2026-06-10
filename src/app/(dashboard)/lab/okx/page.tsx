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
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Direction = "BUY" | "SELL" | null;
type WsStatus  = "connecting" | "connected" | "disconnected" | "error";
type OkxSymbol = "BTC-USDT" | "ETH-USDT";

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
  sl:              number | null;
  tp:              number | null;
  atr:             number | null;
  votes:           AgentVote[];
  ts:              string;
  read_only:       true;
  data_source:     string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_URL        = "ws://127.0.0.1:8010/ws/live-market";
const PING_INTERVAL = 25_000;
const ATR_SL_MULT   = 1.5; // mirrors agents.py ATR_SL_MULT

const OKX_SYMBOLS: readonly OkxSymbol[] = ["BTC-USDT", "ETH-USDT"];

const SYMBOL_META: Record<
  OkxSymbol,
  { short: string; name: string; accent: string; tabActive: string }
> = {
  "BTC-USDT": {
    short:     "BTC",
    name:      "Bitcoin",
    accent:    "text-amber-400",
    tabActive: "border-amber-500/50 bg-amber-500/15 text-amber-200",
  },
  "ETH-USDT": {
    short:     "ETH",
    name:      "Ethereum",
    accent:    "text-cyan-400",
    tabActive: "border-cyan-500/50 bg-cyan-500/15 text-cyan-200",
  },
};

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
  onChange,
  hasSignal,
}: {
  active:    OkxSymbol;
  onChange:  (s: OkxSymbol) => void;
  hasSignal: Record<OkxSymbol, boolean>;
}) {
  return (
    <div className="flex gap-2">
      {OKX_SYMBOLS.map((sym) => {
        const meta     = SYMBOL_META[sym];
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
  const symMeta = SYMBOL_META[symbol];

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
            className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-border/20 bg-card/30 p-4"
          >
            <p className="text-center text-xs text-muted-foreground/45">
              {meta?.label}
            </p>
            <p className="mt-1 text-center text-[10px] text-muted-foreground/30">
              {meta?.indicator}
            </p>
            <div className="mt-3 h-1.5 w-10 animate-pulse rounded-full bg-muted/30" />
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
  const [activeSymbol, setActiveSymbol] = useState<OkxSymbol>("BTC-USDT");
  const [signals,      setSignals]      = useState<Record<OkxSymbol, AgentSignal | null>>({
    "BTC-USDT": null,
    "ETH-USDT": null,
  });

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
        JSON.stringify({ type: "subscribe", symbols: ["BTC-USDT", "ETH-USDT"] }),
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

        if (sym === "BTC-USDT" || sym === "ETH-USDT") {
          setSignals((prev) => ({ ...prev, [sym]: sig }));
          setTotalCount((n) => n + 1);
          setStatusText(
            `إشارة ${sig.direction ?? "WAIT"} — ${sym} — ${new Date().toLocaleTimeString("ar-SA")}`,
          );
        }
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
  const hasSignal: Record<OkxSymbol, boolean> = {
    "BTC-USDT": signals["BTC-USDT"] !== null,
    "ETH-USDT": signals["ETH-USDT"] !== null,
  };
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

      {/* Currency tabs + signal counter */}
      <div className="flex items-center justify-between gap-4">
        <SymbolTabs
          active={activeSymbol}
          onChange={setActiveSymbol}
          hasSignal={hasSignal}
        />
        {totalCount > 0 && (
          <span className="shrink-0 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] text-cyan-400">
            {totalCount} إشارة مستلمة
          </span>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between rounded-xl border border-border/20 bg-card/40 px-4 py-2.5">
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
