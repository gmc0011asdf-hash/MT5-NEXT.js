# Gold Trading Availability Calibration v1 — Design Spec
Date: 2026-05-19 | Approach: Engine as single source of truth

---

## Problem

`resolveStatus` returns "BLOCKED" whenever `guardStatus === "BLOCK"` regardless of policy.
This causes `SystemRecommendationCard` to always show "محظور — لا يجوز التنفيذ" even
when all Hard Blocks pass and the only issue is analysis quality (Soft Blocks).

---

## Files Changed

| File | Change |
|---|---|
| `src/lib/gold/gold-recommendation-engine.ts` | +3 input fields, update resolveStatus/Title/Summary/NextAction |
| `src/components/lab/AnalysisControlPanel.tsx` | +hardBlocksInEffect/softBlocksInEffect, pass to engine, display overhaul |
| `src/components/lab/SystemRecommendationCard.tsx` | Minor: update EXPERIMENTAL badge label |

---

## Engine Changes (`gold-recommendation-engine.ts`)

### New input fields
```typescript
executionPolicy?:        "STRICT" | "EXPERIMENTAL";  // default = "STRICT"
hardBlockCount?:         number;                      // computed by component
softBlockCount?:         number;                      // computed by component
canOpenGoldExperimental?: boolean;                    // from component
```

### Updated `resolveStatus` logic
```
Priority 1: hardBlockCount > 0 OR criticalBlockCount > 0 → BLOCKED (always)
Priority 2: guardStatus === "BLOCK" or finalDecision === "BLOCK" (soft reason):
  - EXPERIMENTAL policy + hardBlockCount === 0 → EXPERIMENTAL
  - STRICT policy → BLOCKED
Priority 3: analysisStatus !== "opportunity" → NO_TRADE
Priority 4: grade C/D or probability < 45 → WATCH
Priority 5: anyBlock or grade B → CANDIDATE
Priority 6: executionGateOpen or canOpenGoldExperimental → APPROVED
Priority 7: else → EXPERIMENTAL
```

### Updated EXPERIMENTAL display
| Context | Title | Summary |
|---|---|---|
| Soft block in EXPERIMENTAL | "تجربة تنفيذ محكومة" | "هذه ليست صفقة قوية، لكنها صالحة للاختبار لأن الشروط الفنية الأساسية سليمة." |
| Execution settings not ready | existing text | existing text |

---

## Hard Blocks (always block, both modes)

Conditions that set `hardBlocksInEffect++`:
1. `!effectivePreview.allowed` — no valid plan
2. `settings.killSwitchEnabled` — Kill Switch ON
3. `settings.executionMode === "READ_ONLY"` — execution closed
4. `!settings.isConfirmedDemo` — review not confirmed
5. `!eligibility.spreadOk` — spread too high
6. `result.currentPriceSource !== "mt5-live-tick"` — no live tick
7. `(effectivePreview.estimatedLot ?? 0) <= 0` — invalid lot
8. `effectivePreview.stopLoss == null` — no SL
9. `effectivePreview.takeProfit == null` — no TP
10. `(effectivePreview.rrRatio ?? 0) < 1.0` — RR below technical minimum
11. `!eligibility.symbolAllowed` — symbol not permitted
12. `summary.criticalBlocks.length > 0` — critical committee BLOCK
13. `selectedGoldPlan?.proposalStatus === "BLOCKED"` — selected plan blocked

---

## Soft Blocks (allowed in EXPERIMENTAL)

Conditions that set `softBlocksInEffect++`:
1. `priceActionGuard.status === "BLOCK" && criticalBlocks.length === 0` — quality guard soft block
2. `rrRatio >= 1.0 && rrRatio < settings.minRewardRiskRatio` — below user's configured min but technically valid

These come from: grade C/D, low probability, WARN committees, RANGE market, candlestick conflicts, weak momentum.

---

## Component Display Changes (TradePreviewPanel)

### Replace `goldBlockedReasons` (mixed) with two arrays:
- `goldHardBlockReasons[]` — hard block messages
- `goldSoftBlockReasons[]` — soft block messages

### Execution section display (replaces current "بطاقة أسباب المنع"):
```
IF hardBlocksInEffect > 0:
  [Red box] "ممنوع تقنيًا — لا يمكن التجربة"
  Hard Blocks: N | Soft Blocks: N
  [List of hard block reasons]

ELSE IF hardBlocksInEffect === 0 AND softBlocksInEffect > 0:
  IF EXPERIMENTAL policy:
    [Violet box] "Soft Blocks: N — قابل للاختبار في EXPERIMENTAL"
    [List of soft block reasons]
  ELSE:
    [Amber box] "Soft Blocks: N — ممنوع في وضع STRICT"
    [List of soft block reasons]
```

### Experimental button (more prominent):
```tsx
// Large, clear, independent button
<button className="...violet...large...">
  ▶ تنفيذ تجربة MT5
</button>
// Below it:
<div>المسموح به تجريبياً: [list of soft blocks]</div>
```

---

## Self-Review Results

1. ✅ No placeholders
2. ✅ `hardBlockCount` is explicitly computed before being passed to engine
3. ✅ Kill Switch remains in hard blocks list (always blocks)
4. ✅ Route unchanged
5. ✅ `canOpenGoldExperimental` condition unchanged — only adds APPROVED status as a signal
6. ✅ `guardOkForSend` unchanged — button enable logic separate from display logic
