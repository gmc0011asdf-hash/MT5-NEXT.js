# Candle Sync Fix + Plan Binding + Experimental Execution Policy
Date: 2026-05-18

---

## Part 1 — Candle Sync Display Fix v1

**File:** `src/components/lab/CandleSyncPanel.tsx` only.
No logic changes — display improvements only.

### Changes
1. Show TF duration label: "H1 — مدة الفريم: ساعة واحدة"
2. Replace raw `formatCountdown()` output with full label:
   "المتبقي حتى إغلاق شمعة H1: 00:13:21"
3. Show next close time in TWO formats:
   - Local time: `HH:MM:SS`
   - UTC below it: `UTC: HH:MM`
4. When remaining time < full TF period (always true mid-candle), add note:
   "هذا وقت الشمعة الحالية — ليس مدة الفريم الكاملة"
5. TF duration labels: M1=دقيقة, M5=5 دقائق, M15=15 دقيقة, M30=30 دقيقة,
   H1=ساعة, H4=4 ساعات, D1=يوم

---

## Part 2 — Gold Selected Plan Execution Binding v1

### Files changed
- `src/components/lab/GoldTradePlanSelector.tsx`
- `src/components/lab/AnalysisControlPanel.tsx` (inside `TradePreviewPanel`)

### 2.1 selectedGoldPlan state (in TradePreviewPanel)

```typescript
const [selectedGoldPlan, setSelectedGoldPlan] = useState<TradePlan | null>(null);
```

**Auto-select:** When `goldPlans` changes, auto-select BALANCED if it's EXECUTION_READY or REVIEW:
```typescript
useEffect(() => {
  if (!goldPlans) return;
  const balanced = goldPlans.plans.find(p => p.planType === "BALANCED");
  if (balanced && (balanced.proposalStatus === "EXECUTION_READY" || balanced.proposalStatus === "REVIEW")) {
    setSelectedGoldPlan(balanced);
  }
}, [goldPlans]);
```

### 2.2 GoldTradePlanSelector — new prop
```typescript
onSelectPlan: (plan: TradePlan | null) => void;
```
- Called when user clicks a plan button: `onSelectPlan(plan)`
- Called with `null` when user clicks "إلغاء الاختيار"

### 2.3 effectivePreview (computed in TradePreviewPanel)
When `selectedGoldPlan` is set:
```typescript
const effectivePreview = useMemo(() => {
  if (!selectedGoldPlan || !selectedGoldPlan.entry || !selectedGoldPlan.stopLoss || !selectedGoldPlan.takeProfit2) {
    return preview; // fallback to original
  }
  return {
    ...preview,
    entry:        selectedGoldPlan.entry,
    stopLoss:     selectedGoldPlan.stopLoss,
    takeProfit:   selectedGoldPlan.takeProfit2,   // TP2 = main target
    estimatedLot: selectedGoldPlan.estimatedLot ?? preview.estimatedLot,
    riskUsd:      selectedGoldPlan.suggestedRiskUsd,
    rrRatio:      selectedGoldPlan.rr2 ?? preview.rrRatio,
  } satisfies typeof preview;
}, [selectedGoldPlan, preview]);
```

### 2.4 canOpenGoldModal — UNCHANGED
Still uses original `preview`. Not affected by `effectivePreview`.
(The user explicitly said: لا تغيّر canOpenGoldModal)

### 2.5 handleGoldSendToMT5 — use effectivePreview
Change `buildExecutionRequestPreview(result, preview, eligibility)` to
`buildExecutionRequestPreview(result, effectivePreview, eligibility)`.

### 2.6 UI: show selected plan label in execution section
```tsx
{selectedGoldPlan && (
  <div>
    الخطة المختارة: {planLabel}  —  مصدر الخطة: Risk Manager + ATR
    لوت: {selectedGoldPlan.estimatedLot?.toFixed(2)} / مخاطرة: ${selectedGoldPlan.suggestedRiskUsd}
  </div>
)}
{!selectedGoldPlan && mode === "gold" && (
  <p>⚠️ لم يتم اختيار خطة مهنية — هذه خطة تحليل أولية</p>
)}
```

---

## Part 3 — Experimental Execution Policy v1

### 3.1 Type changes — demo-execution-settings.ts
```typescript
export type ExecutionPolicy = "STRICT" | "EXPERIMENTAL";

// Add to DemoExecutionSettings:
executionPolicy: ExecutionPolicy;

// Add to DEFAULT_DEMO_SETTINGS:
executionPolicy: "STRICT",  // default
```

### 3.2 Hard Blocks vs Soft Blocks

**Hard Blocks** — always block in both STRICT and EXPERIMENTAL:
| Condition | Source |
|---|---|
| Kill Switch ON | `settings.killSwitchEnabled` |
| executionMode === "READ_ONLY" | `settings.executionMode` |
| isConfirmedDemo === false | `settings.isConfirmedDemo` |
| Spread > maxSpreadPoints | `eligibility.spreadOk === false` |
| No live tick | `result.currentPriceSource !== "mt5-live-tick"` |
| No SL | `effectivePreview.stopLoss == null` |
| No TP | `effectivePreview.takeProfit == null` |
| Lot invalid (≤ 0) | `effectivePreview.estimatedLot` |
| RR < 1.0 (technical minimum) | `effectivePreview.rrRatio` |
| Symbol not allowed | `eligibility.symbolAllowed === false` |
| Critical committee BLOCK | `summary.criticalBlocks.length > 0` |
| Selected plan = BLOCKED | `selectedGoldPlan?.proposalStatus === "BLOCKED"` |
| No valid trade plan | `preview.allowed === false` |

