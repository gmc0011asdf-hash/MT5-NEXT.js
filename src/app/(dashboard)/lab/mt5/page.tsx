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
  X,
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
  metadata?:  Record<string, unknown>;
}

interface AgentSignal {
  type:            "agent_signal";
  symbol:          string;
  direction:       Direction;
  signal_strength: number;
  entry:           number | null;
  sl:              number | null;
  tp:              number | null;
  theoretical_sl:  number | null;
  theoretical_tp:  number | null;
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

// Arabic labels for raw agent metadata (ICT / risk / momentum / volatility metrics)
const METADATA_LABELS: Record<string, string> = {
  ema50:         "EMA 50",
  ema200:        "EMA 200",
  close:         "السعر الحالي",
  recent_high:   "أعلى سعر (النطاق)",
  recent_low:    "أدنى سعر (النطاق)",
  bullish_fvg:   "فجوة سعرية صعودية (FVG)",
  bearish_fvg:   "فجوة سعرية هبوطية (FVG)",
  bullish_bos:   "كسر هيكل صعودي (BOS)",
  bearish_bos:   "كسر هيكل هبوطي (BOS)",
  bullish_sweep: "اجتياح سيولة صعودي",
  bearish_sweep: "اجتياح سيولة هبوطي",
  atr:           "ATR",
  entry:         "سعر الدخول",
  sl:            "وقف الخسارة",
  tp:            "الهدف",
  rr:            "نسبة المخاطرة/الربح RR",
  risk:          "المخاطرة ($)",
  profit:        "الربح المتوقع ($)",
  duration:      "المدة المتوقعة",
  bb_upper:      "Bollinger العلوي",
  bb_lower:      "Bollinger السفلي",
  rsi:           "RSI (14)",
};

function formatMetadataValue(val: unknown): string {
  if (typeof val === "boolean") return val ? "نعم" : "لا";
  if (typeof val === "number") return Number.isFinite(val) ? val.toFixed(2) : "--";
  if (val == null) return "--";
  return String(val);
}

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
// Simulate Entry Modal
// ---------------------------------------------------------------------------

function _formatCryptoPrice(val: number | null): string {
  if (val == null) return "--";
  return val.toFixed(2);
}

function SimulateEntryModal({
  signal,
  symbol,
  onClose,
}: {
  signal: AgentSignal | null;
  symbol: string;
  onClose: () => void;
}) {
  const [direction, setDirection]   = useState<"BUY" | "SELL">(signal?.direction === "SELL" ? "SELL" : "BUY");
  const [entryPrice, setEntryPrice] = useState(signal?.entry != null ? String(signal.entry) : "");
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
          source:         "mt5",
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
            محاكاة دخول صفقة — {symbol}
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
              className="w-full rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-xs font-mono text-foreground focus:border-amber-500/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground">حجم اللوت</label>
            <input
              type="number"
              value={lotSize}
              onChange={(e) => setLotSize(e.target.value)}
              className="w-full rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-xs font-mono text-foreground focus:border-amber-500/50 focus:outline-none"
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
              className="w-full rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-xs text-foreground focus:border-amber-500/50 focus:outline-none"
            />
          </div>

          <div className="col-span-2">
            <label className="mb-1 block text-[10px] text-muted-foreground">أسباب الدخول الفنية (Reasons for Entry)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-border/30 bg-card/50 px-3 py-2 text-xs text-foreground focus:border-amber-500/50 focus:outline-none"
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
            className="flex-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
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
// Master Terminal Card
// ---------------------------------------------------------------------------

function TerminalCard({ signal, symbol }: { signal: AgentSignal | null; symbol: string }) {
  const dir = signal?.direction ?? null;
  const [showSimulateModal, setShowSimulateModal] = useState(false);

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

  // عند الموافقة (signal_strength > 0) تُعرض القوة الإجمالية المعتمدة كما هي.
  // عند الانتظار/الرفض (الفيتو)، تُعرض القوة الفنية الخام كمتوسط ثقة الوكلاء
  // الذين صوّتوا بالموافقة -- مع بقاء لافتة "انتظار" الحمراء كما هي.
  const strength = (() => {
    if (!signal) return 0;
    if (signal.signal_strength > 0) return Math.round(signal.signal_strength * 100);
    const approvedVotes = signal.votes.filter((v) => v.approved);
    if (approvedVotes.length === 0) return 0;
    const avgConfidence =
      approvedVotes.reduce((sum, v) => sum + v.confidence, 0) / approvedVotes.length;
    return Math.round(avgConfidence * 100);
  })();

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
      ) : signal && (signal.theoretical_sl != null || signal.theoretical_tp != null) ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-3 opacity-60">
            {[
              { key: "sl",  label: "وقف نظري SL", val: signal.theoretical_sl, color: "text-rose-400"    },
              { key: "tp",  label: "هدف نظري TP",  val: signal.theoretical_tp, color: "text-emerald-400" },
              { key: "atr", label: "ATR (تقلب)",    val: signal.atr,            color: "text-amber-400"   },
            ].map(({ key, label, val, color }) => (
              <div
                key={key}
                className="rounded-xl border border-dashed border-border/25 bg-card/30 px-3 py-3 text-center"
              >
                <p className="text-[10px] leading-tight text-muted-foreground/70 mb-1">{label}</p>
                <p className={cn("text-sm font-bold tabular-nums", color)}>
                  {val != null ? val.toFixed(2) : "--"}
                </p>
              </div>
            ))}
          </div>
          <p className="text-center text-[10px] text-muted-foreground/40">
            مستويات نظرية لأغراض معلوماتية فقط — المجلس في وضع الانتظار (WAIT) ولم يعتمد الإشارة
          </p>
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

      {/* Timestamp & Actions */}
      <div className="mt-4 flex flex-col items-center gap-3">
        {signal?.ts && (
          <p className="text-center text-[10px] text-muted-foreground/50 tabular-nums">
            آخر إشارة: {new Date(signal.ts).toLocaleTimeString("ar-SA")}
          </p>
        )}

        {symbol && (
          <button
            type="button"
            onClick={() => setShowSimulateModal(true)}
            className="w-full sm:w-auto rounded-lg border border-amber-500/30 bg-amber-500/10 px-6 py-2.5 text-xs font-bold text-amber-300 transition-colors hover:bg-amber-500/20"
          >
            محاكاة دخول الصفقة
          </button>
        )}
      </div>

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

      {/* Raw metrics (ICT / ATR / RR / RSI / Bollinger) -- diagnostic only */}
      {vote.metadata && Object.keys(vote.metadata).length > 0 && (
        <div className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-border/20 pt-2">
          {Object.entries(vote.metadata).map(([key, val]) => (
            <div key={key} className="flex items-center justify-between gap-1">
              <span className="text-[9px] text-muted-foreground/50">
                {METADATA_LABELS[key] ?? key}
              </span>
              <span className="font-mono text-[9px] font-semibold text-muted-foreground/80 tabular-nums">
                {formatMetadataValue(val)}
              </span>
            </div>
          ))}
        </div>
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
