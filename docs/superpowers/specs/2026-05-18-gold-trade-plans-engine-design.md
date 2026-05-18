# Gold Trade Recommendation & Execution Lab v1 — Design Spec
Date: 2026-05-18 | Revision: 2 | Approach: Hybrid + Multi-TP + Plan Selection

---

## 1. Goal

Transform /gold into a **Trade Recommendation & Execution Lab**:

1. After every analysis → engine produces 3 concrete plans (Conservative, Balanced, Aggressive)
2. Each plan has **3 take-profit levels** + partial close percentages
3. User can **select one plan** → system shows a full MT5 Execution Preview
4. Execution preview is prepared (not sent) — `order_send` is NOT called in this phase
5. Future phase: bind selected plan to the existing execution button

**Governance constraint:** `canOpenGoldModal`, `handleGoldSendToMT5`, Kill Switch, all committees — untouched.

---

## 2. Files

| File | Type | Role |
|---|---|---|
| `src/lib/gold/gold-trade-plans-engine.ts` | New | Pure engine — builds TradePlan[] with 3 TPs each |
| `src/components/lab/GoldTradePlansCard.tsx` | New | Displays 3 plan cards (read-only overview) |
| `src/components/lab/GoldTradePlanSelector.tsx` | New | Interactive selector — pick plan → show Execution Preview |
| `src/components/lab/AnalysisControlPanel.tsx` | Modified | ~55 lines: imports + useMemo + 2 JSX blocks |

**Unchanged:** `SystemRecommendationCard`, `handleGoldSendToMT5`, `canOpenGoldModal`,
`mt5_readonly_service/main.py`, `convex/schema.ts`, all governance logic.

---

## 3. Engine Input Type

```typescript
export type GoldTradePlansInput = {
  // Analysis outcome
  analysisStatus: string;        // "opportunity" | "wait" | "rejected" | ...
  direction?: "bullish" | "bearish";
  entry?: number;                // from result.entry — may be undefined
  currentBid?: number;
  currentAsk?: number;
  riskUsd: number;

  // Indicators
  atr14?: number;                // from result.indicators.atr14

  // Quality gates (from DecisionSummary)
  grade: string;                 // "A+" | "A" | "B" | "C" | "D"
  probability: number;           // 0–100
  anyBlock: boolean;
  criticalBlockCount: number;

  // Execution settings gates
  currentSpreadPoints?: number;
  maxSpreadPoints: number;       // from DemoExecutionSettings
  minRewardRiskRatio: number;    // from DemoExecutionSettings (default 1.5)
};
```

---

## 4. Plan Output Types

### 4.1 Partial Close Plan
```typescript
export type PartialClosePlan = {
  tp1Pct: number;   // percentage to close at TP1 — fixed: 30
  tp2Pct: number;   // percentage to close at TP2 — fixed: 30
  tp3Pct: number;   // percentage to close at TP3 — fixed: 40
};
// total always = 100%
```

### 4.2 TradePlan
```typescript
export type PlanType       = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | "WAIT";
export type ProposalStatus = "WAIT" | "REVIEW" | "EXECUTION_READY" | "BLOCKED";
export type EntryType      = "MARKET" | "LIMIT" | "STOP" | "WAIT";

export type TradePlan = {
  planType:        PlanType;
  direction:       "BUY" | "SELL" | "WAIT";
  entryType:       EntryType;
  entry:           number | null;
  stopLoss:        number | null;

  // Three take-profit levels
  takeProfit1:     number | null;   // TP1 — earliest exit
  takeProfit2:     number | null;   // TP2 — main target
  takeProfit3:     number | null;   // TP3 — extended target

  // R:R per TP level
  rr1:             number | null;
  rr2:             number | null;
  rr3:             number | null;

  partialClosePlan: PartialClosePlan;  // always { tp1: 30, tp2: 30, tp3: 40 }

  riskUsd:         number;
  estimatedLot:    number | null;
  confidence:      number;            // 0–100
  grade:           string;            // = summary.grade (same for all 3 plans)
  proposalStatus:  ProposalStatus;
  reasons:         string[];
  warnings:        string[];
  blockers:        string[];
  nextAction:      string;
};
```

