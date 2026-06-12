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
  RefreshCcw,
  Search,
  Shield,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
  Zap,
  X,
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

interface RankedCandidate {
  symbol: string;
  source: "mt5" | "okx" | string;
  approved: boolean;
  direction: Direction;
  signal_strength: number;
  confluence_level: string | null;
  reason: string;
  last_scan_ts: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_URL        = "ws://127.0.0.1:8010/ws/live-market";
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

// الوكلاء الفنيون الثلاثة (بدون وكيل المخاطرة RiskAgent) -- تُستخدم قيم
// الثقة الخاصة بهم لعرض القوة الفنية الخام عند حالة الانتظار/الرفض.
const TECHNICAL_AGENTS = ["TrendAgent", "VolatilityAgent", "MomentumAgent"] as const;

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

// عند الموافقة (signal_strength > 0) تُعرض القوة الإجمالية المعتمدة كما هي.
// عند الانتظار/الرفض (الفيتو)، تُعرض القوة الفنية الخام كمتوسط ثقة الوكلاء
// الفنيين الثلاثة (Trend/Volatility/Momentum) بصرف النظر عن موافقتهم.
function computeSignalStrength(signal: AgentSignal | null): number {
  if (!signal) return 0;
  if (signal.signal_strength > 0) return Math.round(signal.signal_strength * 100);
  const technicalVotes = signal.votes.filter((v) =>
    (TECHNICAL_AGENTS as readonly string[]).includes(v.agent),
  );
  if (technicalVotes.length === 0) return 0;
  const avgConfidence =
    technicalVotes.reduce((sum, v) => sum + v.confidence, 0) / technicalVotes.length;
  return Math.round(avgConfidence * 100);
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
// Simulate Entry Modal — Local-First simulated crypto journal
// ---------------------------------------------------------------------------

function SimulateEntryModal({
  signal,
  symbol,
  onClose,
}: {
  signal: AgentSignal | null;
  symbol: OkxSymbol;
  onClose: () => void;
}) {
  const symMeta = getSymbolMeta(symbol);
  const computedEntry = signal ? _computeEntry(signal) : null;

  const [direction, setDirection]   = useState<"BUY" | "SELL">(signal?.direction === "SELL" ? "SELL" : "BUY");
  const [entryPrice, setEntryPrice] = useState(computedEntry != null ? String(computedEntry) : "");
  const [stopLoss, setStopLoss]     = useState(signal?.sl != null ? String(signal.sl) : "");
  const [takeProfit, setTakeProfit] = useState(signal?.tp != null ? String(signal.tp) : "");
  const [lotSize, setLotSize]       = useState(signal?.lot_size != null ? String(signal.lot_size) : "");
  const initialNotes = signal?.votes
    ? signal.votes
        .filter((v) => v.approved && v.reason)
        .map((v) => `${v.agent}: ${v.reason}`)
        .join("\n")
    : "";
  const [notes, setNotes]           = useState(initialNotes);
  const [simDate, setSimDate]       = useState(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [success, setSuccess]       = useState(false);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const openedAt = simDate ? new Date(simDate).getTime() : Date.now();
      const res = await fetch("/api/lab/journal/simulated-positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          source:         "okx",
          direction:      direction,
          entryPrice:     entryPrice  ? Number(entryPrice)  : null,
          stopLoss:       stopLoss    ? Number(stopLoss)    : null,
          takeProfit:     takeProfit  ? Number(takeProfit)  : null,
          lotSize:        lotSize     ? Number(lotSize)     : null,
          riskAmount:     signal?.risk_amount,
          profitAmount:   signal?.profit_amount,
          signalStrength: signal?.signal_strength,
          openedAt,
          notes: notes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setSuccess(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الحفظ");
    } finally {
      setSubmitting(false);
    }
  }, [symbol, signal, direction, entryPrice, stopLoss, takeProfit, lotSize, simDate, notes, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">
            محاكاة دخول صفقة — {symMeta.short}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-relaxed text-amber-200/80">
            صفقة محاكاة (Paper Trade) لأغراض التوثيق والتحليل فقط — لا يتم إرسال أي
            أمر حقيقي لأي منصة.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground">الاتجاه</label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "BUY" | "SELL")}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-center text-xs font-bold appearance-none cursor-pointer focus:outline-none",
                direction === "BUY"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 focus:border-emerald-500/50"
                  : "border-rose-500/40 bg-rose-500/10 text-rose-300 focus:border-rose-500/50",
              )}
            >
              <option value="BUY">شراء (BUY)</option>
              <option value="SELL">بيع (SELL)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground">الزوج</label>
            <div className="rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-center font-mono text-xs font-bold text-foreground">
              {symbol}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground">سعر الدخول</label>
            <input
              type="number"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              className="w-full rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-xs font-mono text-foreground focus:border-cyan-500/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground">حجم اللوت</label>
            <input
              type="number"
              value={lotSize}
              onChange={(e) => setLotSize(e.target.value)}
              className="w-full rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-xs font-mono text-foreground focus:border-cyan-500/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground">وقف الخسارة SL</label>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className="w-full rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-xs font-mono text-rose-300 focus:border-rose-500/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground">الهدف TP</label>
            <input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              className="w-full rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-xs font-mono text-emerald-300 focus:border-emerald-500/50 focus:outline-none"
            />
          </div>

          <div className="col-span-2">
            <label className="mb-1 block text-[10px] text-muted-foreground">تاريخ ووقت المحاكاة</label>
            <input
              type="datetime-local"
              value={simDate}
              onChange={(e) => setSimDate(e.target.value)}
              className="w-full rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-xs text-foreground focus:border-cyan-500/50 focus:outline-none"
            />
          </div>

          <div className="col-span-2">
            <label className="mb-1 block text-[10px] text-muted-foreground">أسباب الدخول الفنية (Reasons for Entry)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-xs text-foreground focus:border-cyan-500/50 focus:outline-none"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-[11px] text-rose-400">{error}</p>}
        {success && (
          <p className="mt-3 text-[11px] text-emerald-400">
            تم حفظ الصفقة المحاكاة — راجعها في سجل القرارات
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || success}
            className="flex-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {submitting ? "جاري الحفظ..." : "تأكيد الدخول المحاكى"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            إلغاء
          </button>
        </div>
      </div>
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
  const [showSimulateModal, setShowSimulateModal] = useState(false);

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

  // مع بقاء لافتة "انتظار" الحمراء كما هي لتوضيح قرار الانتظار الحامي للمحفظة.
  const strength = computeSignalStrength(signal);
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

      {/* Simulate Entry action */}
      {symbol && (
        <button
          type="button"
          onClick={() => setShowSimulateModal(true)}
          className="mt-4 w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-xs font-bold text-cyan-300 transition-colors hover:bg-cyan-500/20"
        >
          محاكاة دخول الصفقة
        </button>
      )}

      {/* Timestamp */}
      {signal?.ts && (
        <p className="mt-5 text-center text-[10px] tabular-nums text-muted-foreground/40">
          آخر إشارة: {new Date(signal.ts).toLocaleTimeString("ar-SA")}
        </p>
      )}

      {showSimulateModal && symbol && (
        <SimulateEntryModal
          signal={signal}
          symbol={symbol}
          onClose={() => setShowSimulateModal(false)}
        />
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
// Watchlist Sidebar — بحث فوري + فلترة حسب الحالة + قوة لحظية لكل عملة
// ---------------------------------------------------------------------------

type SidebarFilter = "all" | "approved" | "wait";

function OkxWatchlistSidebar({
  candidates,
  signals,
  activeSymbol,
  isScanning,
  onScan,
  onSelect,
}: {
  candidates:   RankedCandidate[];
  signals:      Record<OkxSymbol, AgentSignal | null>;
  activeSymbol: OkxSymbol;
  isScanning:   boolean;
  onScan:       () => void;
  onSelect:     (symbol: OkxSymbol) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SidebarFilter>("all");

  const rows = candidates
    .map((c) => {
      const live = signals[c.symbol] ?? null;
      const direction = live?.direction ?? c.direction;
      const approved = live ? (live.direction !== null) : c.approved;
      const strength = live ? computeSignalStrength(live) : Math.round(c.signal_strength * 100);
      return { ...c, strength, direction, approved };
    })
    .filter((c) => c.symbol.toUpperCase().includes(search.trim().toUpperCase()))
    .filter((c) => {
      if (filter === "all") return true;
      if (filter === "approved") return c.approved;
      return !c.approved;
    })
    .sort((a, b) => b.strength - a.strength);

  const allCount = candidates.length;
  const approvedCount = candidates.filter(c => {
    const live = signals[c.symbol] ?? null;
    return live ? (live.direction !== null) : c.approved;
  }).length;
  const waitCount = allCount - approvedCount;

  const filterTabs: { key: SidebarFilter; label: string; dot: string }[] = [
    { key: "all",      label: `الكل (${allCount})`,   dot: "bg-muted-foreground/40" },
    { key: "approved", label: `معتمد (${approvedCount})`,  dot: "bg-emerald-400" },
    { key: "wait",     label: `انتظار (${waitCount})`, dot: "bg-rose-500" },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/25 bg-card/40 p-3 lg:max-h-[calc(100vh-220px)]">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث عن عملة..."
            className="w-full rounded-lg border border-border/30 bg-card/60 py-2 pl-3 pr-9 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-cyan-500/50 focus:outline-none"
          />
        </div>
        <button
          onClick={onScan}
          disabled={isScanning}
          title="مسح وتحديث السوق"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/30 bg-card/60 text-muted-foreground transition-colors hover:border-cyan-500/50 hover:text-cyan-400 disabled:opacity-50"
        >
          <RefreshCcw className={cn("h-4 w-4", isScanning && "animate-spin text-cyan-400")} />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors",
              filter === tab.key
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                : "border-border/25 bg-card/30 text-muted-foreground hover:text-foreground",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", tab.dot)} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 overflow-y-auto pr-0.5 lg:flex-1">
        {rows.length === 0 && (
          <p className="px-1 py-4 text-center text-[11px] text-muted-foreground/50">
            لا توجد عملات مطابقة
          </p>
        )}
        {rows.map((c) => {
          const meta     = getSymbolMeta(c.symbol);
          const isActive = c.symbol === activeSymbol;
          return (
            <button
              key={c.symbol}
              type="button"
              onClick={() => onSelect(c.symbol)}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-right transition-colors",
                isActive
                  ? meta.tabActive
                  : "border-border/20 bg-card/30 text-muted-foreground hover:border-border/40 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  c.direction === "BUY"
                    ? "bg-emerald-400"
                    : c.direction === "SELL"
                    ? "bg-rose-500"
                    : "bg-muted-foreground/30",
                )}
              />
              <div className="flex-1">
                <p
                  className={cn(
                    "text-xs font-bold tracking-wide",
                    isActive && meta.accent,
                  )}
                >
                  {meta.short}
                </p>
                <p className="text-[10px] text-muted-foreground/50">{c.symbol} - H1</p>
              </div>
              <span
                className={cn(
                  "shrink-0 text-xs font-black tabular-nums",
                  c.approved ? "text-emerald-400" : "text-muted-foreground",
                )}
              >
                {c.strength}%
              </span>
            </button>
          );
        })}
      </div>
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

  const [sidebarCandidates, setSidebarCandidates] = useState<RankedCandidate[]>([]);

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

  const [isScanning, setIsScanning] = useState(false);

  const loadSidebarCandidates = useCallback(async () => {
    try {
      const res = await fetch("/api/lab/ranked-candidates?source=okx", { cache: "no-store" });
      const body = await res.json();
      if (body.ok && Array.isArray(body.candidates)) {
        setSidebarCandidates(body.candidates);
      }
    } catch (err) {
      console.error("Failed to load OKX ranked candidates", err);
    }
  }, []);

  const handleScan = useCallback(async () => {
    setIsScanning(true);
    try {
      let allSymbols = Array.from(
        new Set([...sidebarCandidates.map((c) => c.symbol), ...symbolsList, activeSymbol])
      );
      if (allSymbols.length === 0) allSymbols = ["BTC-USDT", "ETH-USDT"];

      // 1. Force backend scan via real API calls (as requested)
      await Promise.allSettled(
        allSymbols.map(sym => 
          fetch('/api/lab/multi-timeframe-analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: sym })
          })
        )
      );

      // 2. Refresh Sidebar Candidates to reflect the newly updated SQLite DB
      await loadSidebarCandidates();
      
      // 3. Keep WebSocket stream alive
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "subscribe", symbols: allSymbols }));
      }
    } finally {
      setTimeout(() => setIsScanning(false), 1000);
    }
  }, [loadSidebarCandidates, sidebarCandidates, symbolsList, activeSymbol]);

