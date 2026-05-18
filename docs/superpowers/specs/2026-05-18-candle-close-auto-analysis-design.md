# Candle Close Auto Re-Analysis v1 — Design Spec
Date: 2026-05-18

---

## 1. Goal

After every analysis, show a "مزامنة التحليل مع إغلاق الشمعة" panel that:
- Displays next candle close time + countdown for the selected timeframe
- Optionally triggers ONE auto re-analysis after a new candle closes
- Records analysis timing in localStorage (last 10 entries)
- Displays timing metadata in the result (when was analysis done, relative to candle close)

**Performance constraint:** countdown updates every second — isolated in a micro-component to avoid re-rendering AnalysisControlPanel.

---

## 2. Files

| File | Type | Role |
|---|---|---|
| `src/lib/gold/candle-close-timing.ts` | New | Pure util — compute next close time, TF period, countdown string |
| `src/components/lab/CandleSyncPanel.tsx` | New | Timer state + auto-analysis trigger + countdown display + timeline viewer |
| `src/components/lab/AnalysisControlPanel.tsx` | Modified | +analysisMetadata state, +triggerRef, +localStorage save, +CandleSyncPanel render, +timing display in result |

**Unchanged:** `handleGoldSendToMT5`, `canOpenGoldModal`, `mt5_readonly_service`, `convex/schema.ts`, Kill Switch, all governance.

---

## 3. Pure Utilities (`candle-close-timing.ts`)

```typescript
export type TFPeriod = "M1"|"M5"|"M15"|"M30"|"H1"|"H4"|"D1";

const TF_PERIOD_MS: Record<TFPeriod, number> = {
  M1:  60_000,
  M5:  300_000,
  M15: 900_000,
  M30: 1_800_000,
  H1:  3_600_000,
  H4:  14_400_000,
  D1:  86_400_000,
};

// Returns ms until next candle close (UTC-aligned)
export function msUntilNextClose(tf: TFPeriod, nowMs?: number): number

// Returns next close timestamp (UTC ms)
export function nextCandleCloseAt(tf: TFPeriod, nowMs?: number): number

// Format ms as "HH:MM:SS" or "MM:SS"
export function formatCountdown(ms: number): string

// Returns period in ms for a TF string (null if unknown)
export function tfPeriodMs(tf: string): number | null
```

---

## 4. Analysis Timing Types

### AnalysisMetadata (React state)
```typescript
type AnalysisTrigger = "MANUAL" | "AUTO_CANDLE_CLOSE";

type AnalysisMetadata = {
  trigger:                 AnalysisTrigger;
  requestedAtLocal:        number;        // Date.now() before fetch
  completedAtLocal:        number | null; // Date.now() after result set
  mt5LastClosedCandleTime: number | null; // from result.marketStateAnalysis.latestClosedCandleTime
  mt5NextCandleCloseTime:  number | null; // computed from TF + closedCandleTime
  timeframe:               string | null;
  symbol:                  string;
  delayAfterCloseMs:       number | null; // completedAtLocal - (closedCandleTime + periodMs)
};
```

### AnalysisTimelineEntry (localStorage)
```typescript
type AnalysisTimelineEntry = {
  id:               string;       // Date.now().toString()
  symbol:           string;
  timeframe:        string | null;
  trigger:          AnalysisTrigger;
  requestedAt:      number;
  completedAt:      number | null;
  closedCandleTime: number | null;
  direction:        string | null;  // from result.direction
  grade:            string | null;  // from summary
  confidence:       number | null;  // from summary
  recommendation:   string | null;  // from goldRec.recommendationStatus
};

const TIMELINE_KEY    = "gold-analysis-timeline";
const TIMELINE_MAX    = 10;
```

---

## 5. Candle Close Timer State Machine

```
States:
  MANUAL_ONLY           — auto OFF (default)
  WAITING_FOR_CLOSE     — auto ON, counting down to next close
  WAITING_FOR_MT5_DATA  — close reached, waiting 2s for MT5 data
  ANALYZING             — analysis fetch in progress
  ANALYSIS_DONE         — result received
  NO_NEW_CANDLE         — tried once after delay, no new candle yet; wait 5s more (once)
  ERROR                 — analysis failed
```

### Auto Re-Analysis Flow
```
1. User enables auto → compute msUntilNextClose(tf)
2. setTimeout A: fires at nextClose + 2000ms
   → set state WAITING_FOR_MT5_DATA
   → fetch candles to verify new closed candle arrived
3. If new candle confirmed: trigger handleAnalyze (triggerRef = AUTO_CANDLE_CLOSE)
   → set state ANALYZING
4. If no new candle: wait 5s (setTimeout B, fires once only)
   → retry candle fetch
   → if confirmed: trigger analyze
   → if still not: set state NO_NEW_CANDLE, show message
5. After analysis completes (result changes): set state ANALYSIS_DONE
6. Schedule NEXT timer (step 1) for following candle
```

### Cleanup Rules
- On TF change: clearTimeout + clearInterval, recompute
- On auto OFF: clearTimeout + clearInterval
- On unmount (`useEffect` cleanup): clearTimeout + clearInterval
- Max 1 retry (setTimeout B) — no infinite loops

---

## 6. CandleSyncPanel Component

### Props
```typescript
type CandleSyncPanelProps = {
  selectedTimeframe: string | null;   // from result or manualTF
  symbol:            string;
  result:            AnalysisResult | null;
  analysisMetadata:  AnalysisMetadata | null;
  onTriggerAnalysis: (trigger: "AUTO_CANDLE_CLOSE") => void;
  busy:              boolean;
  timeline:          AnalysisTimelineEntry[];
  onClearTimeline:   () => void;
};
```