### 4.3 Execution Preview (built after plan selection)
```typescript
export type ExecutionPreviewStatus = "READY" | "REVIEW" | "BLOCKED";

export type ExecutionPreview = {
  symbol:           string;          // always "XAUUSD"
  direction:        "BUY" | "SELL";
  entryType:        EntryType;
  lot:              number;
  entry:            number;
  stopLoss:         number;
  tp1:              number;
  tp2:              number;
  tp3:              number;
  rr1:              number;
  rr2:              number;
  rr3:              number;
  riskUsd:          number;
  partialClosePlan: PartialClosePlan;
  status:           ExecutionPreviewStatus;
  statusReasons:    string[];
};
```

### 4.4 Engine Result
```typescript
export type GoldTradePlansResult = {
  plans:       TradePlan[];        // 3 plans when opportunity; 1 WAIT plan otherwise
  bestPlanIdx: number | null;      // index of recommended plan (null = none recommended)
};
```

**Note on nullability:** When a plan is computable (opportunity + ATR available + direction present),
all of `entry`, `stopLoss`, `takeProfit1/2/3`, `rr1/2/3`, `estimatedLot` are guaranteed non-null together.
When a plan is WAIT or BLOCKED-due-to-missing-ATR, they are all null together.

---

## 5. ATR Parameters & TP Levels Per Plan

| Plan | SL Multiplier | TP1 (R×) | TP2 (R×) | TP3 (R×) | Entry Type | Partial Close | Max Status |
|---|---|---|---|---|---|---|---|
| Conservative | 2.0 × ATR | 1.0R | 2.0R | 3.0R | LIMIT | 30 / 30 / 40 | EXECUTION_READY (rr2=2.0 ≥ 1.5) |
| Balanced | 1.5 × ATR | 1.0R | 1.5R | 2.0R | MARKET | 30 / 30 / 40 | EXECUTION_READY (rr2=1.5 ≥ 1.5) |
| Aggressive | 1.0 × ATR | 0.8R | 1.2R | 1.5R | MARKET | 30 / 30 / 40 | REVIEW only (rr2=1.2 < 1.5 default minRR) |

**Note:** Aggressive can never reach EXECUTION_READY with default `minRewardRiskRatio=1.5` because rr2=1.2R < 1.5.
This is intentional — Aggressive always shows as REVIEW, warning the user about lower expected value.

---

## 6. Calculation Formulas

### Entry
| Plan | Direction | Formula |
|---|---|---|
| Balanced / Aggressive | BUY | `entry = currentAsk ?? result.entry` |
| Balanced / Aggressive | SELL | `entry = currentBid ?? result.entry` |
| Conservative | BUY | `entry = (currentAsk ?? result.entry) − 0.3 × ATR` — LIMIT |
| Conservative | SELL | `entry = (currentBid ?? result.entry) + 0.3 × ATR` — LIMIT |

### Stop Loss
- **BUY:** `SL = entry − (ATR × slMultiplier)`
- **SELL:** `SL = entry + (ATR × slMultiplier)`

### Take Profits (R = SL distance = |entry − stopLoss|)
- **BUY:**
  - `TP1 = entry + (R × rr1Target)`
  - `TP2 = entry + (R × rr2Target)`
  - `TP3 = entry + (R × rr3Target)`
- **SELL:**
  - `TP1 = entry − (R × rr1Target)`
  - `TP2 = entry − (R × rr2Target)`
  - `TP3 = entry − (R × rr3Target)`

### Actual RR (computed, may differ from target if entry was adjusted)
- `rr1 = |TP1 − entry| / R`
- `rr2 = |TP2 − entry| / R`
- `rr3 = |TP3 − entry| / R`

### Lot (XAUUSD — 100 oz per standard lot)
```
R        = |entry − stopLoss|
rawLot   = riskUsd / (R × 100)
lot      = clamp(rawLot, 0.01, 2.0)
```
- Warning: `rawLot > 1.0`
- Blocker: `rawLot > 2.0` (lot clamped from over-leverage)

---

## 7. ProposalStatus Rules (priority order)

### BLOCKED — any of:
- `criticalBlockCount > 0` — committee hard block
- `anyBlock === true` — any committee BLOCK
- `atr14` undefined or ≤ 0 — cannot compute (all plans get BLOCKED)
- `R < 0.5 × ATR` — SL distance too tight relative to volatility
- `rawLot > 2.0` — over-leverage detected