**Soft Blocks** — allowed in EXPERIMENTAL:
| Condition | What it means |
|---|---|
| `priceActionGuard.status === "BLOCK"` (non-critical) | Grade C/D, low probability, WARN committees, Range market, candlestick conflict |
| `rrRatio < settings.minRewardRiskRatio` (but >= 1.0) | Below user's configured threshold, but technically viable |

### 3.3 canOpenGoldExperimental (new computed value in TradePreviewPanel)
```typescript
const canOpenGoldExperimental =
  settings.executionPolicy === "EXPERIMENTAL" &&
  mode === "gold" &&
  preview.allowed &&
  // priceActionGuard block — ALLOWED if soft
  !settings.killSwitchEnabled &&
  settings.executionMode !== "READ_ONLY" &&
  settings.isConfirmedDemo &&
  eligibility.spreadOk &&
  result.currentPriceSource === "mt5-live-tick" &&
  (effectivePreview.estimatedLot ?? 0) > 0 &&
  effectivePreview.stopLoss  != null &&
  effectivePreview.takeProfit != null &&
  (effectivePreview.rrRatio ?? 0) >= 1.0 &&        // technical minimum (not user-configured)
  eligibility.symbolAllowed &&
  summary.criticalBlocks.length === 0 &&
  selectedGoldPlan?.proposalStatus !== "BLOCKED" &&
  priceActionGuard.status === "BLOCK";               // only show when STRICT would block
```

**Note:** `canOpenGoldExperimental` is true ONLY when `canOpenGoldModal` is false due to soft blocks.
If `canOpenGoldModal` is already true, the normal button handles it.

### 3.4 UI — Experimental button
Shows below the main gold execution button when `canOpenGoldExperimental === true`:
```tsx
{mode === "gold" && canOpenGoldExperimental && (
  <div>
    <badge>تجربة تنفيذ محكومة — ليست فرصة معتمدة</badge>
    <button onClick={() => setShowGoldModal(true)}>
      ◇ تجربة تنفيذ — بعد المراجعة
    </button>
  </div>
)}
```

### 3.5 Modal — EXPERIMENTAL warning section
Inside the Gold Confirmation Modal, when `executionPolicy === "EXPERIMENTAL"`:
```
⚠️ هذه تجربة تنفيذ للنظام — ليست فرصة عالية الاعتماد
الـ Soft Blocks التي تم السماح بها:
• [list of soft block reasons from priceActionGuard.blockers]
```

### 3.6 handleGoldSendToMT5 precheck modification
```typescript
// Build precheckReasons as before
// Then filter based on policy:

const hardPrecheckReasons = precheckReasons.filter(isHardBlockReason);
const softPrecheckReasons = precheckReasons.filter(r => !isHardBlockReason(r));

// STRICT: any block fails
// EXPERIMENTAL: only hard blocks fail
const effectivePrecheckReasons =
  settings.executionPolicy === "STRICT"
    ? precheckReasons
    : hardPrecheckReasons;

if (effectivePrecheckReasons.length > 0) {
  setGoldPrecheckFailed(effectivePrecheckReasons);
  if (softPrecheckReasons.length > 0 && settings.executionPolicy === "EXPERIMENTAL") {
    // Show soft blocks as warning, not blocker
  }
  if (hardPrecheckReasons.length > 0) return;
}
```

**isHardBlockReason** checks if a reason string matches hard block patterns:
- Kill Switch, READ_ONLY, no tick, stale data, spread, no SL, no TP, lot invalid, symbol not allowed

### 3.7 Settings page UI — policy toggle
Add to settings, in the execution settings section:
```
سياسة التنفيذ:
  ● تنفيذ صارم (STRICT) — الافتراضي
    أي BLOCK من حارس الجودة يمنع الزر
  ○ تجارب تنفيذ محكومة (EXPERIMENTAL)
    يسمح بتجاوز الإشارات الضعيفة — Hard Blocks محفوظة دائماً
```

---

## Files Summary

| File | Change |
|---|---|
| `src/lib/trading/shared/demo-execution-settings.ts` | +`ExecutionPolicy` type, +`executionPolicy` field, default STRICT |
| `src/components/lab/CandleSyncPanel.tsx` | Display improvements — no logic change |
| `src/components/lab/GoldTradePlanSelector.tsx` | +`onSelectPlan` prop |
| `src/components/lab/AnalysisControlPanel.tsx` | +selectedGoldPlan, +effectivePreview, +canOpenGoldExperimental, modify precheck |
| `src/app/(dashboard)/settings/page.tsx` | +policy toggle UI |

**Unchanged:** `canOpenGoldModal`, `handleGoldSendToMT5` core logic, `mt5_readonly_service`, `convex/schema.ts`, Kill Switch, route.

---

## Self-Review

1. ✅ No placeholders — `isHardBlockReason` defined by string pattern matching in precheck
2. ✅ `canOpenGoldModal` explicitly unchanged — experimental is additive
3. ✅ `effectivePreview` satisfies original `TradeOrderPreview` type — no type error
4. ✅ `executionPolicy` added to `DemoExecutionSettings` with localStorage backward-compat spread
5. ✅ Soft block list from `priceActionGuard.blockers` — no new data needed
6. ✅ Auto-select Balanced only on mount/goldPlans change — no loop
7. ⚠️ Fixed: `canOpenGoldExperimental` requires `priceActionGuard.status === "BLOCK"` to avoid showing when normal button already works
