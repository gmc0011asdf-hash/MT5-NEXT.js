# DEVELOPMENT ROADMAP — نظام الملك الهندسي للتداول العالمي

> System type: Institutional-grade risk-controlled analysis system  
> Created: 2026-04-28  
> Principle: Reduce error. Reject weak setups. Never claim guaranteed accuracy.

---

## Core Safety Principle

This system is designed to **reduce trading error and enforce institutional discipline**.  
It does **not** and **will not** guarantee profitable outcomes.  
Every stage that approaches execution must pass: backtesting → paper trading → risk locks → explicit approval.  
Live execution is Stage 14 and requires explicit project owner sign-off.

---

## Stage 0 — Stabilization and Baseline

**Goal:** Verify the entire stack runs cleanly before any feature work.

### Tasks

| Task | Command | Pass Criteria |
|---|---|---|
| Install dependencies | `pnpm install` | No errors |
| TypeScript check | `pnpm exec tsc --noEmit` | Zero errors |
| Production build | `pnpm build` | All 12 pages compile |
| Python syntax check | `python -m py_compile mt5_readonly_service/main.py` | No errors |
| Convex codegen | `pnpm exec convex codegen` | _generated/ up to date |
| Dev server smoke test | `pnpm dev` → open /dashboard | Page loads, no console errors |
| Python service test | `uvicorn main:app --host 127.0.0.1 --port 8010` → GET /health | `{"status":"ok","read_only_mode":true}` |

### Gate items (do before Stage 1)

- [ ] Gate `/convex-core` and `/convex-test` pages behind `NODE_ENV === "development"` check or remove from NAV_GROUPS in production
- [ ] Add `.env.local.example` documenting all required variables
- [ ] Move Python service URL `127.0.0.1:8010` to env var `MT5_SERVICE_URL`
- [ ] Confirm Convex deployment is connected (check `NEXT_PUBLIC_CONVEX_URL` in .env.local)
- [ ] Document exact run commands for all services in README

### Run commands (document in README)

```bash
# 1. Start Python MT5 service (Windows only)
cd mt5_readonly_service
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8010

# 2. Start Next.js development server
pnpm dev

# 3. Type check
pnpm exec tsc --noEmit

# 4. Production build
pnpm build

# 5. Convex codegen (after schema changes)
pnpm exec convex codegen
```

---

## Stage 1 — Real Data Truthfulness

**Goal:** Every value shown in the UI must be either real data from MT5/Convex or an honest empty state. No fake values presented as real.

### Tasks

- [ ] Add `[DEMO]` or `[تجريبي]` badge to all components using mock market stream (`LiveMarketCard`, `LiveMarketTicker`, `MiniMarketSparkline`, `MarketPulseIndicator`)
- [ ] Add honest empty state to `DashboardActivitySection` when no real signals: "لا توجد إشارات حقيقية — قم بالمزامنة أولاً"
- [ ] Replace mock monitoring fallback in `monitoring-snapshot-provider.tsx` with loading skeleton, not fake "ok" values
- [ ] Differentiate three empty states across all pages:
  - "MT5 غير متصل — افتح المنصة وابدأ الخدمة"
  - "MT5 متصل — لم تتم مزامنة البيانات بعد"
  - "لا توجد بيانات في الفترة المحددة"
- [ ] Verify `AppHeader` shows only real data from `useMt5ConnectionStatus` (already correct — verify no fallback mock)
- [ ] Verify `AppSidebar` has no status data (already correct after previous refactor)
- [ ] Verify Dashboard account cards use `getMyLatestRealMt5AccountSnapshot` not demo snapshot

**Files affected:** `DashboardActivitySection.tsx`, `LiveMarketCard.tsx`, `LiveMarketTicker.tsx`, `MiniMarketSparkline.tsx`, `MarketPulseIndicator.tsx`, `monitoring-snapshot-provider.tsx`, `dashboard/page.tsx`

**Test:** Open /dashboard with MT5 disconnected → all widgets show honest disconnected state, no fake prices visible.

---

## Stage 2 — MT5 Local Read-Only Agent Hardening

**Goal:** The Python service must be production-grade — handle all edge cases gracefully, never crash, never expose trading functions.

### Tasks