### WAIT — when:
- `analysisStatus !== "opportunity"` OR `direction === undefined`
- Returns single WAIT plan, `bestPlanIdx = null`

### EXECUTION_READY — ALL must pass:
- `grade === "A+" || grade === "A"`
- `anyBlock === false && criticalBlockCount === 0`
- `rr2 >= minRewardRiskRatio` (TP2 must meet minimum RR — main target)
- `currentSpreadPoints <= maxSpreadPoints` (if available)
- `rawLot <= 2.0`
- `R >= 0.5 × ATR`

### REVIEW — everything else (opportunity exists, concerns present):
- Grade B, or warnings exist, or spread unknown, or TP2 RR marginally below threshold

---

## 8. Best Plan Selection Logic

```
if BALANCED.proposalStatus === "EXECUTION_READY"  → bestPlanIdx = 1 (BALANCED)
else if CONSERVATIVE.proposalStatus === "EXECUTION_READY" → bestPlanIdx = 0
else if AGGRESSIVE.proposalStatus === "EXECUTION_READY"   → bestPlanIdx = 2
else first REVIEW plan in order [BALANCED → CONSERVATIVE → AGGRESSIVE] → that index
else null
```

---

## 9. UI Placement in /gold (TradePreviewPanel)

```
1. Header row                          (existing)
2. Gold mode info banner               (existing)
3. SystemRecommendationCard            (existing — v1, unchanged)
4. GoldTradePlansCard                  (NEW — overview of 3 plans)
5. GoldTradePlanSelector               (NEW — selection + execution preview)
6. preview.allowed → execution plan + MT5 button   (existing, unchanged)
```

Both new components render only when `mode === "gold"`.

---

## 10. Component: GoldTradePlansCard

**Role:** Read-only overview grid of the 3 plans.

