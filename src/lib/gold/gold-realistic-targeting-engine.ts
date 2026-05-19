/**
 * gold-realistic-targeting-engine.ts — Gold Realistic Trade Targeting v1
 * ─────────────────────────────────────────────────────────────────────────────
 * يحسب أهدافًا واقعية للصفقة حسب الفريم الزمني:
 *   SCALP_TEST  — M1/M5/M15
 *   INTRADAY    — M30/H1
 *   SWING       — H4/D1/W1
 *
 * يُنبّه إذا الخطة الحالية أهدافها بعيدة عن الفريم.
 * يُعيد حساب اللوت تلقائيًا عند تغيير SL distance.
 *
 * ⚠️ لا order_send — لا تنفيذ — حساب وعرض فقط.
 * ⚠️ لا يُغيِّر Kill Switch أو أي شرط حوكمة.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { buildRiskLevels } from "./gold-risk-manager";
import type { TradePlan, GoldTradePlansResult } from "./gold-trade-plans-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TradeTargetProfile = "SCALP_TEST" | "INTRADAY" | "SWING";
export type RealismScore       = "REALISTIC" | "STRETCHED" | "TOO_FAR";

export type RealisticTarget = {
  profile:      TradeTargetProfile;
  profileLabel: string;

  direction:    "BUY" | "SELL";
  entry:        number;

  // Realistic targets
  tp1:    number;
  tp2:    number;     // main target — used as effectivePreview.takeProfit
  tp3:    number | null;
  sl:     number;     // used as effectivePreview.stopLoss

  // RR for each target
  rr1:    number;
  rr2:    number;
  rr3:    number | null;

  // Lot recalculated with realistic SL distance
  lot:       number;
  riskUsd:   number;
  lotReason: string;

  // Time constraints
  minCandles:      number;
  maxCandles:      number;
  timeStopLabel:   string;

  // Realism assessment of the CURRENT plan
  realismScore:         RealismScore;
  realismReason:        string;
  currentPlanFarWarn:   string | null;

  // Why this profile
  profileReason: string;

  // ATR used
  atr14: number;
};

export type RealisticTargetInput = {
  timeframe:           string | null | undefined;
  direction:           "bullish" | "bearish";
  entry:               number;
  atr14:               number;
  spreadPoints?:       number;

  // Risk
  riskUsd:             number;
  equity?:             number;
  freeMargin?:         number;
  riskPercentOfEquity?: number;

  // Current plan (for realism check)
  currentTP2?: number | null;
  currentSL?:  number | null;

  // Market context
  marketState?:   "BULLISH" | "BEARISH" | "RANGE" | "TRANSITION";
  rangeDetected?: boolean;
  pricePosition?: "PREMIUM" | "DISCOUNT" | "MID" | "UNKNOWN";
};

// ─── Profile configs ──────────────────────────────────────────────────────────

type ProfileConfig = {
  sl:         number;   // ATR multiplier for SL
  tp1:        number;   // ATR multiplier for TP1
  tp2:        number;   // ATR multiplier for TP2 (main)
  tp3:        number;   // ATR multiplier for TP3
  minCandles: number;
  maxCandles: number;
  tp2WarnMultiplier: number;  // warn if current TP2 dist > this * ATR
  tp2TooFarMultiplier: number;
};

const PROFILE_CONFIG: Record<TradeTargetProfile, ProfileConfig> = {
  SCALP_TEST: {
    sl:  0.60,  tp1: 0.30,  tp2: 0.70,  tp3: 1.10,
    minCandles: 3, maxCandles: 8,
    tp2WarnMultiplier: 1.20, tp2TooFarMultiplier: 2.00,
  },
  INTRADAY: {
    sl:  1.00,  tp1: 0.55,  tp2: 1.10,  tp3: 1.65,
    minCandles: 4, maxCandles: 12,
    tp2WarnMultiplier: 2.50, tp2TooFarMultiplier: 4.50,
  },
  SWING: {
    sl:  2.00,  tp1: 1.00,  tp2: 2.20,  tp3: 3.50,
    minCandles: 8, maxCandles: 60,
    tp2WarnMultiplier: 6.00, tp2TooFarMultiplier: 10.00,
  },
};

// ─── Profile selection ────────────────────────────────────────────────────────

const SCALP_TFS   = new Set(["M1", "M5", "M15"]);
const INTRADAY_TFS = new Set(["M30", "H1"]);

function selectProfile(timeframe: string | null | undefined): TradeTargetProfile {
  if (!timeframe) return "INTRADAY";
  const tf = timeframe.toUpperCase();
  if (SCALP_TFS.has(tf))    return "SCALP_TEST";
  if (INTRADAY_TFS.has(tf)) return "INTRADAY";
  return "SWING";
}

function profileLabel(p: TradeTargetProfile): string {
  if (p === "SCALP_TEST") return "SCALP — M15 سريع";
  if (p === "INTRADAY")   return "INTRADAY — H1";
  return "SWING — H4/D1";
}

function profileReason(p: TradeTargetProfile, tf: string | null | undefined): string {
  const tfLabel = tf ?? "غير محدد";
  if (p === "SCALP_TEST")
    return `الفريم ${tfLabel} قصير — SL ضيق وأهداف قريبة مناسبة لصفقات سريعة (3-8 شموع)`;
  if (p === "INTRADAY")
    return `الفريم ${tfLabel} متوسط — SL متوسط وأهداف يومية مناسبة (4-12 شمعة)`;
  return `الفريم ${tfLabel} طويل — SL واسع وأهداف ممتدة مناسبة للحيازة (8-60 شمعة)`;
}

function timeStopLabel(cfg: ProfileConfig, profile: TradeTargetProfile): string {
  if (profile === "SCALP_TEST")
    return `إذا لم يتحرك السعر بشكل كافٍ خلال ${cfg.maxCandles} شموع — راجع الخطة`;
  if (profile === "INTRADAY")
    return `إذا لم يصل للهدف خلال ${cfg.minCandles}-${cfg.maxCandles} شمعة — راجع الاتجاه`;
  return `خطة طويلة — راقب كل ${cfg.minCandles} شموع وعدّل الوقف إن لزم`;
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

// ─── Realism check ────────────────────────────────────────────────────────────

function assessRealism(
  currentTP2:   number | null | undefined,
  currentSL:    number | null | undefined,
  entry:        number,
  atr14:        number,
  cfg:          ProfileConfig,
  direction:    "BUY" | "SELL",
): { score: RealismScore; reason: string; warnMsg: string | null } {
  if (!currentTP2 || !currentSL || atr14 <= 0) {
    return { score: "REALISTIC", reason: "لا توجد خطة حالية لتقييمها", warnMsg: null };
  }

  const tp2Dist  = Math.abs(currentTP2 - entry);
  const tp2Ratio = tp2Dist / atr14;

  const score: RealismScore =
    tp2Ratio <= cfg.tp2WarnMultiplier   ? "REALISTIC" :
    tp2Ratio <= cfg.tp2TooFarMultiplier ? "STRETCHED" :
    "TOO_FAR";

  const reason =
    score === "REALISTIC"  ? `الهدف الحالي (${tp2Dist.toFixed(1)}) = ${tp2Ratio.toFixed(2)}× ATR — مناسب للفريم` :
    score === "STRETCHED"  ? `الهدف الحالي (${tp2Dist.toFixed(1)}) = ${tp2Ratio.toFixed(2)}× ATR — ممتد قليلًا` :
    `الهدف الحالي (${tp2Dist.toFixed(1)}) = ${tp2Ratio.toFixed(2)}× ATR — بعيد جدًا للفريم`;

  const warnMsg =
    score === "TOO_FAR"
      ? `الهدف بعيد بالنسبة لهذا الفريم (${tp2Ratio.toFixed(1)}× ATR > ${cfg.tp2WarnMultiplier}× الحد) — استخدم TP1/TP2 الواقعي للتجربة.`
      : score === "STRETCHED"
        ? `الهدف ممتد (${tp2Ratio.toFixed(1)}× ATR) — قد يُستخدم مع لوت مخفّض.`
        : null;

  return { score, reason, warnMsg };
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildRealisticTargets(input: RealisticTargetInput): RealisticTarget | null {
  const { atr14, entry, direction } = input;

  if (atr14 <= 0 || entry <= 0) return null;

  const dir     = direction === "bullish" ? "BUY" : "SELL";
  const profile = selectProfile(input.timeframe);
  const cfg     = PROFILE_CONFIG[profile];

  // ── Compute SL and TPs ────────────────────────────────────────────────────
  const slDist  = r2(cfg.sl  * atr14);
  const tp1Dist = r2(cfg.tp1 * atr14);
  const tp2Dist = r2(cfg.tp2 * atr14);
  const tp3Dist = r2(cfg.tp3 * atr14);

  const sl  = dir === "BUY" ? r2(entry - slDist)  : r2(entry + slDist);
  const tp1 = dir === "BUY" ? r2(entry + tp1Dist) : r2(entry - tp1Dist);
  const tp2 = dir === "BUY" ? r2(entry + tp2Dist) : r2(entry - tp2Dist);
  const tp3 = dir === "BUY" ? r2(entry + tp3Dist) : r2(entry - tp3Dist);

  const slDistance = Math.abs(entry - sl);

  // ── RR ────────────────────────────────────────────────────────────────────
  const rr1 = r2(tp1Dist / slDistance);
  const rr2 = r2(tp2Dist / slDistance);
  const rr3 = r2(tp3Dist / slDistance);

  // ── Lot via Risk Manager (equity-based, same formula as plans engine) ────
  const rm = buildRiskLevels({
    userRiskUsdCap:      input.riskUsd,
    slDistance,
    equity:              input.equity,
    freeMargin:          input.freeMargin,
    riskUsd:             input.riskUsd,
    riskPercentOfEquity: input.riskPercentOfEquity,
  });

  // Use balanced tier by default
  const riskLevel = rm.balanced;
  const lot       = riskLevel.estimatedLot;
  const riskUsd   = riskLevel.suggestedRiskUsd;
  const lotReason = `${profileLabel(profile)} — SL ${slDistance.toFixed(2)} × ${cfg.sl}×ATR — لوت: ${lot.toFixed(2)} — ${riskLevel.lotReason}`;

  // ── Realism assessment of current plan ───────────────────────────────────
  const { score, reason, warnMsg } = assessRealism(
    input.currentTP2, input.currentSL, entry, atr14, cfg, dir,
  );

  return {
    profile,
    profileLabel: profileLabel(profile),
    direction: dir,
    entry,
    tp1, tp2, tp3: tp3 ?? null,
    sl,
    rr1, rr2, rr3: rr3 ?? null,
    lot, riskUsd, lotReason,
    minCandles:    cfg.minCandles,
    maxCandles:    cfg.maxCandles,
    timeStopLabel: timeStopLabel(cfg, profile),
    realismScore:  score,
    realismReason: reason,
    currentPlanFarWarn: warnMsg,
    profileReason: profileReason(profile, input.timeframe),
    atr14,
  };
}

// ─── Exported realism helper ──────────────────────────────────────────────────

export function computeRealismScore(
  tp2Dist: number,
  atr14:   number,
  profile: TradeTargetProfile,
): RealismScore {
  if (atr14 <= 0) return "REALISTIC";
  const cfg   = PROFILE_CONFIG[profile];
  const ratio = tp2Dist / atr14;
  if (ratio <= cfg.tp2WarnMultiplier)   return "REALISTIC";
  if (ratio <= cfg.tp2TooFarMultiplier) return "STRETCHED";
  return "TOO_FAR";
}

// ─── adjustTradePlans ─────────────────────────────────────────────────────────
// Adjusts all 3 professional plans (Conservative/Balanced/Aggressive) based on
// targetPreference + profile. FAR = original plans unchanged.
// REALISTIC / BALANCED = recalculate SL/TP/lot per profile multipliers.

type AdjustRiskInput = {
  riskUsd:             number;
  equity?:             number;
  freeMargin?:         number;
  riskPercentOfEquity?: number;
};

// Base SL multiplier per profile × preference
const PROFILE_PREF_BASE_SL: Record<TradeTargetProfile, Record<"REALISTIC" | "BALANCED", number>> = {
  SCALP_TEST: { REALISTIC: 0.60, BALANCED: 1.00 },
  INTRADAY:   { REALISTIC: 1.00, BALANCED: 1.50 },
  SWING:      { REALISTIC: 2.00, BALANCED: 2.50 },
};

// Scale applied per plan type on top of the base SL
const PLAN_SL_SCALE: Record<string, number> = {
  CONSERVATIVE: 1.30,   // wider SL — safer entry
  BALANCED:     1.00,
  AGGRESSIVE:   0.75,   // tighter SL — higher conviction
};

// Main RR target per plan type (TP2 = SL distance × this)
const PLAN_MAIN_RR: Record<string, number> = {
  CONSERVATIVE: 2.0,
  BALANCED:     1.5,
  AGGRESSIVE:   1.2,
};

function adjustOnePlan(
  plan:        TradePlan,
  preference:  "REALISTIC" | "BALANCED",
  profile:     TradeTargetProfile,
  atr14:       number,
  riskInput:   AdjustRiskInput,
  minRR:       number,
): TradePlan {
  // Keep blocked / WAIT plans as metadata-only
  if (
    plan.proposalStatus === "BLOCKED" ||
    plan.planType === "WAIT" ||
    plan.entry == null
  ) {
    return {
      ...plan,
      targetSource:     "adjusted",
      targetPreference: preference,
      profile,
    };
  }

  const planKey = plan.planType as string;
  const baseSL  = PROFILE_PREF_BASE_SL[profile][preference];
  const scale   = PLAN_SL_SCALE[planKey]  ?? 1.0;
  const mainRR  = PLAN_MAIN_RR[planKey]   ?? 1.5;

  const slDist = r2(baseSL * scale * atr14);
  const dir    = plan.direction as "BUY" | "SELL";
  const entry  = plan.entry;

  const sl  = dir === "BUY" ? r2(entry - slDist) : r2(entry + slDist);
  const tp1 = dir === "BUY" ? r2(entry + slDist * 0.5)          : r2(entry - slDist * 0.5);
  const tp2 = dir === "BUY" ? r2(entry + slDist * mainRR)       : r2(entry - slDist * mainRR);
  const tp3 = dir === "BUY" ? r2(entry + slDist * mainRR * 1.5) : r2(entry - slDist * mainRR * 1.5);

  const rr1 = 0.5;
  const rr2 = mainRR;
  const rr3 = r2(mainRR * 1.5);

  // Lot via Risk Manager (same tier as plan type)
  const rm = buildRiskLevels({
    userRiskUsdCap:      riskInput.riskUsd,
    slDistance:          slDist,
    equity:              riskInput.equity,
    freeMargin:          riskInput.freeMargin,
    riskUsd:             riskInput.riskUsd,
    riskPercentOfEquity: riskInput.riskPercentOfEquity,
  });

  const riskTier =
    planKey === "CONSERVATIVE" ? rm.conservative :
    planKey === "AGGRESSIVE"   ? rm.aggressive   :
    rm.balanced;

  const proposalStatus: "EXECUTION_READY" | "REVIEW" =
    rr2 >= minRR ? "EXECUTION_READY" : "REVIEW";

  const tp2Dist     = Math.abs(tp2 - entry);
  const realismScr  = computeRealismScore(tp2Dist, atr14, profile);
  const prefLabel   = preference === "REALISTIC" ? "واقعي" : "متوسط";
  const planLabel   =
    planKey === "CONSERVATIVE" ? "المحافظة" :
    planKey === "BALANCED"     ? "المتوازنة" : "الهجومية";

  return {
    ...plan,
    stopLoss:         sl,
    takeProfit1:      tp1,
    takeProfit2:      tp2,
    takeProfit3:      tp3,
    rr1,
    rr2,
    rr3,
    suggestedRiskUsd: riskTier.suggestedRiskUsd,
    riskUsd:          riskTier.suggestedRiskUsd,
    estimatedLot:     riskTier.estimatedLot,
    riskPercent:      riskTier.riskPercent,
    maxLossUsd:       riskTier.suggestedRiskUsd,
    lotReason:        riskTier.lotReason,
    proposalStatus,
    nextAction:
      proposalStatus === "EXECUTION_READY"
        ? `${planLabel} — هدف ${prefLabel} — جاهز للمراجعة — استخدم زر MT5`
        : `${planLabel} — هدف ${prefLabel} — راجع الشروط`,
    targetSource:     "adjusted",
    targetPreference: preference,
    profile,
    realismScore:     realismScr,
  };
}

export function adjustTradePlans(
  originalPlans:   TradePlan[],
  preference:      "REALISTIC" | "BALANCED" | "FAR",
  realisticTarget: RealisticTarget,
  riskInput:       AdjustRiskInput,
  minRR:           number,
): TradePlan[] {
  // FAR: return originals with metadata tags only
  if (preference === "FAR") {
    return originalPlans.map((p) => {
      const tp2Dist = p.entry != null && p.takeProfit2 != null
        ? Math.abs(p.takeProfit2 - p.entry) : 0;
      return {
        ...p,
        targetSource:     "original" as const,
        targetPreference: "FAR" as const,
        profile:          realisticTarget.profile,
        realismScore:     tp2Dist > 0
          ? computeRealismScore(tp2Dist, realisticTarget.atr14, realisticTarget.profile)
          : undefined,
      };
    });
  }

  return originalPlans.map((p) =>
    adjustOnePlan(p, preference, realisticTarget.profile, realisticTarget.atr14, riskInput, minRR),
  );
}

export function buildAdjustedGoldPlans(
  original:        GoldTradePlansResult,
  preference:      "REALISTIC" | "BALANCED" | "FAR",
  realisticTarget: RealisticTarget | null,
  riskInput:       AdjustRiskInput,
  minRR:           number,
): GoldTradePlansResult {
  if (!realisticTarget) {
    // No ATR — tag originals as FAR
    return {
      plans: original.plans.map((p) => ({
        ...p,
        targetSource:     "original" as const,
        targetPreference: preference,
      })),
      bestPlanIdx: original.bestPlanIdx,
    };
  }

  const adjusted = adjustTradePlans(original.plans, preference, realisticTarget, riskInput, minRR);

  // Recompute bestPlanIdx
  const order = [1, 0, 2]; // BALANCED → CONSERVATIVE → AGGRESSIVE
  let bestPlanIdx: number | null = null;
  for (const i of order) {
    if (adjusted[i]?.proposalStatus === "EXECUTION_READY") { bestPlanIdx = i; break; }
  }
  if (bestPlanIdx === null) {
    for (const i of order) {
      if (adjusted[i]?.proposalStatus === "REVIEW") { bestPlanIdx = i; break; }
    }
  }

  return { plans: adjusted, bestPlanIdx };
}