- [ ] **Health endpoint improvement** — add `uptime_seconds`, `build_version`, `last_successful_mt5_call_at`, `symbols_configured` to `/health` response
- [ ] **Connection-status improvement** — add `last_check_at` (ISO timestamp), `leverage`, `company` to response payload
- [ ] **Terminal path validation** — validate `terminal_path` exists on disk before attempting `mt5.initialize(path=...)`; return clear error if not found
- [ ] **Disconnected terminal handling** — if `mt5.account_info()` returns None, return structured error with Arabic message, not 500
- [ ] **Market closed state** — detect `mt5.symbol_info_tick()` returning stale timestamps; annotate response with `market_closed: true` when bid/ask timestamp > 4h old
- [ ] **Missing symbols handling** — if a requested symbol is not in Market Watch, return per-symbol error object rather than failing the whole request
- [ ] **Rate limiting** — add simple token bucket or `slowapi` rate limiter on `/readonly/candles` (max 10 req/min per IP)
- [ ] **Env var for service URL** — replace hardcoded `127.0.0.1:8010` across all Next.js API routes with `process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010"`
- [ ] **Consistent timeouts** — standardize all Next.js proxy timeouts to 8 seconds
- [ ] **Request correlation** — pass `X-Request-ID` header from Next.js proxy to Python service for log correlation
- [ ] **Reconnection logic** — if Python service is running but MT5 is disconnected, auto-attempt `mt5.initialize()` on each request (already partially done, verify)

**No trading functions to be added. No order_send, order_close, order_modify.**

---

## Stage 3 — Convex Persistence Foundation

**Goal:** Ensure the database layer is scalable, deduplicated, and indexed correctly before building features on top of it.

### Tasks

- [ ] **Pagination on all queries** — replace `.collect()` with `.paginate()` on `mt5Candles`, `mt5MarketTicks`, `mt5TradeHistoryDeals`, `auditEvents`; use cursor-based pagination
- [ ] **Market ticks TTL** — add Convex scheduled action to delete `mt5MarketTicks` older than 7 days
- [ ] **Candle deduplication** — before inserting a candle in `syncMt5Candles`, check if `(userId, symbol, timeframe, time)` exists; skip if so
- [ ] **Account snapshot deduplication** — only insert new account snapshot if balance/equity/margin changed from last snapshot
- [ ] **Symbols catalog upsert** — replace insert-only with upsert by `(userId, name)` to avoid duplicate symbol rows
- [ ] **Trade history deals deduplication** — check by `(userId, ticket)` before inserting
- [ ] **Monitoring status upsert** — `monitoringStatus` should upsert by `(userId, component)`, not insert new rows
- [ ] **Scheduled sync action** — create Convex scheduled action (cron) to call `syncReadOnlySnapshotFromLocalService` every 60 seconds for connected users
- [ ] **Indexes audit** — verify all queries use indexed fields; add missing compound indexes
- [ ] **Source field validation** — enforce `source` field enum: `"mt5-local-readonly"`, `"mt5-bridge-read-only-stub"`, `"core-demo-seed"`, `"computed"`

---

## Stage 4 — Candle Persistence and Data Quality

**Goal:** Real OHLCV candles from MT5 are the foundation of all analysis. They must be clean, deduplicated, and fresh.

### Tasks

- [ ] **Candle sync pipeline** — build a reliable sync loop: for each enabled symbol × timeframe, fetch latest N candles, deduplicate, insert new ones
- [ ] **Last-synced tracking** — store `lastSyncedCandleTime` per `(userId, symbol, timeframe)` in a metadata table; only fetch candles newer than last synced
- [ ] **OHLC validation** — validate before insert: `open > 0`, `high >= open`, `high >= close`, `low <= open`, `low <= close`, `volume >= 0`; reject and log invalid candles
- [ ] **Candle freshness display** — show "آخر شمعة: منذ X دقيقة" on all chart/indicator views; warn if candles are older than 2× the timeframe
- [ ] **Supported timeframes** — M1, M5, M15, M30, H1, H4, D1, W1; document which are enabled by default
- [ ] **Candle count limits** — ensure no single sync requests more than 1000 candles (already enforced in Python); enforce in Convex mutation too
- [ ] **Candle gaps detection** — detect missing bars in a series; log gaps; do not silently skip
- [ ] **Duplicate write prevention** — if a candle with same `(userId, symbol, timeframe, time)` already exists and OHLC matches, skip; if OHLC differs (MT5 history revision), update it and log the revision

