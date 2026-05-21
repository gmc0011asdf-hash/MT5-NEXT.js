/**
 * strategy-report-parser.ts — MT5 Strategy Tester HTML Report Parser v1
 * Gold-only: يقبل فقط تقارير XAUUSD كـ Candidate.
 * Pure TypeScript — بدون DOM API — بدون Next.js / Convex.
 * يعمل client-side وserver-side.
 *
 * هذا تحليل أولي استرشادي فقط — لا اعتماد للاستراتيجية — لا تنفيذ تداول.
 */

// ─── Output types ─────────────────────────────────────────────────────────────

export interface ParsedReport {
  strategyName:         string | null;
  symbol:               string | null;
  timeframe:            string | null;
  testPeriod:           string | null;
  deposit:              number | null;
  leverage:             string | null;
  totalTrades:          number | null;
  netProfit:            number | null;
  profitFactor:         number | null;
  drawdownPct:          number | null;
  drawdownAbs:          number | null;
  winRate:              number | null;
  maxConsecutiveLosses: number | null;
  averageWin:           number | null;
  averageLoss:          number | null;
  parseWarnings:        string[];
}

export type StrategyVerdict   = "Rejected" | "NeedsImprovement" | "Candidate";
export type SymbolStatus      = "Confirmed" | "Unknown" | "NotGold";

export interface StrategyEvaluation {
  verdict:      StrategyVerdict;
  symbolStatus: SymbolStatus;
  reasons:      string[];
  warnings:     string[];
}

// ─── Gold thresholds (XAUUSD-specific) ───────────────────────────────────────

const GOLD_THRESHOLDS = {
  minTrades:        30,    // hard minimum for statistical significance
  goodTrades:       50,    // preferred minimum
  minProfitFactor:  1.0,   // < 1.0 → Rejected
  goodProfitFactor: 1.3,   // < 1.3 → NeedsImprovement
  maxDrawdownPct:   35,    // > 35% → Rejected
  goodDrawdownPct:  20,    // > 20% → NeedsImprovement
} as const;

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  // Remove thousands separators (comma or space), keep decimal + sign
  const clean = raw.replace(/[,\s]/g, "").replace(/[^0-9.-]/g, "");
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function extractDrawdown(raw: string): { pct: number | null; abs: number | null } {
  const pctMatch = raw.match(/(-?\d+\.?\d*)\s*%/);
  const pct = pctMatch ? parseFloat(pctMatch[1]) : null;
  // Find all numbers; abs is the one that is not the percentage value
  const allNums = [...raw.matchAll(/(-?\d[\d, ]*\.?\d*)/g)]
    .map((m) => parseNumber(m[1]))
    .filter((n): n is number => n !== null && n !== pct);
  const abs = allNums[0] ?? null;
  return { pct, abs };
}

function extractPercentageOrFirst(raw: string): number | null {
  const pctMatch = raw.match(/(-?\d+\.?\d*)\s*%/);
  if (pctMatch) return parseFloat(pctMatch[1]);
  const parenMatch = raw.match(/\((-?\d+\.?\d*)\)/);
  if (parenMatch) return parseFloat(parenMatch[1]);
  return parseNumber(raw.split(/[\s(]/)[0]);
}

function extractFirstNumber(raw: string): number | null {
  const match = raw.match(/(-?\d[\d, ]*\.?\d*)/);
  return match ? parseNumber(match[1]) : null;
}

// ─── Table pair extractor ─────────────────────────────────────────────────────

/**
 * Extracts [label, value] pairs from all <tr><td>...<td>...</tr> rows.
 * Processes cells in step-2 pairs: (col0→col1), (col2→col3), etc.
 */
function extractTablePairs(html: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[1];
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(row)) !== null) {
      const text = stripTags(cellMatch[1]).replace(/:$/, "").trim();
      cells.push(text);
    }
    // Step-2 pairing: (label, value) (label, value) …
    for (let i = 0; i + 1 < cells.length; i += 2) {
      const label = cells[i];
      const value = cells[i + 1];
      if (label && value) pairs.push([label.toLowerCase(), value]);
    }
  }
  return pairs;
}

// ─── Label synonym lists ──────────────────────────────────────────────────────

const L_STRATEGY  = ["expert", "expert advisor", "ea", "strategy", "советник"];
const L_SYMBOL    = ["symbol", "символ"];
const L_PERIOD    = ["period", "timeframe", "период"];
const L_TESTPERIOD = ["modelling period", "test period", "тестируемый период"];
const L_DEPOSIT   = ["initial deposit", "deposit", "начальный депозит"];
const L_LEVERAGE  = ["leverage", "кредитное плечо"];
const L_TRADES    = ["total trades", "total deals", "all trades", "всего сделок", "number of trades"];
const L_NETPROFIT = ["total net profit", "net profit", "чистая прибыль"];
const L_PF        = ["profit factor", "профит-фактор"];
const L_DD        = ["maximal drawdown", "maximum drawdown", "max drawdown", "максимальная просадка", "макс. просадка"];
const L_WINRATE   = ["profit trades (% of total)", "winning trades", "win rate", "win %", "прибыльных сделок (%)"];
const L_CONSLOSS  = ["maximum consecutive losses", "max consecutive losses", "максимальные последовательные убытки"];
const L_AVGWIN    = ["average profit trade", "average win", "среднее значение прибыльных сделок"];
const L_AVGLOSS   = ["average loss trade", "average loss", "среднее значение убыточных сделок"];

