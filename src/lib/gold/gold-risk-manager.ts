/**
 * gold-risk-manager.ts — Professional Risk Manager v1
 * ─────────────────────────────────────────────────────────────────────────────
 * يحسب 3 مستويات مخاطرة مهنية بناءً على رصيد الحساب:
 *   Conservative: 0.25% من الرصيد
 *   Balanced:     0.50% من الرصيد
 *   Aggressive:   1.00% من الرصيد
 *
 * مصادر الرصيد (بالأولوية):
 *   1. equity مباشرة من MT5 connection-status
 *   2. freeMargin من MT5 connection-status
 *   3. مشتق: riskUsd / (riskPercentOfEquity / 100)
 *   4. unknown
 *
 * userRiskUsdCap = سقف أعلى — لا تتجاوز أي خطة هذا السقف.
 * XAUUSD: 1 lot = 100 oz → رسوم الهامش لكل نقطة = $100/lot
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EquitySource = "mt5-direct" | "derived" | "unknown";

export type RiskLevel = {
  label:            "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
  targetPct:        number;          // 0.25 / 0.5 / 1.0
  suggestedRiskUsd: number;          // actual risk amount
  riskPercent:      number | null;   // % of equity (null if unknown)
  maxLossUsd:       number;          // = suggestedRiskUsd
  estimatedLot:     number;          // suggestedRiskUsd / (slDistance × 100)
  rawLot:           number;          // before clamping
  lotReason:        string;
  riskWarning:      string | null;
};

export type RiskManagerResult = {
  conservative: RiskLevel;
  balanced:     RiskLevel;
  aggressive:   RiskLevel;
  equityUsed:   number | null;
  equitySource: EquitySource;
};

export type RiskManagerInput = {
  userRiskUsdCap:       number;    // user's entered value — hard cap
  slDistance:           number;    // |entry - stopLoss|
  // Equity sources (priority order)
  equity?:              number;    // from MT5 connection-status (direct)
  freeMargin?:          number;    // from MT5 connection-status (fallback)
  riskUsd?:             number;    // for derivation
  riskPercentOfEquity?: number;    // for derivation
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const XAUUSD_CONTRACT = 100;   // 100 oz per standard lot
const MIN_LOT         = 0.01;
const MAX_LOT         = 2.0;
const WARN_LOT        = 1.0;

const RISK_TIERS = [
  { label: "CONSERVATIVE" as const, pct: 0.0025 },  // 0.25%
  { label: "BALANCED"     as const, pct: 0.005  },  // 0.50%
  { label: "AGGRESSIVE"   as const, pct: 0.01   },  // 1.00%
];

function resolveEquity(input: RiskManagerInput): { equity: number | null; source: EquitySource } {
  if (typeof input.equity === "number" && input.equity > 0) {
    return { equity: input.equity, source: "mt5-direct" };
  }
  if (typeof input.freeMargin === "number" && input.freeMargin > 0) {
    return { equity: input.freeMargin, source: "mt5-direct" };
  }
  if (
    typeof input.riskUsd              === "number" && input.riskUsd > 0 &&
    typeof input.riskPercentOfEquity  === "number" && input.riskPercentOfEquity > 0
  ) {
    const derived = input.riskUsd / (input.riskPercentOfEquity / 100);
    return { equity: derived > 0 ? derived : null, source: "derived" };
  }
  return { equity: null, source: "unknown" };
}

function clampLot(raw: number): number {
  return Math.max(MIN_LOT, Math.min(MAX_LOT, Math.round(raw * 100) / 100));
}

function buildRiskLevel(
  tier:       typeof RISK_TIERS[number],
  equity:     number | null,
  cap:        number,
  slDistance: number,
  source:     EquitySource,
): RiskLevel {
  const sl = slDistance > 0 ? slDistance : 1;   // guard against 0

  // ── Suggested risk amount ──────────────────────────────────────────────────
  let suggestedRiskUsd: number;
  let riskPercent:      number | null;

  if (equity != null && equity > 0) {
    const fromEquity = equity * tier.pct;
    suggestedRiskUsd = Math.min(fromEquity, cap);
    riskPercent      = (suggestedRiskUsd / equity) * 100;
  } else {
    // Fallback: proportional to cap when equity unknown
    suggestedRiskUsd = Math.round(cap * tier.pct * 4 * 100) / 100; // pct×4 → 1%,2%,4% of cap
    suggestedRiskUsd = Math.min(suggestedRiskUsd, cap);
    riskPercent      = null;
  }

  suggestedRiskUsd = Math.round(suggestedRiskUsd * 100) / 100;

  // ── Lot calculation ────────────────────────────────────────────────────────
  const rawLot       = suggestedRiskUsd / (sl * XAUUSD_CONTRACT);
  const estimatedLot = clampLot(rawLot);

  // ── Lot reason ─────────────────────────────────────────────────────────────
  const equityNote =
    source === "mt5-direct" ? "MT5 مباشر" :
    source === "derived"    ? "مشتق من التحليل" :
    "غير متوفر — نسبة تقريبية";

  const lotReason =
    `مخاطرة ${(tier.pct * 100).toFixed(2)}% (${equityNote}) × $${suggestedRiskUsd.toFixed(2)} ÷ ` +
    `(SL ${sl.toFixed(2)} × ${XAUUSD_CONTRACT}) = لوت ${estimatedLot.toFixed(2)}`;

  // ── Warnings ───────────────────────────────────────────────────────────────
  let riskWarning: string | null = null;

  if (rawLot > MAX_LOT) {
    riskWarning = `اللوت الخام (${rawLot.toFixed(2)}) تجاوز الحد — تم تقليصه إلى ${MAX_LOT}`;
  } else if (rawLot > WARN_LOT) {
    riskWarning = `لوت مرتفع نسبياً (${estimatedLot.toFixed(2)}) — تحقق من الهامش المتاح`;
  } else if (source === "unknown") {
    riskWarning = "رصيد الحساب غير متوفر — المبالغ تقريبية بناءً على سقف المخاطرة";
  }

  return {
    label:            tier.label,
    targetPct:        tier.pct * 100,
    suggestedRiskUsd,
    riskPercent:      riskPercent != null ? Math.round(riskPercent * 100) / 100 : null,
    maxLossUsd:       suggestedRiskUsd,
    estimatedLot,
    rawLot:           Math.round(rawLot * 10000) / 10000,
    lotReason,
    riskWarning,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildRiskLevels(input: RiskManagerInput): RiskManagerResult {
  const { equity, source } = resolveEquity(input);

  const [conservative, balanced, aggressive] = RISK_TIERS.map((tier) =>
    buildRiskLevel(tier, equity, input.userRiskUsdCap, input.slDistance, source),
  );

  return {
    conservative: conservative!,
    balanced:     balanced!,
    aggressive:   aggressive!,
    equityUsed:   equity,
    equitySource: source,
  };
}