---

## Stage 5 — Technical Indicators Foundation

**Goal:** All technical indicators are computed from real MT5 candles stored in Convex. No indicators from mock data.

### Indicators to implement / verify

| Indicator | Parameters | Minimum candles needed |
|---|---|---|
| EMA | 20, 50, 200 | 200 |
| RSI | 14 | 15 |
| ATR | 14 | 15 |
| MACD | 12, 26, 9 signal | 35 |
| Bollinger Bands | 20, 2σ | 20 |
| Momentum | 10 period | 11 |

### Tasks

- [ ] **Guard: minimum candles** — do not compute any indicator if fewer than required candles are available; return `{computed: false, reason: "insufficient_candles"}` instead
- [ ] **Guard: real candles only** — refuse to compute if candles have `source !== "mt5-local-readonly"`
- [ ] **Freshness guard** — do not compute if newest candle is older than 2× timeframe (market likely closed or not synced)
- [ ] **Per-symbol/timeframe deduplication** — only compute if last computation is older than 1× timeframe
- [ ] **Store full result** — store computed values with `computedAt`, `candleCount`, `newestCandleTime` for auditability
- [ ] **Trend bias label** — `"صاعد"`, `"هابط"`, `"محايد"` based on EMA alignment (EMA20 > EMA50 > EMA200 = bullish)
- [ ] **Momentum bias label** — `"قوي"`, `"ضعيف"`, `"محايد"` based on RSI and MACD
- [ ] **Display freshness** — show `computedAt` on lab page; warn if stale
- [ ] **Volatility** — ATR as percentage of price; label `"منخفضة"`, `"عادية"`, `"مرتفعة"` vs historical ATR

---

## Stage 6 — Market Structure Engine

**Goal:** Identify key price levels and market context from real candle data.

### Tasks

- [ ] **Swing highs/lows** — detect N-bar fractal highs and lows (e.g. 5-bar left/right)
- [ ] **Support / resistance levels** — horizontal levels from recent swing points; cluster nearby levels within ATR/4
- [ ] **Break of Structure (BOS)** — detect when price closes beyond last confirmed swing high/low
- [ ] **Change of Character (CHoCH)** — detect first opposite BOS after a trend
- [ ] **Liquidity sweep** — detect when price wicks beyond swing high/low then returns; flag as potential sweep
- [ ] **Candle pattern detection** — engulfing, pinbar/hammer, inside bar; annotate on candle series
- [ ] **Multi-timeframe alignment** — check trend bias on D1, H4, H1; require alignment for signal validity
- [ ] **Data quality gate** — if candles are stale or fewer than minimum, return `{structureValid: false}` and do not produce structure signals
- [ ] **Store structure snapshots** — persist in Convex `mt5StructureSnapshots` table (add to schema)

**No trade recommendations without passing data quality gate.**

---

## Stage 7 — Protection Mind

**Goal:** A veto system that blocks analysis output when market conditions, risk limits, or data quality fail.

### Filters to implement

| Filter | Trigger | Action |
|---|---|---|
| Market closed | Price timestamp > 4h stale | Block analysis, show warning |
| Spread too wide | Spread > N × ATR | Block signal, log protection event |
| Volatility extreme | ATR > 3× 20-day average ATR | Downgrade confidence, log |
| High-impact news | Placeholder — interface only | Interface for future news API |
| Max daily analysis count | Configurable per user | Pause analysis if exceeded |
| Max symbol exposure | Configurable per user | Block additional signals on same symbol |
| Cooldown after rejection | 30 min after rejected setup | Block re-analysis on same symbol |
| Data quality fail | Candles stale, insufficient, or from wrong source | Hard block — no signal produced |
| Governance read-only | `governance.readOnly === true` | Block all execution preview |

### Tasks

- [ ] Implement protection filter chain as pure functions
- [ ] Each filter returns `{passed: boolean, reason: string, severity: "info"|"warning"|"block"}`
- [ ] Log all non-passing filters to `protectionEvents` table
- [ ] Show protection veto reasons on Lab page in Arabic
- [ ] Add protection summary card to Dashboard
- [ ] No filter can be bypassed without explicit config change and audit log

---

## Stage 8 — Market Mind

**Goal:** Combine all data sources into a structured analysis output. Produce a score, confidence, and Arabic explanation. Never fake certainty.