function matchLabel(label: string, synonyms: string[]): boolean {
  const l = label.toLowerCase().trim();
  return synonyms.some((s) => l === s || l.startsWith(s) || l.includes(s));
}

// ─── Main parser ─────────────────────────────────────────────────────────────

export function parseStrategyReport(html: string): ParsedReport {
  const warnings: string[] = [];
  const report: ParsedReport = {
    strategyName: null, symbol: null, timeframe: null, testPeriod: null,
    deposit: null, leverage: null, totalTrades: null, netProfit: null,
    profitFactor: null, drawdownPct: null, drawdownAbs: null,
    winRate: null, maxConsecutiveLosses: null, averageWin: null,
    averageLoss: null, parseWarnings: warnings,
  };

  if (!html || html.trim().length < 50) {
    warnings.push("المحتوى فارغ أو قصير جداً — الصق HTML كامل لتقرير Strategy Tester");
    return report;
  }

  const pairs = extractTablePairs(html);

  for (const [label, value] of pairs) {
    if (!report.strategyName && matchLabel(label, L_STRATEGY)) {
      report.strategyName = value || null;
    }

    if (!report.symbol && matchLabel(label, L_SYMBOL)) {
      // Extract just the ticker (XAUUSD) from possible "XAUUSD, H1, ..." or "XAUUSD.PRO"
      const symMatch = value.match(/^([A-Z0-9.]{3,12})/);
      report.symbol = symMatch ? symMatch[1].replace(/\.$/, "") : value.trim() || null;
    }

    if (!report.timeframe && matchLabel(label, L_PERIOD)) {
      const tfMatch = value.match(/^(M\d+|H\d+|D1|W1|MN)/i);
      report.timeframe = tfMatch ? tfMatch[1].toUpperCase() : (value.split(/[\s(]/)[0] ?? null);
      // Try to extract embedded test period from "(2024.01.01 - 2024.12.31)"
      if (!report.testPeriod) {
        const dateMatch = value.match(/\((\d{4}[\.\-]\d{2}[\.\-]\d{2}\s*[-–]\s*\d{4}[\.\-]\d{2}[\.\-]\d{2})\)/);
        if (dateMatch) report.testPeriod = dateMatch[1];
      }
    }

    if (!report.testPeriod && matchLabel(label, L_TESTPERIOD)) {
      report.testPeriod = value || null;
    }

    if (report.deposit === null && matchLabel(label, L_DEPOSIT)) {
      report.deposit = extractFirstNumber(value);
    }

    if (!report.leverage && matchLabel(label, L_LEVERAGE)) {
      report.leverage = value.trim() || null;
    }

    if (report.totalTrades === null && matchLabel(label, L_TRADES)) {
      report.totalTrades = extractFirstNumber(value);
    }

    if (report.netProfit === null && matchLabel(label, L_NETPROFIT)) {
      report.netProfit = extractFirstNumber(value);
    }

    if (report.profitFactor === null && matchLabel(label, L_PF)) {
      report.profitFactor = extractFirstNumber(value);
    }

    if (report.drawdownPct === null && matchLabel(label, L_DD)) {
      const dd = extractDrawdown(value);
      report.drawdownPct = dd.pct;
      report.drawdownAbs = dd.abs;
    }

    if (report.winRate === null && matchLabel(label, L_WINRATE)) {
      report.winRate = extractPercentageOrFirst(value);
    }

    if (report.maxConsecutiveLosses === null && matchLabel(label, L_CONSLOSS)) {
      report.maxConsecutiveLosses = extractFirstNumber(value);
    }

    if (report.averageWin === null && matchLabel(label, L_AVGWIN)) {
      report.averageWin = extractFirstNumber(value);
    }

    if (report.averageLoss === null && matchLabel(label, L_AVGLOSS)) {
      report.averageLoss = extractFirstNumber(value);
    }
  }

  // Build parse warnings for missing critical fields
  if (!report.symbol)               warnings.push("تعذّر استخراج رمز الزوج من التقرير");
  if (report.totalTrades === null)  warnings.push("تعذّر استخراج عدد الصفقات");
  if (report.profitFactor === null) warnings.push("تعذّر استخراج Profit Factor");
  if (report.netProfit === null)    warnings.push("تعذّر استخراج صافي الربح");
  if (report.drawdownPct === null)  warnings.push("تعذّر استخراج نسبة الانخفاض");

  return report;
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

export function evaluateReport(report: ParsedReport): StrategyEvaluation {
  const warnings: string[] = [...report.parseWarnings];

  // Determine symbol status
  const sym = report.symbol?.toUpperCase().trim() ?? null;
  let symbolStatus: SymbolStatus;
  if (!sym) {
    symbolStatus = "Unknown";
  } else if (sym === "XAUUSD" || sym === "XAUUSD.PRO" || sym === "GOLD" || sym === "XAUUSD.R") {
    symbolStatus = "Confirmed";
  } else {
    symbolStatus = "NotGold";
  }

  // ── Hard rejection conditions ─────────────────────────────────────────────
  const rejectReasons: string[] = [];

  if (symbolStatus === "NotGold") {
    rejectReasons.push(`الرمز "${report.symbol}" ليس XAUUSD — مرفوض تلقائياً`);
  }
  if (report.netProfit !== null && report.netProfit <= 0) {
    rejectReasons.push(`صافي الربح سلبي أو صفر (${report.netProfit.toFixed(2)})`);
  }
  if (report.profitFactor !== null && report.profitFactor < GOLD_THRESHOLDS.minProfitFactor) {
    rejectReasons.push(
      `Profit Factor أقل من ${GOLD_THRESHOLDS.minProfitFactor} (${report.profitFactor.toFixed(2)}) — الاستراتيجية خاسرة`
    );
  }
  if (report.totalTrades !== null && report.totalTrades < GOLD_THRESHOLDS.minTrades) {
    rejectReasons.push(
      `عدد الصفقات أقل من الحد الأدنى (${report.totalTrades} < ${GOLD_THRESHOLDS.minTrades}) — إحصاء غير كافٍ`
    );
  }
  if (report.drawdownPct !== null && report.drawdownPct > GOLD_THRESHOLDS.maxDrawdownPct) {
    rejectReasons.push(
      `الانخفاض مرتفع جداً (${report.drawdownPct.toFixed(1)}% > ${GOLD_THRESHOLDS.maxDrawdownPct}%)`
    );
  }

  if (rejectReasons.length > 0) {
    return { verdict: "Rejected", symbolStatus, reasons: rejectReasons, warnings };
  }

  // ── NeedsImprovement conditions ──────────────────────────────────────────
  const improvementReasons: string[] = [];

  if (symbolStatus === "Unknown") {
    improvementReasons.push("رمز الزوج غير واضح في التقرير — مطلوب التحقق يدوياً قبل المتابعة");
  }
  if (report.profitFactor !== null && report.profitFactor < GOLD_THRESHOLDS.goodProfitFactor) {
    improvementReasons.push(
      `Profit Factor مقبول لكن يحتاج تحسين (${report.profitFactor.toFixed(2)} < ${GOLD_THRESHOLDS.goodProfitFactor})`
    );
  }
  if (report.drawdownPct !== null && report.drawdownPct > GOLD_THRESHOLDS.goodDrawdownPct) {
    improvementReasons.push(
      `الانخفاض يحتاج تحسين (${report.drawdownPct.toFixed(1)}% > ${GOLD_THRESHOLDS.goodDrawdownPct}%)`
    );
  }
  if (report.totalTrades !== null && report.totalTrades < GOLD_THRESHOLDS.goodTrades) {
    improvementReasons.push(
      `عدد الصفقات مقبول لكن يُفضّل المزيد (${report.totalTrades} < ${GOLD_THRESHOLDS.goodTrades})`
    );
  }
  const missingCount = [report.netProfit, report.profitFactor, report.drawdownPct, report.totalTrades]
    .filter((v) => v === null).length;
  if (missingCount >= 2) {
    improvementReasons.push(`${missingCount} حقول مهمة غير مكتملة — تحقق من تنسيق التقرير`);
  }
  // Must have confirmed XAUUSD to be a Candidate
  if (symbolStatus !== "Confirmed") {
    improvementReasons.push("لا يمكن اعتماد التقرير كـ Candidate إلا عند تأكيد رمز XAUUSD");
  }

  if (improvementReasons.length > 0) {
    return { verdict: "NeedsImprovement", symbolStatus, reasons: improvementReasons, warnings };
  }

  // ── Candidate ─────────────────────────────────────────────────────────────
  const candidateReasons: string[] = ["الرمز XAUUSD مؤكّد"];
  if (report.netProfit !== null)    candidateReasons.push(`صافي الربح موجب: ${report.netProfit.toFixed(2)}`);
  if (report.profitFactor !== null) candidateReasons.push(`Profit Factor جيد: ${report.profitFactor.toFixed(2)}`);
  if (report.drawdownPct !== null)  candidateReasons.push(`الانخفاض ضمن الحدود: ${report.drawdownPct.toFixed(1)}%`);
  if (report.totalTrades !== null)  candidateReasons.push(`عدد صفقات كافٍ: ${report.totalTrades}`);

  return { verdict: "Candidate", symbolStatus, reasons: candidateReasons, warnings };
}
