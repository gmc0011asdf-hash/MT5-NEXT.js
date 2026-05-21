# Gold Recommendation Engine v1 — Design Spec
Date: 2026-05-18 | Status: Approved by Ahmed

## Goal
Unify the scattered analysis signals (committees, guard, trade plan, governance) into a single "توصية النظام" (System Recommendation) card in `/gold`. The recommendation is informational only and does NOT change execution logic.

## Architecture

### File 1 — Pure Engine
`src/lib/gold/gold-recommendation-engine.ts`
- Pure TypeScript function `buildGoldRecommendation(input: GoldRecommendationInput): GoldRecommendation`
- No React, no Convex, no API calls
- Receives pre-extracted primitives from `TradePreviewPanel`

### File 2 — Display Component
`src/components/lab/SystemRecommendationCard.tsx`
- Receives `recommendation: GoldRecommendation` prop
- Renders the unified recommendation card
- Collapsible reasons/warnings/blockers sections

### File 3 — AnalysisControlPanel.tsx (minimal modification)
- Add one `useMemo` in `TradePreviewPanel` (~line 3211)
- Add one JSX block between lines 3461 and 3463 (between gold banner and preview.allowed block)
- No logic changes, no new hooks except the one `useMemo`

## Status Conditions (priority order)

| Status | Condition |
|---|---|
| BLOCKED | criticalBlockCount > 0 OR finalDecision === "BLOCK" OR guardStatus === "BLOCK" |
| NO_TRADE | analysisStatus !== "opportunity" |
| WATCH | analysisStatus === "opportunity" AND (grade C/D OR probability < 45) |
| CANDIDATE | analysisStatus === "opportunity" AND (anyBlock OR grade === "B") |
| EXPERIMENTAL | grade A/A+, no blocks, previewAllowed, executionGateOpen === false |
| APPROVED | grade A/A+, no blocks, executionGateOpen === true |

## Output Fields
- recommendationStatus, direction, confidencePercent, grade, title, summary
- reasons (from key committees: trend, momentum, structure, MTF, entry quality)
- warnings (from guardWarnings + WARN committees)
- blockers (from guardBlockers + BLOCK committees)
- executionAllowed (=== executionGateOpen)
- executionModeLabel (human-readable execution mode)
- riskSummary (formatted string)
- nextAction (per-status guidance)

## Constraints
- No order_send, no execution logic change
- No Convex queries, no polling
- No Demo/Real account terminology
- No convex/schema.ts changes
- No mt5_readonly_service changes
- Execution button stays exactly as-is