### Output structure

```typescript
type MarketMindOutput = {
  symbol: string;
  timeframe: string;
  analysedAt: string;          // ISO
  dataQualityPassed: boolean;
  protectionPassed: boolean;
  score: number;               // 0–100, never rounded to 100
  confidenceLabel: "منخفضة" | "متوسطة" | "عالية";
  trendBias: string;
  momentumBias: string;
  structureSummary: string;
  multiTimeframeAlignment: boolean;
  rejectionReasons: string[];  // Arabic, populated if score < threshold
  explanation: string;         // Full Arabic narrative
  computedFromCandles: number;
  newestCandleTime: string;
};
```

### Tasks

- [ ] Implement score weighting: trend alignment (30%), momentum (20%), structure (25%), multi-TF (15%), volatility fit (10%)
- [ ] Confidence thresholds: < 40 = منخفضة, 40–69 = متوسطة, ≥ 70 = عالية
- [ ] Never output confidence "عالية" if any protection filter failed
- [ ] Generate Arabic explanation from component scores
- [ ] Populate `rejectionReasons` array whenever score < 50 or protection blocked
- [ ] Store in `labSignalSnapshots` with full audit fields
- [ ] Display on Lab page with clear score visualization
- [ ] Add disclaimer: "هذا تحليل معلوماتي — ليس توصية مالية"

---

## Stage 9 — Execution Mind Preview Only

**Goal:** Calculate what a trade WOULD look like — entry, SL, TP, lot size — without any real order. Preview only. Nothing sent to MT5.

### Tasks

- [ ] Calculate entry price from current bid/ask + spread allowance
- [ ] Calculate SL from structure (nearest swing or ATR multiple)
- [ ] Calculate TP from structure (next resistance or RR multiple)
- [ ] Calculate RR ratio; reject if < 1.5
- [ ] Calculate lot size from `riskAmountUSD` and pip value
- [ ] Validate `symbol_info` from MT5: min lot, max lot, lot step, stop level
- [ ] Validate that SL distance > `stop_level` (MT5 minimum)
- [ ] Validate that spread is within acceptable range for this symbol
- [ ] Store preview in `committeeReports` with `executionPreview: true` flag
- [ ] Display on Lab page under "معاينة الصفقة (قراءة فقط)"
- [ ] Show clear warning: "هذه معاينة فقط — لا يتم تنفيذ أي أوامر"
- [ ] `order_send` must NOT be called. No execution code of any kind.

---

## Stage 10 — Backtesting System

**Goal:** Test any analysis configuration against historical candles before accepting it as valid.

### Tasks

- [ ] Build backtest engine: iterate candle series, apply analysis at each bar, record simulated entry/exit
- [ ] Track: win rate, loss rate, average win, average loss, profit factor, max drawdown, max consecutive losses, Sharpe ratio approximation
- [ ] Minimum history requirement: 200 bars per timeframe tested
- [ ] Minimum sample size for acceptance: 30 trades (statistical significance floor)
- [ ] Store backtest results in new `backtestRuns` Convex table
- [ ] Show results in reports page: Arabic summary + numerical breakdown
- [ ] Reject any configuration with profit factor < 1.2 or win rate < 40%
- [ ] Visual equity curve chart using Recharts
- [ ] No configuration moves to Stage 11 without a passing backtest

---

## Stage 11 — Paper Trading / Simulation Mode

**Goal:** Simulate orders against live MT5 data without any real execution. Validate that live signals match paper outcomes.

### Tasks

- [ ] Paper order table in Convex: `paperOrders` — entry, SL, TP, lot, status, open/close time, pnl_pips, pnl_usd
- [ ] On signal: create paper order if confidence ≥ threshold and protection passed
- [ ] Close paper order when price hits SL or TP based on real MT5 ticks
- [ ] Track paper PnL cumulatively per user
- [ ] Paper trading report: win rate, total pnl, drawdown
- [ ] Compare paper signal results with backtest expectations
- [ ] Run paper mode for minimum 2 weeks before Stage 14 consideration
- [ ] `order_send` must NOT be called. This is simulation only.

---

## Stage 12 — Reports and Monitoring

**Goal:** Complete visibility into all system activity — real trades (from MT5 history), signals, rejections, paper trades, and system health.

### Tasks

