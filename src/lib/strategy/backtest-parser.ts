/**
 * MT5 Strategy Tester HTML/CSV backtest report parser.
 * Runs entirely client-side — no external API, no secrets.
 *
 * Supports two formats:
 *  - MT5 HTML report (exported from Strategy Tester → right-click → Save Report)
 *  - Simple CSV (header row + data rows, common columns auto-detected)
 */

export type BacktestSummary = {
  totalTrades:  number;
  winRate:      number;   // 0–100
  netProfit:    number;
  maxDrawdown:  number;   // percentage
  profitFactor: number;
  avgRR:        number;
  /** Raw text pairs extracted — useful for debugging */
  raw: Record<string, string>;
};

// --- HTML parser -------------------------------------------------------------

/**
 * Tries to extract a numeric value from HTML table rows whose first cell
 * contains any of the given keywords (case-insensitive, partial match).
 */
function extractFromTable(
  doc: Document,
  keywords: string[],
): string | null {
  const cells = Array.from(doc.querySelectorAll("td, th"));
  for (const cell of cells) {
    const text = cell.textContent?.trim().toLowerCase() ?? "";
    if (keywords.some((k) => text.includes(k.toLowerCase()))) {
      // Look for the next sibling td with a numeric value
      let next = cell.nextElementSibling;
      while (next) {
        const val = next.textContent?.trim() ?? "";
        if (/[\d.,-]+/.test(val)) return val;
        next = next.nextElementSibling;
      }
      // Or search the parent row's next cell
      const row = cell.closest("tr");
      if (row) {
        const tds = Array.from(row.querySelectorAll("td"));
        const idx = tds.indexOf(cell as HTMLTableCellElement);
        if (idx >= 0 && idx + 1 < tds.length) {
          const val = tds[idx + 1]?.textContent?.trim() ?? "";
          if (/[\d.,-]+/.test(val)) return val;
        }
      }
    }
  }
  return null;
}

function parseNum(raw: string | null | undefined, fallback = 0): number {
  if (!raw) return fallback;
  // Remove spaces, currency symbols, % signs; normalize commas
  const cleaned = raw.replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? fallback : n;
}

export function parseHtmlBacktest(html: string): BacktestSummary {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const raw: Record<string, string> = {};

  function grab(key: string, keywords: string[]): string {
    const val = extractFromTable(doc, keywords) ?? "";
    raw[key] = val;
    return val;
  }

  const totalTradesRaw  = grab("totalTrades",  ["total trades", "عدد الصفقات", "total deals"]);
  const netProfitRaw    = grab("netProfit",     ["total net profit", "صافي الربح", "net profit"]);
  const profitFactorRaw = grab("profitFactor",  ["profit factor", "معامل الربح"]);
  const drawdownRaw     = grab("maxDrawdown",   ["maximal drawdown", "max drawdown", "أقصى انخفاض", "drawdown"]);
  const profitTradesRaw = grab("profitTrades",  ["profit trades", "الصفقات الرابحة", "winning trades"]);
  const expectedPayoff  = grab("expectedPayoff",["expected payoff", "mathematical expectation", "العائد المتوقع"]);

  const totalTrades = parseNum(totalTradesRaw);

  // Win rate: look for "(% of total)" pattern first, then compute from trade counts
  let winRate = 0;
  const pctMatch = profitTradesRaw.match(/\(?\s*([\d.]+)\s*%/);
  if (pctMatch) {
    winRate = parseFloat(pctMatch[1]);
  } else if (totalTrades > 0) {
    const winCount = parseNum(profitTradesRaw);
    winRate = winCount > 0 ? (winCount / totalTrades) * 100 : 0;
  }

  // Drawdown: sometimes given as absolute value + %, we want %
  let maxDrawdown = parseNum(drawdownRaw);
  // If it looks like an absolute dollar value (>100 and no % sign visible)
  if (maxDrawdown > 100 && !drawdownRaw.includes("%")) {
    // Leave as-is — user can correct manually
  }

  // avgRR: use Expected Payoff / avg loss if available, else default
  const avgRR = parseNum(expectedPayoff) > 0 ? parseNum(expectedPayoff) : 0;

  return {
    totalTrades:  Math.round(totalTrades),
    winRate:      Math.min(100, Math.max(0, winRate)),
    netProfit:    parseNum(netProfitRaw),
    maxDrawdown:  Math.abs(maxDrawdown),
    profitFactor: parseNum(profitFactorRaw) || 1,
    avgRR:        avgRR || 1,
    raw,
  };
}

// --- CSV parser ---------------------------------------------------------------

export function parseCsvBacktest(csv: string): BacktestSummary {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return { totalTrades: 0, winRate: 0, netProfit: 0, maxDrawdown: 0, profitFactor: 1, avgRR: 1, raw: {} };
  }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.trim()));

  function colIdx(names: string[]): number {
    for (const n of names) {
      const i = headers.findIndex((h) => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  }

  const profitIdx = colIdx(["profit", "pnl", "gain"]);
  const rawRows: Record<string, string> = {};

  if (profitIdx < 0) {
    return { totalTrades: 0, winRate: 0, netProfit: 0, maxDrawdown: 0, profitFactor: 1, avgRR: 1, raw: rawRows };
  }

  const profits = rows
    .map((r) => parseFloat(r[profitIdx] ?? ""))
    .filter((n) => !isNaN(n));

  const totalTrades = profits.length;
  const wins        = profits.filter((p) => p > 0);
  const losses      = profits.filter((p) => p < 0);
  const winRate     = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const netProfit   = profits.reduce((a, b) => a + b, 0);
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss   = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 1;

  // Max drawdown
  let peak = 0;
  let equity = 0;
  let maxDD = 0;
  for (const p of profits) {
    equity += p;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  const avgWin  = wins.length  > 0 ? grossProfit / wins.length  : 0;
  const avgLoss = losses.length > 0 ? grossLoss   / losses.length : 0;
  const avgRR   = avgLoss > 0 ? avgWin / avgLoss : 1;

  return {
    totalTrades,
    winRate:      Math.min(100, Math.max(0, winRate)),
    netProfit,
    maxDrawdown:  maxDD,
    profitFactor,
    avgRR,
    raw:          rawRows,
  };
}
