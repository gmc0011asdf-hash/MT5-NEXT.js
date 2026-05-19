/**
 * gold-trade-plans-engine.ts — Gold Trade Plans Engine v2
 * ─────────────────────────────────────────────────────────────────────────────
 * يبني 3 خطط تداول (Conservative / Balanced / Aggressive) مع:
 *   - 3 أهداف لكل خطة
 *   - إدارة مخاطر مهنية من gold-risk-manager
 *   - سياق Multi-Timeframe لكل خطة
 *   - تحليل احترافي لكل خطة (whyThisPlan, whenToEnter, etc.)
 *
 * ⚠️ لا order_send — لا تنفيذ — تحليل واقتراح فقط.
 * ⚠️ لا يُغيِّر canOpenGoldModal ولا أي شرط حوكمة.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { buildRiskLevels, type RiskManagerResult } from "./gold-risk-manager";

// ─── Exported Types ───────────────────────────────────────────────────────────

export type PlanType       = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | "WAIT";
export type ProposalStatus = "WAIT" | "REVIEW" | "EXECUTION_READY" | "BLOCKED";
export type PlanDirection  = "BUY" | "SELL" | "WAIT";
export type EntryType      = "MARKET" | "LIMIT" | "STOP" | "WAIT";

export type PartialClosePlan = {
  tp1Pct: number;   // 30
  tp2Pct: number;   // 30
  tp3Pct: number;   // 40
};

export type ProfessionalContext = {
  whyThisPlan:          string;
  whenToEnter:          string;
  whenNotToEnter:       string;
  timingAssessment:     "NOW" | "WAIT" | "MONITOR";
  executionTimeframe:   string;
  managementTimeframe:  string;
  mtfSupportingFrames:  string[];
  mtfConflictingFrames: string[];
};

export type TradePlan = {
  planType:        PlanType;
  direction:       PlanDirection;
  entryType:       EntryType;
  entry:           number | null;
  stopLoss:        number | null;
  takeProfit1:     number | null;
  takeProfit2:     number | null;
  takeProfit3:     number | null;
  rr1:             number | null;
  rr2:             number | null;
  rr3:             number | null;
  partialClosePlan: PartialClosePlan;

  // Risk Manager fields
  suggestedRiskUsd: number;
  riskPercent:      number | null;
  maxLossUsd:       number;
  lotReason:        string;
  manualLotNote:    string | null;

  riskUsd:         number;
  estimatedLot:    number | null;
  confidence:      number;
  grade:           string;
  proposalStatus:  ProposalStatus;
  reasons:         string[];
  warnings:        string[];
  blockers:        string[];
  nextAction:      string;
  professional:    ProfessionalContext;

  // Adjustment metadata — set by adjustTradePlans (optional)
  targetSource?:     "original" | "adjusted";
  targetPreference?: "REALISTIC" | "BALANCED" | "FAR";
  profile?:          string;
  realismScore?:     string;
};

export type ExecutionPreviewStatus = "READY" | "REVIEW" | "BLOCKED";

export type ExecutionPreview = {
  symbol:           string;
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

export type MTFContextInput = {
  higherTimeframeBias: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  entryTimeframeBias:  "bullish" | "bearish" | "neutral" | "unknown";
  alignmentScore:      number;
  verdict:             "PASS" | "WARN" | "BLOCK";
  timeframeSummaries:  Array<{ timeframe: string; trendBias: string; available: boolean }>;
};

export type GoldTradePlansInput = {
  // Analysis
  analysisStatus:       string;
  direction?:           "bullish" | "bearish";
  entry?:               number;
  currentBid?:          number;
  currentAsk?:          number;
  riskUsd:              number;   // user cap
  atr14?:               number;

  // Quality gates (DecisionSummary)
  grade:                string;
  probability:          number;
  anyBlock:             boolean;
  criticalBlockCount:   number;

  // Execution settings
  currentSpreadPoints?:  number;
  maxSpreadPoints:       number;
  minRewardRiskRatio:    number;

  // Risk Manager inputs
  equity?:              number;    // MT5 direct (priority 1)
  freeMargin?:          number;    // MT5 direct (priority 2)
  riskPercentOfEquity?: number;    // for derivation (priority 3)
  manualLot?:           number;    // manual plan lot — for comparison note

  // Multi-Timeframe context
  mtf?:                 MTFContextInput;
};

export type GoldTradePlansResult = {
  plans:       TradePlan[];
  bestPlanIdx: number | null;
};

// ─── Internal plan configs ────────────────────────────────────────────────────

type PlanConfig = {
  planType:     PlanType;
  slMultiplier: number;
  rr1Target:    number;
  rr2Target:    number;
  rr3Target:    number;
  entryType:    EntryType;
  riskTier:     "conservative" | "balanced" | "aggressive";
};

const PLAN_CONFIGS: PlanConfig[] = [
  {
    planType:     "CONSERVATIVE",
    slMultiplier: 2.0,
    rr1Target:    1.0,
    rr2Target:    2.0,
    rr3Target:    3.0,
    entryType:    "LIMIT",
    riskTier:     "conservative",
  },
  {
    planType:     "BALANCED",
    slMultiplier: 1.5,
    rr1Target:    1.0,
    rr2Target:    1.5,
    rr3Target:    2.0,
    entryType:    "MARKET",
    riskTier:     "balanced",
  },
  {
    planType:     "AGGRESSIVE",
    slMultiplier: 1.0,
    rr1Target:    0.8,
    rr2Target:    1.2,
    rr3Target:    1.5,
    entryType:    "MARKET",
    riskTier:     "aggressive",
  },
];

const PARTIAL_CLOSE: PartialClosePlan = { tp1Pct: 30, tp2Pct: 30, tp3Pct: 40 };
const MIN_SL_ATR_RATIO = 0.5;

// ─── MTF Helpers ──────────────────────────────────────────────────────────────

type MTFAnalysis = {
  higherConflict:     boolean;
  noExecutionReady:   boolean;
  aggressiveBlocked:  boolean;
  supportingFrames:   string[];
  conflictingFrames:  string[];
  alignmentScore:     number;
  executionTF:        string;
  managementTF:       string;
};

function analyzeMTF(mtf: MTFContextInput | undefined, direction: "BUY" | "SELL"): MTFAnalysis {
  if (!mtf) {
    return {
      higherConflict:    false,
      noExecutionReady:  false,
      aggressiveBlocked: false,
      supportingFrames:  [],
      conflictingFrames: [],
      alignmentScore:    50,
      executionTF:       "M15",
      managementTF:      "H4",
    };
  }

  const dir          = direction === "BUY" ? "bullish" : "bearish";
  const antiDir      = direction === "BUY" ? "bearish" : "bullish";
  const higherBias   = mtf.higherTimeframeBias;
  const alignment    = mtf.alignmentScore;

  const higherConflict =
    higherBias === antiDir ||
    higherBias === "mixed";

  const noExecutionReady =
    mtf.verdict === "BLOCK" ||
    alignment < 40 ||
    higherConflict;

  const aggressiveBlocked =
    noExecutionReady ||
    mtf.entryTimeframeBias === antiDir;

  // Classify supporting / conflicting frames
  const supporting:  string[] = [];
  const conflicting: string[] = [];

  for (const tf of mtf.timeframeSummaries) {
    if (!tf.available) continue;
    if (tf.trendBias === dir)     supporting.push(tf.timeframe);
    else if (tf.trendBias === antiDir) conflicting.push(tf.timeframe);
  }

  // Recommend execution TF (entry timeframe) and management TF
  const higherTFs = ["D1", "H4"];
  const entryTFs  = ["H1", "M30", "M15"];
  const execTF    = mtf.timeframeSummaries.find(
    (t) => entryTFs.includes(t.timeframe) && t.available && t.trendBias === dir,
  )?.timeframe ?? "M15";
  const mgmtTF    = mtf.timeframeSummaries.find(
    (t) => higherTFs.includes(t.timeframe) && t.available,
  )?.timeframe ?? "H4";

  return {
    higherConflict,
    noExecutionReady,
    aggressiveBlocked,
    supportingFrames:  supporting,
    conflictingFrames: conflicting,
    alignmentScore:    alignment,
    executionTF:       execTF,
    managementTF:      mgmtTF,
  };
}

// ─── Entry computation ────────────────────────────────────────────────────────

function computeEntry(
  config:   PlanConfig,
  dir:      "BUY" | "SELL",
  ask:      number | undefined,
  bid:      number | undefined,
  fallback: number | undefined,
  atr:      number,
): number | null {
  const base = dir === "BUY" ? (ask ?? fallback) : (bid ?? fallback);
  if (base == null) return null;
  if (config.entryType === "LIMIT") {
    return dir === "BUY"
      ? Math.round((base - 0.3 * atr) * 100) / 100
      : Math.round((base + 0.3 * atr) * 100) / 100;
  }
  return Math.round(base * 100) / 100;
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

// ─── Professional context builder ────────────────────────────────────────────

function buildProfessionalContext(
  config:     PlanConfig,
  dir:        "BUY" | "SELL",
  mtfInfo:    MTFAnalysis,
  grade:      string,
  status:     ProposalStatus,
): ProfessionalContext {
  const dirAr  = dir === "BUY" ? "صعودية" : "هبوطية";
  const planAr =
    config.planType === "CONSERVATIVE" ? "المحافظة" :
    config.planType === "BALANCED"     ? "المتوازنة" : "الهجومية";

  const whyThisPlan =
    config.planType === "CONSERVATIVE"
      ? `SL واسع (${config.slMultiplier}×ATR) لحماية رأس المال — دخول LIMIT بانتظار تأكيد أقوى — RR هدف ${config.rr2Target}:1`
      : config.planType === "BALANCED"
        ? `توازن بين الحماية والعائد — SL ${config.slMultiplier}×ATR — دخول بالسوق — RR هدف ${config.rr2Target}:1 (الهدف الرئيسي)`
        : `دخول سريع بالسوق — SL ضيق (${config.slMultiplier}×ATR) — مخاطرة أعلى — مراجعة دائماً قبل التنفيذ`;

  const whenToEnter =
    config.planType === "CONSERVATIVE"
      ? `عند وصول السعر لمستوى LIMIT المحدد وتأكيد شمعة ${dir === "BUY" ? "صاعدة" : "هابطة"} عليه`
      : config.planType === "BALANCED"
        ? `عند تأكيد كسر/ارتداد قوي في إطار ${mtfInfo.executionTF} مع دعم من ${mtfInfo.managementTF}`
        : `فور ظهور إشارة تقنية قوية في ${mtfInfo.executionTF} مع تأكيد الزخم`;

  const whenNotToEnter =
    mtfInfo.higherConflict
      ? `إذا استمر الفريم الأعلى في الاتجاه المعاكس — الفريمات المتعارضة: ${mtfInfo.conflictingFrames.join(", ") || "—"}`
      : config.planType === "AGGRESSIVE"
        ? "إذا كان السبريد مرتفعاً أو البيانات قديمة أو الزخم يتراجع — الخطة الهجومية حساسة جداً لجودة الدخول"
        : `إذا أغلق السعر عكس الاتجاه ${dirAr} أو تجاوز مستوى الوقف المحدد`;

  const timingAssessment: "NOW" | "WAIT" | "MONITOR" =
    status === "EXECUTION_READY" ? "NOW" :
    status === "REVIEW"          ? "MONITOR" :
    "WAIT";

  return {
    whyThisPlan,
    whenToEnter,
    whenNotToEnter,
    timingAssessment,
    executionTimeframe:   mtfInfo.executionTF,
    managementTimeframe:  mtfInfo.managementTF,
    mtfSupportingFrames:  mtfInfo.supportingFrames,
    mtfConflictingFrames: mtfInfo.conflictingFrames,
  };
}

// ─── Plan builder ─────────────────────────────────────────────────────────────

function buildPlan(
  config:         PlanConfig,
  input:          GoldTradePlansInput,
  dir:            "BUY" | "SELL",
  atr:            number,
  riskManager:    RiskManagerResult,
  mtfInfo:        MTFAnalysis,
  globalBlockers: string[],
): TradePlan {
  const reasons:  string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [...globalBlockers];

  const planAr =
    config.planType === "CONSERVATIVE" ? "المحافظة" :
    config.planType === "BALANCED"     ? "المتوازنة" : "الهجومية";

  const riskLevel = riskManager[config.riskTier];

  // ── Entry ──────────────────────────────────────────────────────────────────
  const entry = computeEntry(
    config, dir,
    input.currentAsk, input.currentBid, input.entry,
    atr,
  );

  if (entry == null) {
    blockers.push("السعر الحالي غير متوفر — لا يمكن حساب الدخول");
    return makeBlockedPlan(config, dir, input, riskLevel, riskManager, blockers, planAr);
  }

  // ── Stop Loss ──────────────────────────────────────────────────────────────
  const slDist = r2(config.slMultiplier * atr);
  const SL     = dir === "BUY" ? r2(entry - slDist) : r2(entry + slDist);
  const R      = Math.abs(entry - SL);

  if (R < MIN_SL_ATR_RATIO * atr) {
    blockers.push(`SL ضيق (${R.toFixed(2)}) — أقل من ${MIN_SL_ATR_RATIO}×ATR`);
    return makeBlockedPlan(config, dir, input, riskLevel, riskManager, blockers, planAr);
  }

  // ── Take Profits ───────────────────────────────────────────────────────────
  const tp = (rrT: number) =>
    dir === "BUY" ? r2(entry + R * rrT) : r2(entry - R * rrT);

  const tp1 = tp(config.rr1Target);
  const tp2 = tp(config.rr2Target);
  const tp3 = tp(config.rr3Target);

  const rr1 = r2(Math.abs(tp1 - entry) / R);
  const rr2 = r2(Math.abs(tp2 - entry) / R);
  const rr3 = r2(Math.abs(tp3 - entry) / R);

  // ── Risk Manager lot ───────────────────────────────────────────────────────
  // Re-compute with actual SL distance (not estimated from ATR at input time)
  const actualRiskLevel = {
    ...riskLevel,
    ...(() => {
      const rawL = riskLevel.suggestedRiskUsd / (R * 100);
      const lot  = Math.max(0.01, Math.min(2.0, Math.round(rawL * 100) / 100));
      const lotR = `مخاطرة ${riskLevel.targetPct.toFixed(2)}% × $${riskLevel.suggestedRiskUsd.toFixed(2)} ÷ (SL ${R.toFixed(2)} × 100) = لوت ${lot.toFixed(2)}`;
      return { estimatedLot: lot, rawLot: rawL, lotReason: lotR };
    })(),
  };

  if (actualRiskLevel.rawLot > 2.0) {
    blockers.push(`لوت خام (${actualRiskLevel.rawLot.toFixed(2)}) يتجاوز الحد — خفّض المخاطرة`);
    return makeBlockedPlan(config, dir, input, actualRiskLevel, riskManager, blockers, planAr);
  }

  // ── Reasons & Warnings ─────────────────────────────────────────────────────
  reasons.push(`ATR: ${atr.toFixed(2)} — SL = ${config.slMultiplier}×ATR = ${slDist.toFixed(2)}`);
  reasons.push(`R/R: TP1 ${rr1.toFixed(1)} | TP2 ${rr2.toFixed(1)} | TP3 ${rr3.toFixed(1)}`);
  reasons.push(`مخاطرة: ${actualRiskLevel.suggestedRiskUsd.toFixed(2)}$${actualRiskLevel.riskPercent != null ? ` (${actualRiskLevel.riskPercent.toFixed(2)}%)` : ""} | لوت: ${actualRiskLevel.estimatedLot.toFixed(2)}`);

  if (mtfInfo.supportingFrames.length > 0)
    reasons.push(`الفريمات الداعمة: ${mtfInfo.supportingFrames.join(", ")}`);

  if (config.entryType === "LIMIT")
    warnings.push("الدخول LIMIT — انتظر وصول السعر قبل التنفيذ");

  if (config.planType === "AGGRESSIVE")
    warnings.push("SL ضيق — الخطة الهجومية دائماً للمراجعة");

  if (mtfInfo.conflictingFrames.length > 0)
    warnings.push(`الفريمات المتعارضة: ${mtfInfo.conflictingFrames.join(", ")} — راجع التوافق`);

  if (actualRiskLevel.riskWarning)
    warnings.push(actualRiskLevel.riskWarning);

  // ── Manual lot comparison note ─────────────────────────────────────────────
  const manualLotNote =
    input.manualLot != null && input.manualLot > 0
      ? `الخطة اليدوية: لوت ${input.manualLot.toFixed(2)} — ATR ${planAr}: لوت ${actualRiskLevel.estimatedLot.toFixed(2)}`
      : null;

  // ── Confidence ─────────────────────────────────────────────────────────────
  const mtfBonus =
    !mtfInfo.higherConflict && mtfInfo.alignmentScore >= 70 ? 8 : 0;
  const mtfPenalty =
    mtfInfo.higherConflict ? 15 :
    mtfInfo.alignmentScore < 40 ? 10 : 0;

  const baseConf = input.probability;
  const confAdjust =
    config.planType === "AGGRESSIVE" ? -15 :
    config.planType === "CONSERVATIVE" ? 0 : 0;

  const confidence = Math.max(0, Math.min(100,
    Math.round(baseConf + mtfBonus - mtfPenalty + confAdjust),
  ));

  // ── ProposalStatus ─────────────────────────────────────────────────────────
  const spreadOk =
    input.currentSpreadPoints == null ||
    input.currentSpreadPoints <= input.maxSpreadPoints;
  const gradeOk  = input.grade === "A+" || input.grade === "A";
  const noBlock  = !input.anyBlock && input.criticalBlockCount === 0;
  const rr2Ok    = rr2 >= input.minRewardRiskRatio;
  const lotOk    = actualRiskLevel.rawLot <= 2.0;
  const slOk     = R >= MIN_SL_ATR_RATIO * atr;

  // MTF overrides
  const mtfAllowsExecReady = !mtfInfo.noExecutionReady;
  const aggrBlocked = config.planType === "AGGRESSIVE" && mtfInfo.aggressiveBlocked;

  let proposalStatus: ProposalStatus;

  if (blockers.length > 0) {
    proposalStatus = "BLOCKED";
  } else if (aggrBlocked) {
    proposalStatus = "REVIEW";
    warnings.push("الخطة الهجومية محدودة — عدم توافق الفريمات الصغيرة");
  } else if (gradeOk && noBlock && rr2Ok && spreadOk && lotOk && slOk && mtfAllowsExecReady) {
    proposalStatus = "EXECUTION_READY";
  } else {
    proposalStatus = "REVIEW";
    if (!gradeOk)           warnings.push(`درجة ${input.grade} — تحتاج A أو A+ للوصول لـ EXECUTION_READY`);
    if (!rr2Ok)             warnings.push(`R/R للهدف الرئيسي (${rr2.toFixed(2)}) أقل من الحد (${input.minRewardRiskRatio})`);
    if (!spreadOk && input.currentSpreadPoints != null)
                            warnings.push(`السبريد (${input.currentSpreadPoints} pts) يتجاوز الحد (${input.maxSpreadPoints})`);
    if (!mtfAllowsExecReady) warnings.push(`توافق الفريمات (${mtfInfo.alignmentScore}%) لا يسمح بـ EXECUTION_READY`);
  }

  const professional = buildProfessionalContext(config, dir, mtfInfo, input.grade, proposalStatus);

  return {
    planType:         config.planType,
    direction:        dir,
    entryType:        config.entryType,
    entry,
    stopLoss:         SL,
    takeProfit1:      tp1,
    takeProfit2:      tp2,
    takeProfit3:      tp3,
    rr1,
    rr2,
    rr3,
    partialClosePlan: { ...PARTIAL_CLOSE },
    suggestedRiskUsd: actualRiskLevel.suggestedRiskUsd,
    riskPercent:      actualRiskLevel.riskPercent,
    maxLossUsd:       actualRiskLevel.maxLossUsd,
    lotReason:        actualRiskLevel.lotReason,
    manualLotNote,
    riskUsd:          actualRiskLevel.suggestedRiskUsd,
    estimatedLot:     actualRiskLevel.estimatedLot,
    confidence,
    grade:            input.grade,
    proposalStatus,
    reasons:          reasons.slice(0, 6),
    warnings:         warnings.slice(0, 6),
    blockers:         [],
    nextAction:       resolveNextAction(proposalStatus, config.planType),
    professional,
  };
}

function makeBlockedPlan(
  config:      PlanConfig,
  dir:         "BUY" | "SELL",
  input:       GoldTradePlansInput,
  riskLevel:   { suggestedRiskUsd: number; riskPercent: number | null; estimatedLot: number; lotReason: string },
  rm:          RiskManagerResult,
  blockers:    string[],
  planAr:      string,
): TradePlan {
  const manualLotNote =
    input.manualLot != null && input.manualLot > 0
      ? `الخطة اليدوية: لوت ${input.manualLot.toFixed(2)} — ATR ${planAr}: لوت محظور`
      : null;

  return {
    planType:         config.planType,
    direction:        dir,
    entryType:        config.entryType,
    entry:            null,
    stopLoss:         null,
    takeProfit1:      null,
    takeProfit2:      null,
    takeProfit3:      null,
    rr1:              null,
    rr2:              null,
    rr3:              null,
    partialClosePlan: { ...PARTIAL_CLOSE },
    suggestedRiskUsd: riskLevel.suggestedRiskUsd,
    riskPercent:      riskLevel.riskPercent,
    maxLossUsd:       riskLevel.suggestedRiskUsd,
    lotReason:        riskLevel.lotReason,
    manualLotNote,
    riskUsd:          riskLevel.suggestedRiskUsd,
    estimatedLot:     null,
    confidence:       0,
    grade:            input.grade,
    proposalStatus:   "BLOCKED",
    reasons:          [],
    warnings:         [],
    blockers:         blockers.slice(0, 5),
    nextAction:       `الخطة ${planAr} محظورة — راجع أسباب المنع`,
    professional:     {
      whyThisPlan:          `الخطة ${planAr} محظورة — لا تُنفَّذ`,
      whenToEnter:          "—",
      whenNotToEnter:       "الآن — الشروط الأساسية غير مستوفاة",
      timingAssessment:     "WAIT",
      executionTimeframe:   "—",
      managementTimeframe:  "—",
      mtfSupportingFrames:  [],
      mtfConflictingFrames: [],
    },
  };
}

function makeWaitPlan(): TradePlan {
  return {
    planType:         "WAIT",
    direction:        "WAIT",
    entryType:        "WAIT",
    entry:            null,
    stopLoss:         null,
    takeProfit1:      null,
    takeProfit2:      null,
    takeProfit3:      null,
    rr1:              null,
    rr2:              null,
    rr3:              null,
    partialClosePlan: { ...PARTIAL_CLOSE },
    suggestedRiskUsd: 0,
    riskPercent:      null,
    maxLossUsd:       0,
    lotReason:        "لا صفقة — انتظار إشارة",
    manualLotNote:    null,
    riskUsd:          0,
    estimatedLot:     null,
    confidence:       0,
    grade:            "—",
    proposalStatus:   "WAIT",
    reasons:          [],
    warnings:         [],
    blockers:         [],
    nextAction:       "انتظر إشارة تقنية واضحة — لا فرصة حالياً",
    professional:     {
      whyThisPlan:          "لا توجد فرصة تداول في الوقت الحالي",
      whenToEnter:          "بعد ظهور إشارة تقنية واضحة",
      whenNotToEnter:       "الآن",
      timingAssessment:     "WAIT",
      executionTimeframe:   "—",
      managementTimeframe:  "—",
      mtfSupportingFrames:  [],
      mtfConflictingFrames: [],
    },
  };
}

function resolveNextAction(status: ProposalStatus, planType: PlanType): string {
  if (status === "BLOCKED")          return `الخطة ${planType === "CONSERVATIVE" ? "المحافظة" : planType === "BALANCED" ? "المتوازنة" : "الهجومية"} محظورة — راجع أسباب المنع`;
  if (status === "WAIT")             return "انتظر إشارة واضحة";
  if (status === "EXECUTION_READY") {
    if (planType === "CONSERVATIVE") return "جاهز للمراجعة — انتظر وصول السعر لمستوى LIMIT ثم استخدم زر MT5";
    return "جاهز للمراجعة — استخدم زر تنفيذ MT5 أدناه بعد التأكيد اليدوي";
  }
  if (planType === "AGGRESSIVE") return "الخطة الهجومية دائماً للمراجعة — تحقق من التحذيرات والفريمات";
  return "راجع التحذيرات وتوافق الفريمات — تحقق من RR والسبريد والشروط";
}

// ─── Best plan selection ──────────────────────────────────────────────────────

function selectBestPlan(plans: TradePlan[]): number | null {
  const order = [1, 0, 2]; // BALANCED → CONSERVATIVE → AGGRESSIVE
  for (const idx of order) {
    if (plans[idx]?.proposalStatus === "EXECUTION_READY") return idx;
  }
  for (const idx of order) {
    if (plans[idx]?.proposalStatus === "REVIEW") return idx;
  }
  return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildGoldTradePlans(input: GoldTradePlansInput): GoldTradePlansResult {
  if (input.analysisStatus !== "opportunity" || !input.direction) {
    return { plans: [makeWaitPlan()], bestPlanIdx: null };
  }

  const dir: "BUY" | "SELL" = input.direction === "bullish" ? "BUY" : "SELL";

  // ── Global blockers ────────────────────────────────────────────────────────
  const globalBlockers: string[] = [];

  if (!input.atr14 || input.atr14 <= 0) {
    globalBlockers.push("ATR غير متوفر — لا يمكن حساب وقف الخسارة");
  }
  if (input.criticalBlockCount > 0) {
    globalBlockers.push(`${input.criticalBlockCount} لجنة حرجة أصدرت BLOCK`);
  } else if (input.anyBlock) {
    globalBlockers.push("لجنة أصدرت BLOCK — يُنصح بعدم التنفيذ حتى يُحل");
  }

  const atr = input.atr14 ?? 0;

  // ── Risk Manager (uses actual ATR for SL estimation) ──────────────────────
  // Use ATR×1.5 as representative SL for initial risk level sizing
  const representativeSL = atr > 0 ? atr * 1.5 : 5;
  const riskManager = buildRiskLevels({
    userRiskUsdCap:       input.riskUsd,
    slDistance:           representativeSL,
    equity:               input.equity,
    freeMargin:           input.freeMargin,
    riskUsd:              input.riskUsd,
    riskPercentOfEquity:  input.riskPercentOfEquity,
  });

  // ── MTF analysis ───────────────────────────────────────────────────────────
  const mtfInfo = analyzeMTF(input.mtf, dir);

  // ── Build 3 plans ──────────────────────────────────────────────────────────
  const plans = PLAN_CONFIGS.map((cfg) =>
    buildPlan(cfg, input, dir, atr, riskManager, mtfInfo, [...globalBlockers]),
  );

  return { plans, bestPlanIdx: selectBestPlan(plans) };
}