  useEffect(() => {
    loadSidebarCandidates();
  }, [loadSidebarCandidates]);

  // Silent auto-scan every 60 seconds
  const handleScanRef = useRef(handleScan);
  useEffect(() => {
    handleScanRef.current = handleScan;
  }, [handleScan]);

  useEffect(() => {
    const id = setInterval(() => {
      handleScanRef.current();
    }, 60_000);
    return () => clearInterval(id);
  }, []);

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

  // اختر أول عملة في القائمة الجانبية تلقائياً عند تحميل الترشيح لأول مرة
  // إذا لم تكن العملة النشطة الحالية ضمن قائمة OKX المرشحة.
  useEffect(() => {
    if (sidebarCandidates.length === 0) return;
    if (sidebarCandidates.some((c) => c.symbol === activeSymbol)) return;
    setActiveSymbol(sidebarCandidates[0].symbol);
  }, [sidebarCandidates, activeSymbol]);

  // اشترك في تحديثات WebSocket اللحظية لكل عملات القائمة الجانبية بالإضافة
  // إلى قائمة المتابعة، لعرض القوة الحية لكل عملة في الشريط الجانبي.
  useEffect(() => {
    if (wsStatus !== "connected" || sidebarCandidates.length === 0) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    const allSymbols = Array.from(
      new Set([...sidebarCandidates.map((c) => c.symbol), ...symbolsList, activeSymbol]),
    );
    wsRef.current.send(JSON.stringify({ type: "subscribe", symbols: allSymbols }));
  }, [sidebarCandidates, wsStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectSymbol = useCallback((symbol: OkxSymbol) => {
    setActiveSymbol(symbol);
  }, []);

  const activeSignal  = signals[activeSymbol];
  const approvedCount = activeSignal
    ? activeSignal.votes.filter((v) => v.approved).length
    : 0;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-10">
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

      {/* اللوحة الجانبية المستقرة + مساحة العمل المركزية */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <aside className="lg:col-span-1">
          <OkxWatchlistSidebar
            candidates={sidebarCandidates}
            signals={signals}
            activeSymbol={activeSymbol}
            isScanning={isScanning}
            onScan={handleScan}
            onSelect={handleSelectSymbol}
          />
        </aside>

        <div className="flex flex-col gap-6 lg:col-span-3">
          {/* Crypto terminal card */}
          <section>
            <p className="mb-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground/55">
              قرار مجلس الوكلاء — {activeSymbol}
            </p>
            <CryptoTerminalCard signal={activeSignal} symbol={activeSymbol} />
          </section>

          {/* Live chart */}
          <section>
            <OkxChartAnalyzer symbol={activeSymbol} />
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
        </div>
      </div>

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