```
┌─ خطط التداول المقترحة ──────────────────────────────────────────────────────┐
│  [3 columns: Conservative | Balanced ★ | Aggressive]                       │
│                                                                             │
│  كل بطاقة تعرض:                                                             │
│   - اسم الخطة + badge الحالة (EXECUTION_READY / REVIEW / BLOCKED / WAIT)  │
│   - الاتجاه: ↑ BUY / ↓ SELL                                                │
│   - نوع الدخول: MARKET / LIMIT                                              │
│   - الدخول — الوقف — TP1 / TP2 / TP3                                       │
│   - RR1 / RR2 / RR3                                                         │
│   - اللوت — المخاطرة                                                        │
│   - أسباب الحالة (collapsible)                                              │
│                                                                             │
│  "الخطة المتوازنة هي الأفضل حالياً"                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Component: GoldTradePlanSelector

**Role:** Interactive selector. User picks a plan → Execution Preview appears.

### State
```typescript
const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
```

### Sections
1. **Header:** "اختر خطة للمراجعة"
2. **3 selectable plan buttons** (Conservative / Balanced / Aggressive) — highlighted when selected
3. **Selected Plan Detail** (shows when selectedIdx !== null):
   - Full plan details
   - 3 TP levels with partial close %
4. **Execution Preview** (shows when selectedIdx !== null):
   - Derived from selected TradePlan
   - Shows all MT5-relevant fields: symbol, direction, entryType, lot, entry, SL, TP1/2/3, riskUsd, partialClosePlan, status
   - Status badge: READY / REVIEW / BLOCKED
5. **Footer notice:** "لا يتم إرسال أمر — معاينة فقط — التنفيذ عبر زر MT5 أدناه"

### Execution Preview derivation
`buildExecutionPreview` is a pure helper function defined **inside `GoldTradePlanSelector.tsx`** (not the engine file).
It is not exported — it is only used by the selector to build a display preview.

```typescript
function buildExecutionPreview(plan: TradePlan): ExecutionPreview | null {
  if (!plan.entry || !plan.stopLoss || !plan.takeProfit1 || !plan.estimatedLot) return null;
  if (plan.direction === "WAIT") return null;

  const status: ExecutionPreviewStatus =
    plan.proposalStatus === "EXECUTION_READY" ? "READY" :
    plan.proposalStatus === "REVIEW"          ? "REVIEW" : "BLOCKED";

  return {
    symbol:    "XAUUSD",
    direction: plan.direction,
    entryType: plan.entryType,
    lot:       plan.estimatedLot,
    entry:     plan.entry,
    stopLoss:  plan.stopLoss,
    tp1:       plan.takeProfit1,
    tp2:       plan.takeProfit2!,
    tp3:       plan.takeProfit3!,
    rr1:       plan.rr1!,
    rr2:       plan.rr2!,
    rr3:       plan.rr3!,
    riskUsd:   plan.riskUsd,
    partialClosePlan: plan.partialClosePlan,
    status,
    statusReasons: plan.proposalStatus === "BLOCKED" ? plan.blockers : plan.warnings,
  };
}
```

### Future binding readiness
`ExecutionPreview` fields are designed to align with `buildExecutionRequestPreview` shape used by `handleGoldSendToMT5`, enabling a future phase to bind the selected plan to the execution button without restructuring.

---

## 12. AnalysisControlPanel.tsx Changes (minimal)

**A) Imports (added to top):**
```typescript
import {
  buildGoldTradePlans,
  type GoldTradePlansResult,
} from "@/lib/gold/gold-trade-plans-engine";
import { GoldTradePlansCard }    from "@/components/lab/GoldTradePlansCard";
import { GoldTradePlanSelector } from "@/components/lab/GoldTradePlanSelector";
```

**B) useMemo inside TradePreviewPanel (after `goldRec` useMemo):**
```typescript
const goldPlans = useMemo((): GoldTradePlansResult | null => {
  if (mode !== "gold") return null;
  return buildGoldTradePlans({
    analysisStatus:      result.status,
    direction:           result.direction,
    entry:               result.entry,
    currentBid:          result.currentBid,
    currentAsk:          result.currentAsk,
    riskUsd:             result.riskUsd,
    atr14:               result.indicators?.atr14,
    grade:               summary.grade,
    probability:         summary.probability,
    anyBlock:            summary.anyBlock,
    criticalBlockCount:  summary.criticalBlocks.length,
    currentSpreadPoints: result.currentSpreadPoints,
    maxSpreadPoints:     settings.maxSpreadPoints,
    minRewardRiskRatio:  settings.minRewardRiskRatio,
  });
}, [mode, result, summary, settings]);
```

**C) JSX (after SystemRecommendationCard, before `preview.allowed ?`):**
```tsx
{mode === "gold" && goldPlans && (
  <>
    <GoldTradePlansCard  plans={goldPlans} />
    <GoldTradePlanSelector plans={goldPlans} />
  </>
)}
```

**Component prop signatures:**
```typescript
// GoldTradePlansCard.tsx
function GoldTradePlansCard({ plans }: { plans: GoldTradePlansResult }) { ... }

// GoldTradePlanSelector.tsx
function GoldTradePlanSelector({ plans }: { plans: GoldTradePlansResult }) { ... }
```

**Nothing else changes** — `canOpenGoldModal`, `handleGoldSendToMT5`, all execution logic untouched.

---

## 13. Hard Constraints

- ❌ No `order_send` calls
- ❌ No change to `canOpenGoldModal`
- ❌ No change to `handleGoldSendToMT5`
- ❌ No change to `mt5_readonly_service/main.py`
- ❌ No change to `convex/schema.ts`
- ❌ No new Convex queries or mutations
- ❌ No polling
- ❌ No Demo/Real account terminology
- ❌ `EXECUTION_READY` plans do NOT unlock the existing execution button
- ✅ Selected plan state is local (React `useState`) — no persistence

---

## 14. Data Flow

```
AnalysisResult + DecisionSummary + DemoExecutionSettings
          ↓
buildGoldTradePlans(input) → GoldTradePlansResult { plans[3], bestPlanIdx }
          ↓                                ↓
GoldTradePlansCard               GoldTradePlanSelector
(read-only overview)         (selectedIdx state → ExecutionPreview)
          ↓                                ↓
     Display only              buildExecutionPreview(selectedPlan)
                                           ↓
                               ExecutionPreview (READY/REVIEW/BLOCKED)
                               [future: bind to handleGoldSendToMT5]
```

---

## 15. Revision History

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-05-18 | Initial design — single TP, informational only |
| 2 | 2026-05-18 | Multi-TP (3 levels), partial close plan, plan selector, execution preview |
