# Gold Trade Plans — Professional Upgrade v2 — Design Spec
Date: 2026-05-18 | Builds on: Gold Trade Plans Engine v1

---

## Problems Being Solved

| # | Problem | Root Cause | Fix |
|---|---|---|---|
| 1 | Lot always 0.01 — riskUsd fixed at user input | Engine uses user's riskUsd directly | Risk Manager: % of equity |
| 2 | No comparison manual vs ATR lot | No context shown | Add lotReason + manual comparison |
| 3 | Only selected timeframe used | MTF data ignored by plans engine | Feed MTFConsensus into engine |
| 4 | No professional narrative per plan | Plans are just numbers | Add ProfessionalContext per plan |

---

## New File: `src/lib/gold/gold-risk-manager.ts`

### Input
```typescript
type RiskManagerInput = {
  userRiskUsdCap: number;      // user-entered max — cap, not fixed
  slDistance:     number;      // |entry - stopLoss|
  equity?:        number;      // derived: riskUsd / (riskPercentOfEquity/100)
};
```

**Equity derivation** (no new API call — uses existing AnalysisResult fields):
```typescript
equity = (riskPercentOfEquity != null && riskPercentOfEquity > 0)
  ? riskUsd / (riskPercentOfEquity / 100)
  : undefined;
```

### 3 Risk Levels
| Level | % of Equity | Cap |
|---|---|---|
| Conservative | 0.25% | min(0.0025×equity, userRiskUsdCap) |
| Balanced | 0.5% | min(0.005×equity, userRiskUsdCap) |
| Aggressive | 1.0% | min(0.01×equity, userRiskUsdCap) |

If equity unknown: Conservative = cap×0.25, Balanced = cap×0.5, Aggressive = cap (with warning).

### Output per risk level
```typescript
type RiskLevel = {
  suggestedRiskUsd: number;
  riskPercent:      number | null;  // null if equity unknown
  maxLossUsd:       number;
  estimatedLot:     number;         // suggestedRiskUsd / (slDistance × 100)
  lotReason:        string;
  riskWarning:      string | null;
};

type RiskManagerResult = {
  conservative: RiskLevel;
  balanced:     RiskLevel;
  aggressive:   RiskLevel;
  equityUsed:   number | null;
  equitySource: "derived" | "unknown";
};
```

---

## MTF Context Input (no new data fetch needed)

Add to `GoldTradePlansInput`:
```typescript
mtf?: {
  higherTimeframeBias: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  entryTimeframeBias:  "bullish" | "bearish" | "neutral" | "unknown";
  alignmentScore:      number;    // 0-100
  verdict:             "PASS" | "WARN" | "BLOCK";
  timeframeSummaries:  Array<{ timeframe: string; trendBias: string; available: boolean }>;
};
```

Passed from `result.multiTimeframeConsensus` (already in AnalysisResult).

### MTF Rules for ProposalStatus
| Condition | Effect on plans |
|---|---|
| D1+H4 aligned with direction | confidence boost (+10), EXECUTION_READY allowed |
| H4+H1 conflict | max status → REVIEW, no EXECUTION_READY |
| Only M15 conflicts | allow Conservative/Balanced, block Aggressive |
| Most timeframes conflict (alignmentScore < 40) | no EXECUTION_READY for any plan |
| MTF verdict === BLOCK | all plans capped at REVIEW |

---

## Updates to `TradePlan` type

Add:
```typescript
// Risk Manager fields (replaces flat lot/riskUsd)
suggestedRiskUsd:  number;
riskPercent:       number | null;
maxLossUsd:        number;
lotReason:         string;
manualLotNote:     string | null;  // "Manual lot: 1.67 — ATR lot: 0.01"

// Professional context
professional: {
  whyThisPlan:          string;
  whenToEnter:          string;
  whenNotToEnter:       string;
  timingAssessment:     "NOW" | "WAIT" | "MONITOR";
  executionTimeframe:   string;
  managementTimeframe:  string;
  mtfSupportingFrames:  string[];
  mtfConflictingFrames: string[];
};
```

---

## Add to `GoldTradePlansInput`

```typescript
riskPercentOfEquity?: number;  // from result.riskPercentOfEquity
manualLot?:           number;  // from preview.estimatedLot (manual plan lot)
mtf?:                 MTFContextInput;  // from result.multiTimeframeConsensus
```

---

## Files Changed

| File | Change | Lines est. |
|---|---|---|
| `src/lib/gold/gold-risk-manager.ts` | **New** — pure risk level calculator | ~100 |
| `src/lib/gold/gold-trade-plans-engine.ts` | Update inputs + TradePlan type + MTF rules + professional context | ~120 |
| `src/components/lab/GoldTradePlansCard.tsx` | Show riskPercent, suggestedRisk, lot reason, manual comparison | ~60 |
| `src/components/lab/GoldTradePlanSelector.tsx` | Show professional context narrative + MTF info | ~80 |
| `src/components/lab/AnalysisControlPanel.tsx` | Pass riskPercentOfEquity + manualLot + mtf | ~15 |

**Unchanged:** `canOpenGoldModal`, `handleGoldSendToMT5`, `mt5_readonly_service`, `convex/schema.ts`, kill switch, all governance.

---

## Example output (equity = $2964)

```
Conservative:  $7.41 (0.25%) | lot: 0.04 | SL: 2.0×ATR
               "اللوت منخفض لأن SL يعادل 2×ATR لحماية رأس المال"
               [Manual lot: 1.67 — ATR conservative lot: 0.04]

Balanced:      $14.82 (0.5%) | lot: 0.07
Aggressive:    $29.64 (1.0%) | lot: 0.15 ← capped at userRiskUsdCap=50
```

---

## Professional Context Example (SELL, Balanced)

```
لماذا هذه الخطة؟  D1 وH4 هابط — توافق فريمات عالية — SL محمي بـ 1.5×ATR
متى تدخل؟         عند تأكيد انعكاس H1 أو كسر دعم M30
متى لا تدخل؟      إذا D1 أغلق فوق نقطة دخول — أو SL ضيق مقارنة بـ ATR
التوقيت:          مناسب — H4 وH1 متوافقان
فريم الدخول:       M15 / M30
فريم الإدارة:      H4
الفريمات الداعمة:  D1, H4, H1
الفريمات المعارضة: M15
```

---

## Constraints

- ❌ No new API endpoints
- ❌ No polling
- ❌ No `order_send`
- ❌ No Convex mutations
- ❌ No governance changes
- ✅ Equity derived from existing result fields (no new fetch)
- ✅ MTF from existing `result.multiTimeframeConsensus`