- [ ] **Real MT5 account report** — equity curve from `mt5AccountSnapshots`, drawdown from peak, daily PnL
- [ ] **Trade history analysis** — from `mt5TradeHistoryDeals`: win rate, average win/loss, best/worst trade, by symbol
- [ ] **Signal performance** — from `labSignalSnapshots`: how many signals produced, rejected, accepted; breakdown by symbol
- [ ] **Protection veto report** — from `protectionEvents`: most common rejection reasons, by symbol, by time
- [ ] **Data freshness dashboard** — candle age per symbol/timeframe, last account sync, last tick sync
- [ ] **MT5 connection uptime** — track `monitoringStatus` history; compute % uptime over 7/30 days
- [ ] **Rejection reasons word cloud / list** — show top rejection reasons in Arabic
- [ ] All reports export-ready (CSV or JSON format)

---

## Stage 13 — UI/UX Institutional Polish

**Goal:** The interface must look and behave like a professional institutional tool, not a demo project.

### Tasks

- [ ] Arabic RTL consistency audit across all pages
- [ ] Remove all demo/mock data from visible UI (see Fake/Demo Data Removal Plan)
- [ ] Replace all empty states with honest, specific Arabic messages
- [ ] Dashboard: replace mock market cards with real MT5 tick cards (with "غير متصل" fallback)
- [ ] Replay page: integrate with real Convex candles instead of manual JSON input
- [ ] Responsive layout: no horizontal scroll on any screen size
- [ ] Header: compact on smaller screens, full on desktop
- [ ] Sidebar: active state clear, groups auto-open, no ugly scrollbar
- [ ] All number formatting: Arabic numerals or consistent Latin with Arabic labels
- [ ] All timestamps: Arabic locale formatted with `ar-SA`
- [ ] Loading skeletons on all async data sections
- [ ] Error boundaries on all page sections
- [ ] Disclaimer footer: "هذا النظام للتحليل المعلوماتي فقط — ليس توصية مالية"

---

## Stage 14 — Optional Future Live Execution Gate

> **THIS STAGE IS DISABLED. DO NOT IMPLEMENT WITHOUT EXPLICIT PROJECT OWNER APPROVAL.**

### Prerequisites (ALL must pass before Stage 14 begins)

- [ ] Stage 10 backtest passed (profit factor ≥ 1.2, min 30 trades, min 200 bar history)
- [ ] Stage 11 paper trading ran for ≥ 2 weeks with positive results
- [ ] Risk limits configured and active (max daily risk, max positions, max lot)
- [ ] Kill switch implemented and tested
- [ ] Execution lock: every order requires re-confirmation within 30 seconds
- [ ] Duplicate order guard: no two orders for same symbol within 5 minutes
- [ ] All executions logged to `auditEvents` with full context
- [ ] Demo account testing completed first (MT5 demo account, not real)
- [ ] Project owner has reviewed and signed off in writing
- [ ] `governance.tradingEnabled` flipped to `true` explicitly by owner

### When approved — safety requirements

- Only `order_send` with validated parameters
- Hard stop on daily loss limit
- Hard stop on total open positions limit
- Every order: ticket number logged before confirmation
- On error: log full MT5 error code + Arabic description
- One-click kill switch on dashboard visible at all times
- No modification of existing SL/TP without explicit separate approval

---

## Stage Summary Table

| Stage | Name | Risk Level | Blocks Next Stage |
|---|---|---|---|
| 0 | Stabilization | None | Yes |
| 1 | Real Data Truthfulness | Low | No |
| 2 | MT5 Agent Hardening | Low | No |
| 3 | Convex Persistence Foundation | Low-Medium | Yes |
| 4 | Candle Persistence & Quality | Medium | Yes |
| 5 | Technical Indicators | Medium | Yes |
| 6 | Market Structure Engine | Medium | Yes |
| 7 | Protection Mind | Medium-High | Yes |
| 8 | Market Mind | Medium | No |
| 9 | Execution Mind Preview | Medium | Yes (for 10+) |
| 10 | Backtesting | Medium | Yes (for 11+) |
| 11 | Paper Trading | Medium | Yes (for 14) |
| 12 | Reports & Monitoring | Low | No |
| 13 | UI/UX Polish | Low | No |
| 14 | Live Execution Gate | **CRITICAL** | **DISABLED** |
