/**
 * candle-close-timing.ts — Candle Close Auto Re-Analysis v1
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure utilities:
 *   - حساب وقت إغلاق الشمعة القادم (UTC-aligned)
 *   - تنسيق العداد التنازلي
 *   - أنواع metadata وتسجيل التحليل
 *   - localStorage helpers
 *
 * ⚠️ لا تنفيذ تداول — لا order_send — لا Convex — قراءة وحساب فقط.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Timeframe periods ────────────────────────────────────────────────────────

export const TF_PERIOD_MS: Record<string, number> = {
  M1:  60_000,
  M5:  300_000,
  M15: 900_000,
  M30: 1_800_000,
  H1:  3_600_000,
  H4:  14_400_000,
  D1:  86_400_000,
};

/** Returns the candle period in ms for a TF string, or null if unknown. */
export function tfPeriodMs(tf: string): number | null {
  return TF_PERIOD_MS[tf] ?? null;
}

/** Returns the Unix-ms timestamp of the next candle close (UTC-aligned). */
export function nextCandleCloseAt(tf: string, nowMs = Date.now()): number | null {
  const p = tfPeriodMs(tf);
  if (!p) return null;
  return Math.ceil(nowMs / p) * p;
}

/** Returns milliseconds until the next candle close, or null if TF unknown. */
export function msUntilNextClose(tf: string, nowMs = Date.now()): number | null {
  const next = nextCandleCloseAt(tf, nowMs);
  if (next == null) return null;
  return Math.max(0, next - nowMs);
}

/** Format a millisecond duration as "HH:MM:SS" or "MM:SS". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  if (h > 0) return `${h.toString().padStart(2, "0")}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

/** Human-readable duration label for each TF. */
export const TF_DURATION_LABEL: Record<string, string> = {
  M1:  "دقيقة واحدة",
  M5:  "5 دقائق",
  M15: "15 دقيقة",
  M30: "30 دقيقة",
  H1:  "ساعة واحدة",
  H4:  "4 ساعات",
  D1:  "يوم واحد",
};

/** Format a Unix-ms timestamp as a readable time string. */
export function formatTimestamp(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ─── Analysis trigger and state types ────────────────────────────────────────

export type AnalysisTrigger = "MANUAL" | "AUTO_CANDLE_CLOSE";

export type SyncStatus =
  | "MANUAL_ONLY"
  | "WAITING_FOR_CLOSE"
  | "WAITING_FOR_MT5_DATA"
  | "ANALYZING"
  | "ANALYSIS_DONE"
  | "NO_NEW_CANDLE"
  | "ERROR";

export const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  MANUAL_ONLY:          "يدوي فقط",
  WAITING_FOR_CLOSE:    "انتظار إغلاق الشمعة",
  WAITING_FOR_MT5_DATA: "بانتظار تحديث MT5",
  ANALYZING:            "جارٍ التحليل...",
  ANALYSIS_DONE:        "تم التحليل ✓",
  NO_NEW_CANDLE:        "لم تصل شمعة جديدة من MT5",
  ERROR:                "خطأ في التحقق",
};

export type AnalysisMetadata = {
  trigger:                 AnalysisTrigger;
  requestedAtLocal:        number;
  completedAtLocal:        number | null;
  mt5LastClosedCandleTime: number | null;
  mt5NextCandleCloseTime:  number | null;
  timeframe:               string | null;
  symbol:                  string;
  delayAfterCloseMs:       number | null;
};

// ─── Timeline (localStorage) ──────────────────────────────────────────────────

export type AnalysisTimelineEntry = {
  id:               string;
  symbol:           string;
  timeframe:        string | null;
  trigger:          AnalysisTrigger;
  requestedAt:      number;
  completedAt:      number | null;
  closedCandleTime: number | null;
  direction:        string | null;
  grade:            string | null;
  confidence:       number | null;
  recommendation:   string | null;
};

export const TIMELINE_KEY = "gold-analysis-timeline";
export const TIMELINE_MAX = 10;

export function loadTimeline(): AnalysisTimelineEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TIMELINE_KEY);
    return raw ? (JSON.parse(raw) as AnalysisTimelineEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveToTimeline(
  current: AnalysisTimelineEntry[],
  entry: AnalysisTimelineEntry,
): AnalysisTimelineEntry[] {
  const next = [entry, ...current].slice(0, TIMELINE_MAX);
  if (typeof window !== "undefined") {
    try { localStorage.setItem(TIMELINE_KEY, JSON.stringify(next)); } catch { /* quota */ }
  }
  return next;
}

export function clearTimelineStorage(): void {
  if (typeof window !== "undefined") {
    try { localStorage.removeItem(TIMELINE_KEY); } catch { /* ignore */ }
  }
}
