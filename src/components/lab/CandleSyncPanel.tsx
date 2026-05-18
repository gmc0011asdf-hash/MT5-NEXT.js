"use client";

/**
 * CandleSyncPanel — Candle Close Auto Re-Analysis v1
 * ─────────────────────────────────────────────────────────────────────────────
 * لوحة "مزامنة التحليل مع إغلاق الشمعة":
 *   - عرض وقت إغلاق الشمعة القادمة + عداد تنازلي
 *   - خيار OFF افتراضي لإعادة التحليل تلقائياً
 *   - محرك واحد فقط بعد إغلاق الشمعة (لا polling)
 *   - إلغاء تلقائي عند تغيير الفريم أو إلغاء التفعيل
 *
 * ⚠️ CountdownTimer مكوّن مستقل — لا يُعيد تصيير AnalysisControlPanel.
 * ⚠️ لا order_send — لا Convex — لا polling متكرر.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  nextCandleCloseAt,
  msUntilNextClose,
  formatCountdown,
  formatTimestamp,
  tfPeriodMs,
  type AnalysisTrigger,
  type AnalysisMetadata,
  type AnalysisTimelineEntry,
  type SyncStatus,
  SYNC_STATUS_LABEL,
  TIMELINE_MAX,
  clearTimelineStorage,
} from "@/lib/gold/candle-close-timing";

// ─── CountdownTimer — isolated sub-component ─────────────────────────────────
// Only THIS component re-renders every second, protecting the parent.

function CountdownTimer({ targetMs }: { targetMs: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, targetMs - Date.now()));

  useEffect(() => {
    const id = setInterval(() => {
      const r = Math.max(0, targetMs - Date.now());
      setRemaining(r);
      if (r <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  return (
    <span className="font-mono font-bold text-amber-300/90 tabular-nums text-lg">
      {formatCountdown(remaining)}
    </span>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export type CandleSyncPanelProps = {
  selectedTimeframe:    string | null;
  symbol:               string;
  lastClosedCandleTime: number | null;
  analysisMetadata:     AnalysisMetadata | null;
  onTriggerAnalysis:    (trigger: "AUTO_CANDLE_CLOSE") => void;
  busy:                 boolean;
  timeline:             AnalysisTimelineEntry[];
  onClearTimeline:      () => void;
};

// ─── Candle verification (one-time fetch, no polling) ────────────────────────

async function verifyNewCandle(
  symbol:       string,
  tf:           string,
  lastClosedMs: number | null,
): Promise<boolean> {
  try {
    const url = `/api/mt5-readonly/candles?symbols=${encodeURIComponent(symbol)}&timeframes=${encodeURIComponent(tf)}&count=2`;
    const res  = await fetch(url, { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as { candles?: Array<{ time?: number; symbol?: string; timeframe?: string }> };
    const candles = data.candles ?? [];
    if (!candles.length) return false;

    const matching = candles.filter(
      (c) => c.symbol === symbol && c.timeframe === tf && typeof c.time === "number",
    );
    if (!matching.length) return false;

    // MT5 candle times are Unix seconds
    const latestMs = Math.max(...matching.map((c) => (c.time ?? 0) * 1000));
    return lastClosedMs == null || latestMs > lastClosedMs;
  } catch {
    return false;
  }
}

// ─── Sync status badge ────────────────────────────────────────────────────────

const STATUS_CLASS: Record<SyncStatus, string> = {
  MANUAL_ONLY:          "text-zinc-400 border-zinc-500/30 bg-zinc-500/10",
  WAITING_FOR_CLOSE:    "text-sky-300 border-sky-500/30 bg-sky-500/10",
  WAITING_FOR_MT5_DATA: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  ANALYZING:            "text-violet-300 border-violet-500/30 bg-violet-500/10",
  ANALYSIS_DONE:        "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  NO_NEW_CANDLE:        "text-amber-400 border-amber-500/30 bg-amber-500/10",
  ERROR:                "text-red-300 border-red-500/30 bg-red-500/10",
};

// ─── Main component ───────────────────────────────────────────────────────────

export function CandleSyncPanel({
  selectedTimeframe,
  symbol,
  lastClosedCandleTime,
  analysisMetadata,
  onTriggerAnalysis,
  busy,
  timeline,
  onClearTimeline,
}: CandleSyncPanelProps) {
  const [autoEnabled,      setAutoEnabled]      = useState(false);
  const [syncStatus,       setSyncStatus]       = useState<SyncStatus>("MANUAL_ONLY");
  const [nextCloseAt,      setNextCloseAt]      = useState<number | null>(null);
  const [showTimeline,     setShowTimeline]      = useState(false);

  // Ref to count re-schedules after analysis done — triggers main effect re-run
  const [rescheduleCount, setRescheduleCount]   = useState(0);

  // Refs for cleanup
  const timerARef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const timerBRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevBusyRef = useRef(busy);
  const syncRef     = useRef(syncStatus);
  const triggerRef  = useRef(onTriggerAnalysis);

  useEffect(() => { syncRef.current = syncStatus; },       [syncStatus]);
  useEffect(() => { triggerRef.current = onTriggerAnalysis; }, [onTriggerAnalysis]);

  // ── Detect analysis completion (busy: true → false while ANALYZING) ────────
  useEffect(() => {
    const wasAnalyzing = prevBusyRef.current && !busy && syncRef.current === "ANALYZING";
    prevBusyRef.current = busy;

    if (wasAnalyzing) {
      setSyncStatus("ANALYSIS_DONE");
      // Re-schedule next timer if still auto
      if (autoEnabled && selectedTimeframe) {
        setRescheduleCount((c) => c + 1);
      }
    }
  }, [busy, autoEnabled, selectedTimeframe]);

  // ── Main scheduling effect ─────────────────────────────────────────────────
  const lastClosedRef = useRef(lastClosedCandleTime);
  useEffect(() => { lastClosedRef.current = lastClosedCandleTime; }, [lastClosedCandleTime]);

  useEffect(() => {
    // Cancel previous timers on every run
    clearTimeout(timerARef.current);
    clearTimeout(timerBRef.current);

    if (!autoEnabled || !selectedTimeframe) {
      setNextCloseAt(null);
      setSyncStatus(autoEnabled ? "WAITING_FOR_CLOSE" : "MANUAL_ONLY");
      return;
    }

    const next = nextCandleCloseAt(selectedTimeframe);
    if (!next) return;

    setNextCloseAt(next);
    setSyncStatus("WAITING_FOR_CLOSE");

    // Capture values at timer setup (not from closure — prevents stale reads)
    const capturedLastClosed = lastClosedRef.current;
    const capturedSymbol     = symbol;
    const capturedTF         = selectedTimeframe;

    let cancelled = false;

    async function doCheck() {
      if (cancelled) return;
      setSyncStatus("WAITING_FOR_MT5_DATA");

      try {
        const hasNew = await verifyNewCandle(capturedSymbol, capturedTF, capturedLastClosed);
        if (cancelled) return;

        if (hasNew) {
          setSyncStatus("ANALYZING");
          triggerRef.current("AUTO_CANDLE_CLOSE");
        } else {
          // Retry ONCE after 5 seconds — no further retries
          timerBRef.current = setTimeout(async () => {
            if (cancelled) return;
            try {
              const hasNew2 = await verifyNewCandle(capturedSymbol, capturedTF, capturedLastClosed);
              if (cancelled) return;
              if (hasNew2) {
                setSyncStatus("ANALYZING");
                triggerRef.current("AUTO_CANDLE_CLOSE");
              } else {
                setSyncStatus("NO_NEW_CANDLE");
              }
            } catch {
              if (!cancelled) setSyncStatus("ERROR");
            }
          }, 5_000);
        }
      } catch {
        if (!cancelled) setSyncStatus("ERROR");
      }
    }

    // Fire 2 seconds after close to give MT5 time to commit data
    const delay = Math.max(0, next - Date.now()) + 2_000;
    timerARef.current = setTimeout(() => { void doCheck(); }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timerARef.current);
      clearTimeout(timerBRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEnabled, selectedTimeframe, rescheduleCount]); // rescheduleCount triggers re-schedule

  // ── Handle auto toggle ─────────────────────────────────────────────────────
  const handleToggleAuto = useCallback(() => {
    setAutoEnabled((prev) => {
      if (!prev) {
        // Turning ON
        setSyncStatus("WAITING_FOR_CLOSE");
      } else {
        // Turning OFF
        clearTimeout(timerARef.current);
        clearTimeout(timerBRef.current);
        setSyncStatus("MANUAL_ONLY");
        setNextCloseAt(null);
      }
      return !prev;
    });
  }, []);

  // ── Display values ─────────────────────────────────────────────────────────
  const tfLabel          = selectedTimeframe ?? "—";
  const isKnownTF        = selectedTimeframe ? tfPeriodMs(selectedTimeframe) !== null : false;
  const msLeft           = selectedTimeframe ? (msUntilNextClose(selectedTimeframe) ?? 0) : 0;
  const lastAnalysisTime = analysisMetadata?.completedAtLocal ?? analysisMetadata?.requestedAtLocal ?? null;
  const closedCandleTime = analysisMetadata?.mt5LastClosedCandleTime ?? null;
  const trigger          = analysisMetadata?.trigger ?? "MANUAL";
  const delayMs          = analysisMetadata?.delayAfterCloseMs;

  return (
    <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4 space-y-4" dir="rtl">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-amber-200/90">مزامنة التحليل مع إغلاق الشمعة</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            الفريم: <span className="font-mono text-amber-300/80">{tfLabel}</span>
            {" · "}مصدر الوقت: متصفح (UTC)
          </p>
        </div>
        <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[syncStatus]}`}>
          {SYNC_STATUS_LABEL[syncStatus]}
        </span>
      </div>

      {/* ── Countdown ──────────────────────────────────────────────────────── */}
      {isKnownTF && nextCloseAt && autoEnabled ? (
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-4 py-3 text-center space-y-1">
          <p className="text-[10px] text-muted-foreground">إعادة التحليل القادمة بعد إغلاق شمعة {tfLabel}</p>
          <CountdownTimer targetMs={nextCloseAt} />
          <p className="text-[9px] text-muted-foreground/60">
            {new Date(nextCloseAt).toLocaleTimeString("ar-SA", { hour12: false })} UTC
          </p>
        </div>
      ) : isKnownTF && !autoEnabled ? (
        <div className="rounded-lg border border-border/20 bg-background/20 px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">وقت إغلاق الشمعة القادمة</span>
          <span className="font-mono text-xs text-foreground/70">
            {selectedTimeframe
              ? new Date(nextCandleCloseAt(selectedTimeframe) ?? 0).toLocaleTimeString("ar-SA", { hour12: false })
              : "—"
            }
            {" · "}
            <span className="text-amber-300/70">{msLeft > 0 ? formatCountdown(msLeft) : "—"}</span>
          </span>
        </div>
      ) : (
        <div className="text-[10px] text-muted-foreground/60 text-center py-1">
          الفريم المختار غير معروف — اختر فريماً محدداً لحساب توقيت الإغلاق
        </div>
      )}

      {/* ── Auto Re-Analysis Toggle ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-foreground/80">إعادة التحليل تلقائيًا عند إغلاق الشمعة</p>
          <p className="text-[9px] text-muted-foreground/60">
            {autoEnabled
              ? "مفعّل — تحليل واحد بعد كل إغلاق (+2 ث انتظار)"
              : "معطّل (افتراضي) — اضغط التحليل يدوياً"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggleAuto}
          disabled={busy || !isKnownTF}
          className={`
            relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors
            ${autoEnabled ? "bg-amber-500/60 border border-amber-500/50" : "bg-zinc-700/60 border border-zinc-600/50"}
            ${busy || !isKnownTF ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
          `}
          aria-label="تبديل التحليل التلقائي"
        >
          <span className={`
            inline-block h-4 w-4 rounded-full transition-transform bg-white/90 shadow-sm
            ${autoEnabled ? "translate-x-[22px]" : "translate-x-[2px]"}
          `} />
        </button>
      </div>

      {/* ── Last analysis info ─────────────────────────────────────────────── */}
      {analysisMetadata && (
        <div className="rounded-md border border-border/20 bg-background/20 px-3 py-2 space-y-1">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1.5">آخر تحليل</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <div className="flex justify-between gap-1">
              <span className="text-[10px] text-muted-foreground">الوقت</span>
              <span className="text-[10px] font-mono text-foreground/80">{formatTimestamp(lastAnalysisTime)}</span>
            </div>
            <div className="flex justify-between gap-1">
              <span className="text-[10px] text-muted-foreground">trigger</span>
              <span className={`text-[10px] font-semibold ${trigger === "AUTO_CANDLE_CLOSE" ? "text-violet-300" : "text-sky-300"}`}>
                {trigger === "AUTO_CANDLE_CLOSE" ? "تلقائي" : "يدوي"}
              </span>
            </div>
            <div className="flex justify-between gap-1">
              <span className="text-[10px] text-muted-foreground">الشمعة المعتمدة</span>
              <span className="text-[10px] font-mono text-foreground/70">{formatTimestamp(closedCandleTime)}</span>
            </div>
            {delayMs != null && (
              <div className="flex justify-between gap-1">
                <span className="text-[10px] text-muted-foreground">تأخير بعد الإغلاق</span>
                <span className="text-[10px] font-mono text-amber-300/80">{(delayMs / 1000).toFixed(1)} ث</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Open candle warning ──────────────────────────────────────────────── */}
      <div className="text-[10px] text-amber-200/60 leading-relaxed">
        الشمعة الحالية للمراقبة فقط — التحليل يعتمد دائماً على آخر شمعة مغلقة
      </div>

      {/* ── Timeline (collapsible) ──────────────────────────────────────────── */}
      <div className="border-t border-border/20 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowTimeline((p) => !p)}
            className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground/60 flex items-center gap-1"
          >
            <span>{showTimeline ? "▾" : "▸"}</span>
            سجل التوقيت ({timeline.length}/{TIMELINE_MAX})
          </button>
          {timeline.length > 0 && (
            <button
              type="button"
              onClick={() => onClearTimeline()}
              className="text-[10px] text-red-300/60 hover:text-red-300 transition-colors"
            >
              مسح السجل ✕
            </button>
          )}
        </div>

        {showTimeline && timeline.length > 0 && (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {timeline.map((entry) => (
              <div
                key={entry.id}
                className="rounded-md border border-border/20 bg-background/20 px-3 py-1.5 space-y-0.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono text-foreground/70">
                    {formatTimestamp(entry.requestedAt)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-muted-foreground font-mono">{entry.timeframe ?? "—"}</span>
                    <span className={`text-[9px] ${entry.trigger === "AUTO_CANDLE_CLOSE" ? "text-violet-300" : "text-sky-300"}`}>
                      {entry.trigger === "AUTO_CANDLE_CLOSE" ? "تلقائي" : "يدوي"}
                    </span>
                    {entry.recommendation && (
                      <span className="text-[9px] text-amber-300/70">{entry.recommendation}</span>
                    )}
                  </div>
                </div>
                {(entry.direction || entry.grade) && (
                  <div className="flex gap-2 text-[9px] text-muted-foreground/70">
                    {entry.direction && <span>اتجاه: {entry.direction === "bullish" ? "↑" : "↓"}</span>}
                    {entry.grade && <span>درجة: {entry.grade}</span>}
                    {entry.confidence != null && <span>ثقة: {entry.confidence}%</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {showTimeline && timeline.length === 0 && (
          <p className="text-[10px] text-muted-foreground/50 text-center py-2">لا يوجد سجل بعد</p>
        )}
      </div>
    </div>
  );
}