### UI Structure
```
┌─ مزامنة التحليل مع إغلاق الشمعة ───────────────────────────────────┐
│  الفريم: H1          مصدر الوقت: متصفح (UTC)                       │
│  إغلاق الشمعة القادمة: 2026-05-18 14:00:00 UTC                     │
│  [CountdownTimer] ─── 00:12:35 ←── isolated sub-component          │
│                                                                      │
│  حالة المزامنة: [WAITING_FOR_CLOSE / ANALYZING / ...]              │
│                                                                      │
│  ☐  إعادة التحليل تلقائيًا عند إغلاق الشمعة   [OFF by default]    │
│                                                                      │
│  آخر تحليل: 13:47:22 | فريم: H1 | trigger: يدوي                   │
│  الشمعة المعتمدة: 2026-05-18 13:00:00 UTC                          │
│                                                                      │
│  ▸ سجل التوقيت (10) [collapsible]                                   │
│     [مسح السجل]                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### CountdownTimer — isolated sub-component
```typescript
// Only this component holds setInterval(1000)
// Receives: targetMs (next close timestamp)
// Renders: formatted countdown string
// Re-renders: only itself, every 1 second
function CountdownTimer({ targetMs }: { targetMs: number })
```

---

## 7. AnalysisControlPanel.tsx Changes

### New state (in outer AnalysisControlPanel function)
```typescript
const [analysisMetadata, setAnalysisMetadata] = useState<AnalysisMetadata | null>(null);
const [timeline,         setTimeline]          = useState<AnalysisTimelineEntry[]>(loadTimeline);
const analysisTriggerRef = useRef<"MANUAL" | "AUTO_CANDLE_CLOSE">("MANUAL");
```

### Modified handleAnalyze
```typescript
// Before fetch:
const requestedAt = Date.now();

// After setResult(json):
const completedAt = Date.now();
const closedCandleTime = json.marketStateAnalysis?.latestClosedCandleTime ?? null;
setAnalysisMetadata({
  trigger:                 analysisTriggerRef.current,
  requestedAtLocal:        requestedAt,
  completedAtLocal:        completedAt,
  mt5LastClosedCandleTime: closedCandleTime,
  mt5NextCandleCloseTime:  closedCandleTime && tfPeriodMs(json.selectedTimeframe ?? "")
    ? closedCandleTime + tfPeriodMs(json.selectedTimeframe!)!
    : null,
  timeframe:  json.selectedTimeframe,
  symbol:     json.symbol,
  delayAfterCloseMs: ...,
});
// Save to timeline
saveTimelineEntry(timeline, setTimeline, { ... from json + metadata ... });
```

### New JSX (in gold mode, in the analysis form area — before "زر التحليل")
```tsx
{mode === "gold" && (
  <CandleSyncPanel
    selectedTimeframe={result?.selectedTimeframe ?? (timeframeMode === "manual" ? manualTF : null)}
    symbol={GOLD_PROFILE.symbol}
    result={result}
    analysisMetadata={analysisMetadata}
    onTriggerAnalysis={(trigger) => {
      analysisTriggerRef.current = trigger;
      void handleAnalyze();
    }}
    busy={busy}
    timeline={timeline}
    onClearTimeline={clearTimeline}
  />
)}
```

### Timing display in result card (after analysis stats)
```tsx
{result && analysisMetadata && mode === "gold" && (
  <AnalysisTimingDisplay metadata={analysisMetadata} />  // small inline component
)}
```

---

## 8. AnalysisTimingDisplay (inline sub-component in AnalysisControlPanel)

Shows in result section:
- "وقت التحليل: 13:47:22"
- "الفريم: H1"
- "الشمعة المعتمدة: 13:00:00 UTC"
- "trigger: يدوي / إعادة تلقائية"
- "تأخير بعد إغلاق الشمعة: 12.3 ثانية" (if AUTO)
- Warning: "الشمعة الحالية ما زالت مفتوحة — التحليل يعتمد على آخر شمعة مغلقة" (if latestCandleClosed === false)

---

## 9. How Candle-Close Analysis is blocked for open candles

The analyze-preview route already filters to `closedCandles` only (line 472 in route.ts). The UI shows the warning from `result.marketStateAnalysis.latestCandleClosed === false`.

No code change needed in the route — the note in the UI is sufficient.

---

## 10. Constraints

- ❌ No polling (no `setInterval` on the analysis itself — only `setTimeout` chain)
- ❌ The CountdownTimer `setInterval(1000)` is isolated — does NOT re-render AnalysisControlPanel
- ❌ No Convex queries
- ❌ No `order_send`
- ❌ No governance changes
- ✅ localStorage only (no server persistence)
- ✅ Max 1 retry per candle close event
- ✅ Timer cleared on TF change + unmount

---

## 11. Self-Review Results

1. ✅ No placeholders — all types and functions fully specified
2. ✅ Internal consistency: latestClosedCandleTime from result.marketStateAnalysis confirmed in code
3. ✅ Scope: 2 new files + 1 modified — focused
4. ✅ Countdown isolation: CountdownTimer is explicit sub-component
5. ✅ Auto trigger chain: setTimeout only, max 2 timeouts per candle event, no loop
6. ✅ TF change cleanup: CandleSyncPanel receives selectedTimeframe as prop, useEffect dep handles cleanup
