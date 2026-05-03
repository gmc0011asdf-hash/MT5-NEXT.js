# MT5 DOMAIN REVIEW

_Date: 2026-05-02 | Auditor: MT5 Domain Teammate (Claude Sonnet 4.6)_
_Project root: `MT5-NEXT.js-main/MT5-NEXT.js-main`_
_Scope: read-only audit. No source files were modified._

---

## 1. Python Service Inventory

**File:** `mt5_readonly_service/main.py`
**Build version:** `0.2.0`
**Framework:** FastAPI + Pydantic + `MetaTrader5` library

### Safety switches

| Constant | Value | Purpose |
|---|---|---|
| `READ_ONLY_MODE` | `True` (hardcoded) | Global guard; `_enforce_read_only_policy()` is called at the top of every endpoint |
| `FORBIDDEN_MT5_FUNCTION_NAMES` | `("order_send","order_close","order_modify","order_check")` | Documentation anchor; the names are never imported or called |

`_enforce_read_only_policy()` raises `RuntimeError` if `READ_ONLY_MODE` is not `True` — this is called before any endpoint proceeds.

### Endpoints

| Method | Path | MT5 API used | Notes |
|---|---|---|---|
| `POST` | `/connect` | `mt5.initialize(path, login, password, server)` + `mt5.account_info()` | Validates terminal path; shuts down after response |
| `GET` | `/connection-status` | `mt5.initialize()` + `mt5.account_info()` | Returns `read_only: true` always |
| `GET` | `/health` | `mt5.initialize()` | Returns uptime, build version, configured symbols |
| `GET` | `/readonly/account` | `mt5.account_info()` | Balance, equity, margin |
| `GET` | `/readonly/ticks` | `mt5.symbol_select()` + `mt5.symbol_info_tick()` + `mt5.symbol_info()` | Bid/ask/spread per symbol; stale tick detection |
| `GET` | `/readonly/positions` | `mt5.positions_get()` | Open positions; no modification |
| `GET` | `/readonly/snapshot` | All three above combined | One-shot account + ticks + positions |
| `GET` | `/readonly/symbols` | `mt5.symbols_get()` | Symbol catalog; supports `visibleOnly`, `limit`, `search` |
| `GET` | `/readonly/history-deals` | `mt5.history_deals_get(from, to)` | Closed deals; `days` (1-365) and optional `symbol` filter |
| `GET` | `/readonly/candles` | `mt5.symbol_select()` + `mt5.copy_rates_from_pos()` | OHLCV; supports `symbols`, `timeframes` (CSV), `count` (max 1000) |

### Timeframe support

`M1, M5, M15, M30, H1, H4, D1` via `_TIMEFRAME_MAP`.

### Other notable design details

- Custom `Utf8JsonResponse` serialises with `ensure_ascii=False` to fix PowerShell 5.1 Arabic mojibake.
- `_STALE_TICK_THRESHOLD_SECONDS = 4 * 3600` — ticks older than 4 hours are flagged as stale / market closed.
- `mt5.shutdown()` is always called in `finally` blocks — prevents terminal handle leaks.
- Symbol metadata returned by `/readonly/symbols` includes lot-sizing fields (`trade_tick_value`, `trade_tick_size`, `volume_min/max/step`, `stops_level`, `freeze_level`) needed for client-side risk/lot calculation — no `order_send` involved.

---

## 2. Convex MT5 Mutations

**File:** `convex/mt5Bridge.ts`

All mutations enforce `tradingEnabled: false` and `readOnly: true` via `enforceGovernanceReadOnly()` before returning. None call any trading function.

| Mutation | Tables written | Purpose |
|---|---|---|
| `demoSyncReadOnlySnapshotsFromMt5Stub` | `governanceState`, `mt5AccountSnapshots`, `mt5MarketTicks`, `mt5OpenPositions`, `monitoringStatus`, `auditEvents` | Dev-only stub: inserts hardcoded demo rows to seed the UI |
| `syncReadOnlySnapshotFromLocalService` | `mt5AccountSnapshots`, `mt5MarketTicks`, `mt5OpenPositions`, `governanceState`, `monitoringStatus`, `auditEvents` | Primary live sync: receives the snapshot payload from Next.js API and persists account + ticks + positions |
| `syncReadOnlySymbolsFromLocalService` | `mt5Symbols`, `userSymbolSettings`, `governanceState`, `auditEvents` | Syncs Market Watch symbol catalog in chunks (max 200/mutation); upserts by `name` index; creates default disabled `userSymbolSettings` rows for new symbols |
| `syncReadOnlyTradeHistoryFromLocalService` | `mt5TradeHistoryDeals`, `monitoringStatus`, `governanceState`, `auditEvents` | Syncs closed deals in chunks (max 200/mutation); deduplicates by `userId + dealTicket` index |
| `syncReadOnlyCandlesFromLocalService` | `mt5Candles`, `monitoringStatus`, `governanceState`, `auditEvents` | Syncs OHLCV candles in chunks (max 1000/mutation); full dedup + patch logic; broker clock-skew detection (2 min silent, 2 min–12 h flag, >12 h reject); returns freshness summary |
| `updateMySymbolSetting` | `userSymbolSettings`, `governanceState`, `auditEvents` | User preference toggle (enabled, showInLab) for a symbol; enforces governance read-only |
| `clearDemoMt5ReadOnlyData` | `mt5AccountSnapshots`, `mt5MarketTicks`, `mt5OpenPositions`, `auditEvents`, `labSignalSnapshots`, `protectionEvents` | Dev-only purge guarded by `ALLOW_DEV_CLEANUP === "true"` env var |

### Supporting helpers (not exported as mutations)

- `_upsertMonitoringStatus()` — upsert via `by_userId_service` index (prevents unbounded `collect()`).
- `enforceGovernanceReadOnly()` — always resets `tradingEnabled: false, readOnly: true` on every mutation.
- `computeFreshness()` — pure function computing candle staleness and broker clock skew summary.
- `isFinalChunk()` — controls which chunk commits the final audit event.

---

## 3. Convex MT5 Queries

**Files:** `convex/coreQueries.ts`, `convex/mt5Bridge.ts`, `convex/technicalIndicators.ts`

### coreQueries.ts — read queries

| Query | Tables read | Returns |
|---|---|---|
| `getMyLatestAccountSnapshot` | `mt5AccountSnapshots` | Latest snapshot (preferring `source = "mt5-local-readonly"`) |
| `getMyLatestRealMt5AccountSnapshot` | `mt5AccountSnapshots` | Latest snapshot strictly from local source |
| `getLatestMarketTicks` | `mt5MarketTicks` | Deduplicated latest tick per symbol (local source preferred), max 12 |
| `getLatestRealMt5MarketTicks` | `mt5MarketTicks` | Same but local-source-only |
| `getMyLatestSignals` | `labSignalSnapshots` | Last 8 signals |
| `getMyLatestRealSignals` | `labSignalSnapshots` | Last 20 signals with `source = "mt5-local-readonly"` |
| `getMySignalReportSnapshots` | `labSignalSnapshots` | Last 50 signals |
| `getMyOpenPositions` | `mt5OpenPositions` | Latest batch resolved via `syncRunId` or `capturedAt` |
| `getMyMt5ReadOnlySummary` | `mt5AccountSnapshots`, `mt5OpenPositions`, `monitoringStatus`, `governanceState` | Compound summary for dashboard |
| `getMyProtectionEvents` | `protectionEvents` | Last 15 protection events |
| `getMyGovernanceState` | `governanceState` | Single governance row for user |
| `getMyCommitteeReports` | `committeeReports` | Last 20 committee reports |
| `getMyMonitoringStatus` | `monitoringStatus` | All monitoring rows for user |
| `getMyAuditEvents` | `auditEvents` | Last 25 audit events |
| `getMyMt5SymbolsWithSettings` | `mt5Symbols`, `userSymbolSettings` | Symbol catalog merged with user preferences |
| `getMyEnabledLabSymbols` | `userSymbolSettings`, `mt5Symbols` | Symbol names with `enabled=true AND showInLab=true AND visible in MT5` |
| `getMyActiveMt5Positions` | `mt5OpenPositions` | Latest batch from local source only |
| `getMyTradeHistoryDeals` | `mt5TradeHistoryDeals` | Last 300 deals from local source |
| `getMyRealMt5ReportSummary` | `mt5OpenPositions`, `mt5TradeHistoryDeals` | Aggregated P&L, win/loss counts, volume |

### mt5Bridge.ts — stub/freshness queries

| Query | Purpose |
|---|---|
| `getMt5BridgeConnectionStatus` | Always returns `connected: false, mode: "read_only_stub"` |
| `previewReadOnlyAccountSnapshotStub` | Shape example, no DB access |
| `previewReadOnlyMarketTicksStub` | Shape example, no DB access |
| `previewReadOnlyOpenPositionsStub` | Shape example, no DB access |
| `getLatestCandleFreshness` | Returns latest candle time per `(symbol, timeframe)` pair using `by_userId_symbol_timeframe` index |

### technicalIndicators.ts — indicator queries

| Query | Purpose |
|---|---|
| `getMyLatestTechnicalIndicators` | Latest indicator snapshot per `(symbol, timeframe)`, max 400 rows scanned |
| `getIndicatorsForSymbol` | All snapshots for one symbol, last 100 |
| `computeIndicatorsForSymbol` | On-demand indicator computation from `mt5Candles` — no DB write |
| `getIndicatorReadiness` | Reports ready/partial/missing counts for enabled symbols |

---

## 4. Next.js MT5 API Routes

**Directory:** `src/app/api/mt5-readonly/`
All routes use `export const dynamic = "force-dynamic"` and `8000ms` timeout.
The Python service base URL is `process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010"`.

| Route | Method | Proxies to | Auth | Persists to Convex | Notes |
|---|---|---|---|---|---|
| `/api/mt5-readonly/connect` | `POST` | `POST /connect` | None | No | Pass-through; forwards JSON body to Python service |
| `/api/mt5-readonly/connection-status` | `GET` | `GET /connection-status` | None | No | Pass-through proxy |
| `/api/mt5-readonly/snapshot` | `GET` | `GET /readonly/snapshot` | None | No | Returns `{ ok, snapshot }` wrapper |
| `/api/mt5-readonly/symbols` | `GET` | `GET /readonly/symbols` | None | No | Forwards `visibleOnly`, `limit`, `search` params; adds note field |
| `/api/mt5-readonly/history-deals` | `GET` | `GET /readonly/history-deals` | None | No | Forwards `days`, `symbol` params |
| `/api/mt5-readonly/candles` | `GET` | `GET /readonly/candles` | Clerk + Convex JWT | Yes — `syncReadOnlyCandlesFromLocalService` | Most complex route: fetches candles, chunks them (1000/chunk), persists to Convex with dedup; returns freshness/quality metadata. Has `?debugAuth=1` diagnostics. |
| `/api/lab/analyze-preview` | `POST` | `GET /readonly/symbols` (for symbol props) + Convex query | Clerk + Convex JWT | No (read-only preview) | Lab analysis pipeline — see Section 6 |

### Authentication gap

Four of the six `mt5-readonly` routes (`connect`, `connection-status`, `snapshot`, `symbols`, `history-deals`) have **no authentication check**. Any client with network access to the Next.js server can call these. The candles route is the only one that mints a Convex JWT before persisting.

---

## 5. Indicator Pipeline

**File:** `convex/technicalIndicators.ts`

All indicators are computed **entirely in Convex TypeScript** from persisted `mt5Candles` rows. No external library is used.

| Indicator | Algorithm | Minimum candles needed |
|---|---|---|
| `EMA20` | Seeded SMA then EMA multiplier `2/(period+1)` | 20 |
| `EMA50` | Same | 50 |
| `EMA200` | Same | 200 |
| `RSI14` | Wilder smoothing (initial SMA seed) | 15 |
| `ATR14` | Wilder smoothing on True Range | 15 |
| `MACD (12/26/9)` | Fast EMA − Slow EMA, then 9-period EMA of line | 35 |
| `Volatility` | Coefficient of variation over last 20 closes | 20 |
| `recentHigh / recentLow` | Rolling max/min over last 20 candles | 1 |
| `trendBias` | Derived: `EMA20 > EMA50 > EMA200` → bullish; inverse → bearish; else neutral | requires EMA200 |
| `momentumBias` | Derived: RSI ≥ 55 and MACD histogram > 0 → strong; RSI ≤ 45 and MACD histogram < 0 → strong; else weak | requires RSI + MACD |

**Batch computation** (`computeTechnicalIndicatorsForEnabledSymbols`): runs for all symbols with `enabled=true AND showInLab=true AND visible in Market Watch`, across default timeframes `[M15, H1, H4, D1]`, and persists snapshots to `technicalIndicatorSnapshots`.

**On-demand computation** (`computeIndicatorsForSymbol`): same logic as a `query` (no write), used by the lab analysis preview pipeline.

**Candle fetch limit:** 350 candles per (symbol, timeframe) for batch; configurable 50–350 for on-demand.

---

## 6. Lab Analysis Pipeline

**File:** `src/app/api/lab/analyze-preview/route.ts`
**Component:** `src/components/lab/AnalysisControlPanel.tsx`
**Page:** `src/app/(dashboard)/lab/page.tsx`

### Pipeline stages (POST `/api/lab/analyze-preview`)

```
Stage 1 — Parse & validate request body
  - symbol (required, uppercase)
  - timeframeMode: "manual" | "auto"
  - manualTimeframe (required if manual)
  - candidateTimeframes (default ["M15","H1","H4"] for auto)
  - candleCount (50–350, default 200)
  - stopPoints (required > 0)
  - riskUsd (required > 0)
  - rrRatio or targetPoints
  - riskPercent (optional, for display only)

Stage 2 — Auth: Clerk session → Convex JWT
  - auth() from @clerk/nextjs/server
  - getToken({ template: "convex" })
  - Fails 401 if not authenticated

Stage 3 — Fetch symbol properties (best-effort, parallel)
  - GET /readonly/symbols?visibleOnly=false&search={symbol}
  - Returns: point, digits, spread, trade_tick_value, trade_tick_size,
             volume_min/max/step, stops_level, contract_size
  - Failure is non-blocking (warnings emitted)

Stage 4 — Fetch indicators per candidate timeframe (parallel)
  - Convex query: computeIndicatorsForSymbol for each timeframe
  - No DB write; uses on-demand computation from mt5Candles

Stage 5 — Timeframe selection
  - Manual: picks the requested timeframe if data is ok
  - Auto: scores each candidate via scoreTimeframe() function
    * Requires non-neutral trendBias (+40 pts)
    * Strong momentum +30, weak +5
    * RSI in 25–75 range +15, outside -20
    * candleCount >= 200 +10, >= 100 +5
    * Spread > 50 points -15
    * Returns null if stale or insufficient candles

Stage 6 — Direction determination
  - trendBias: "bullish" → entry direction BUY; "bearish" → SELL

Stage 7 — Entry / SL / TP calculation
  - entry = lastClose from latest candle
  - Bullish: SL = entry − stopPoints*point; TP = entry + targetPoints*point
  - Bearish: SL = entry + stopPoints*point; TP = entry − targetPoints*point
  - targetPoints = rrRatio * stopPoints (if rrRatio given) or targetPointsInput

Stage 8 — Lot calculation
  - pointValuePerLot = tick_value * (point / tick_size)
  - riskPerLot = stopPoints * pointValuePerLot
  - rawLot = riskUsd / riskPerLot
  - Normalized to [volume_min, volume_max] stepped by volume_step

Stage 9 — Build response (readOnly: true always)
  - status: "opportunity" | "wait" | "rejected" | "insufficient_data" | "stale_data"
  - No DB write, no MT5 mutation
```

### AnalysisControlPanel.tsx

- Populates symbol dropdown **exclusively** from `getMyEnabledLabSymbols` (Convex) — free-text entry removed.
- No execution button. Shows "قراءة فقط — لا يتم تنفيذ أي صفقة" in two visible places.
- Calls `POST /api/lab/analyze-preview` on submit.

### Lab page governance display

`executionBlocked` is computed as:
```ts
!canUseConvex || governance === null || governance.readOnly || !governance.tradingEnabled
```
The "تنفيذ تجريبي" button is permanently `disabled={executionBlocked}`. Since governance always has `tradingEnabled: false`, the button is always disabled.

---

## 7. Execution Guard Chain

The system implements a **defense-in-depth, multi-layer read-only guard**. All layers are active simultaneously.

### Layer 1 — Python service (hardware level)

- `READ_ONLY_MODE = True` hardcoded constant.
- `_enforce_read_only_policy()` called at entry of every handler.
- `FORBIDDEN_MT5_FUNCTION_NAMES` tuple documents names that must never appear.
- No `/trade`, `/order`, `/execute`, or similar endpoint exists.
- FastAPI app description: "No trading endpoints."

### Layer 2 — Convex bridge (data level)

- `enforceGovernanceReadOnly()` is called in **every** mutation before return:
  - Sets `tradingEnabled: false`
  - Sets `readOnly: true`
  - Sets `maxDailyTrades: 0`
  - Sets `maxRiskUsd: 0`
- This means even if a mutation were to somehow receive data suggesting trading is allowed (e.g., `account.trade_allowed` from MT5), the governance row is forcibly reset to read-only on every sync.
- Comment in `syncReadOnlySnapshotFromLocalService`: "Never inspects account.trade_allowed for enabling trades — governance stays locked read-only."

### Layer 3 — Next.js API routes (transport level)

- All routes are under `/api/mt5-readonly/` — the path itself encodes the contract.
- The lab analysis route (`/api/lab/analyze-preview`) always returns `readOnly: true` and never calls any mutation.
- `src/lib/mt5-bridge/index.ts` exports `MT5_BRIDGE_READ_ONLY = true as const` and `assertMt5BridgeReadOnlyMode()`.
- `src/lib/api/client.ts` has `ALLOWED_GET_PATHS` allowlist — only `/api/health` and `/api/monitoring/status` are permitted; any other path throws `ReadOnlyPathError`.

### Layer 4 — UI (presentation level)

- `executionBlocked` flag in `lab/page.tsx` disables execution button when `governance.readOnly` or `!governance.tradingEnabled`.
- `AnalysisControlPanel` has no execution button at all — the entire panel is labelled "تحليل استرشادي فقط".
- The `LabPage` shows "التنفيذ معطل — النظام في وضع القراءة فقط" when auth is present.

### Layer 5 — Schema enforcements

- `governanceState` table: `tradingEnabled: v.boolean()` and `readOnly: v.boolean()` are always written as `false` and `true` respectively by every mutation.
- `technicalIndicators.computeTechnicalIndicatorsForEnabledSymbols` mutation explicitly returns `{ tradingEnabled: false, governanceReadOnly: true }` in its result payload.

---

## 8. Symbol & Candle Data Flow

### Symbol flow

```
MT5 terminal
  └─ mt5.symbols_get()
       └─ Python /readonly/symbols (visibleOnly filter + search + limit)
            └─ Next.js GET /api/mt5-readonly/symbols (proxy, no auth, no persist)
                 |
                 └─ Settings page (src/app/(dashboard)/settings/page.tsx)
                      └─ syncReadOnlySymbolsFromLocalService mutation (chunked, 100/call)
                           └─ mt5Symbols table (upsert by name index)
                                └─ userSymbolSettings table (insert default disabled row)
                                     |
                                     └─ getMyMt5SymbolsWithSettings query
                                          └─ Settings UI (toggle enabled/showInLab)
                                               └─ updateMySymbolSetting mutation
                                                    └─ getMyEnabledLabSymbols query
                                                         └─ AnalysisControlPanel symbol dropdown
```

### Candle data flow

```
MT5 terminal
  └─ mt5.copy_rates_from_pos()
       └─ Python /readonly/candles (symbols CSV, timeframes CSV, count)
            └─ Next.js GET /api/mt5-readonly/candles (8s timeout, force-dynamic)
                 ├─ Returns raw candle JSON to caller (always, even if Convex fails)
                 └─ [if connected=true AND candles.length > 0]
                      └─ Clerk auth() → getToken({ template: "convex" })
                           └─ ConvexHttpClient.mutation(syncReadOnlyCandlesFromLocalService)
                                [chunked: 1000 candles/chunk]
                                └─ mt5Candles table (insert new / skip identical / patch revision)
                                     └─ computeIndicatorsForSymbol query (on-demand, no write)
                                          OR
                                          computeTechnicalIndicatorsForEnabledSymbols mutation
                                               └─ technicalIndicatorSnapshots table
                                                    └─ Lab page indicators table
                                                    └─ analyze-preview pipeline (Stage 4)
```

### Key data model notes

- `mt5Candles` uses `time` as epoch-**milliseconds** (Python multiplies `rate["time"] * 1000`).
- Dedup key: `(userId, symbol, timeframe, time)` via `by_userId_symbol_timeframe_time` index.
- Closed candles are skipped if OHLC is identical; open (last) candle is patched if OHLC changed.
- `mt5MarketTicks` is **not** user-scoped — no `userId` field. Any authenticated user's sync writes ticks globally; `getLatestMarketTicks` reads from all sources.
- `mt5AccountSnapshots` and `mt5OpenPositions` **are** user-scoped via `userId`.

---

## 9. Risk Areas

### R1 — Unauthenticated MT5 proxy routes (MEDIUM)

**Routes:** `/api/mt5-readonly/connect`, `/api/mt5-readonly/connection-status`, `/api/mt5-readonly/snapshot`, `/api/mt5-readonly/symbols`, `/api/mt5-readonly/history-deals`

None of these routes check Clerk authentication. Any client with access to the Next.js server (same origin or with CORS open) can fetch MT5 account data, connection credentials flow, and position information. The `connect` route in particular accepts `{ login, password, server, terminal_path }` and forwards it to the Python service — there is no auth layer protecting who may call this.

**Recommendation:** Add `auth()` guard from `@clerk/nextjs/server` to at minimum the `connect` and `snapshot` routes.

### R2 — Password forwarded in plaintext (MEDIUM)

The `POST /api/mt5-readonly/connect` route receives `{ login, server, password, terminal_path }` from the browser and forwards it as-is to the Python service. The password is never stored, but it travels through two hops (browser → Next.js → Python on localhost). Over HTTPS to Next.js this is acceptable, but the lack of auth on the Next.js side (R1) means any caller can probe this endpoint.

### R3 — mt5MarketTicks is not user-scoped (LOW-MEDIUM)

The `mt5MarketTicks` schema has no `userId` field. Multiple users' tick syncs accumulate into the same table. `getLatestMarketTicks` reads the last 500 rows across all users and merges by symbol. This is a cross-user data leak at the tick level. For a single-user deployment this is acceptable, but in a multi-tenant production system it is a bug.

### R4 — `clearDemoMt5ReadOnlyData` uses full table scan (LOW)

The dev-cleanup mutation does `ctx.db.query(table).collect()` on six tables including `auditEvents` and `protectionEvents`, which can grow unboundedly. The env guard (`ALLOW_DEV_CLEANUP !== "true"`) prevents production use, but the pattern should be replaced with index-based deletion if the tables grow large in dev.

### R5 — Hardcoded Clerk domain in candle route (LOW)

`src/app/api/mt5-readonly/candles/route.ts` at line 139 hardcodes `"https://national-ant-59.clerk.accounts.dev"` as the expected issuer domain in debug diagnostics. This will silently produce misleading guidance if the Clerk app is ever changed or moved to production.

### R6 — No rate limiting on candle sync (LOW)

The `/api/mt5-readonly/candles` route can be called in a tight loop from the browser, triggering repeated Python service calls and Convex mutations. There is no debounce, cooldown, or rate limiter. On a large symbol set, this can exhaust Convex write budget.

### R7 — scoreTimeframe spread penalty is a no-op (LOW / BUG)

In `src/app/api/lab/analyze-preview/route.ts`, the spread penalty block (line ~229):
```ts
const spreadAsPrice = spreadPoints * (ind.ema20 ?? 0) * 0; // placeholder — we only have point spread
void spreadAsPrice;
if (spreadPoints > 50) score -= 15;
```
The `spreadAsPrice` calculation always produces `0` (multiplied by `0`), and `void` discards it. The `-15` penalty for wide spread does still apply when `spreadPoints > 50`, but the comment and dead code suggest this block was not finished and may produce incorrect scoring.

### R8 — `getMyMt5SymbolsWithSettings` has unbounded `.take(25_000)` (LOW)

`getMyMt5SymbolsWithSettings` and `getMyEnabledLabSymbols` each issue two `take(25_000)` queries against `mt5Symbols`. While Convex imposes its own limits, querying 50,000 potential rows in a single query handler is a future scalability concern if the symbol catalog grows.

### R9 — No input validation on `userSymbolSettings.symbol` (LOW)

`updateMySymbolSetting` accepts any `v.string()` as `symbol` — there is no check that the symbol actually exists in `mt5Symbols`. A caller could create `userSymbolSettings` rows for arbitrary symbol strings not present in the catalog.

---

## 10. Proposed MT5 Domain Isolation Plan

The current code is functional but scattered. MT5 concerns live in:
- `mt5_readonly_service/` (Python)
- `convex/mt5Bridge.ts` (mutations)
- `convex/technicalIndicators.ts` (indicators — partly MT5-derived)
- `convex/coreQueries.ts` (all queries — mixed MT5 and non-MT5)
- `src/app/api/mt5-readonly/` (proxy routes)
- `src/app/api/lab/analyze-preview/` (analysis — uses MT5 data)
- `src/lib/mt5-bridge/` (safety constant only)
- `src/lib/api/` (generic client + health/monitoring)

### Proposed: `src/domains/mt5/`

```
src/domains/mt5/
  constants.ts            — MT5_SERVICE_BASE default, timeframe lists, stale thresholds
  types.ts                — Shared TS types: SymbolProps, CandleRow, TickRow, AccountSnapshot, etc.
  service-client.ts       — fetchMt5Service(path, options) — typed wrapper around the Python service
  symbol-client.ts        — fetchSymbolProps(symbol) — extracted from analyze-preview route
  candle-client.ts        — fetchCandles(symbols, timeframes, count) — extracted from candles route
  snapshot-client.ts      — fetchSnapshot() — extracted from snapshot route
  convex-persist.ts       — persistCandlesToConvex(), persistSnapshotToConvex() helpers
  guard.ts                — MT5_BRIDGE_READ_ONLY, assertMt5BridgeReadOnlyMode() (moved from src/lib/mt5-bridge/)
```

### What stays in `convex/`

Convex files must stay in `convex/` because they run on the Convex backend runtime:

| File | Keep / Rename |
|---|---|
| `convex/schema.ts` | Keep as-is; MT5 tables stay here |
| `convex/mt5Bridge.ts` | Keep; consider splitting into `convex/mt5Mutations.ts` and `convex/mt5SymbolMutations.ts` |
| `convex/technicalIndicators.ts` | Keep; it is a Convex mutation/query file |
| `convex/coreQueries.ts` | Consider splitting: `convex/mt5Queries.ts` (all mt5* table queries) vs `convex/labQueries.ts` (signal/report queries) |

### Proposed API route grouping

All routes should live under a single `/api/mt5/` prefix for clarity:

```
Current                                   Proposed
-------                                   --------
/api/mt5-readonly/connect             →   /api/mt5/connect
/api/mt5-readonly/connection-status   →   /api/mt5/connection-status
/api/mt5-readonly/snapshot            →   /api/mt5/snapshot
/api/mt5-readonly/symbols             →   /api/mt5/symbols
/api/mt5-readonly/history-deals       →   /api/mt5/history-deals
/api/mt5-readonly/candles             →   /api/mt5/candles
/api/lab/analyze-preview              →   /api/mt5/lab/analyze-preview
                                      +   /api/mt5/sync/snapshot   (dedicated sync endpoint)
                                      +   /api/mt5/sync/symbols    (dedicated sync endpoint)
                                      +   /api/mt5/sync/history    (dedicated sync endpoint)
```

The word `readonly` in the path is redundant — it is enforced by the Python service contract and Convex governance, not by the URL. The proposed `/api/mt5/` prefix is cleaner and leaves room for future sub-domains without URL proliferation.

### Migration priority

1. **High — security:** Add auth guards to unauthenticated routes (R1).
2. **High — correctness:** Scope `mt5MarketTicks` by `userId` (R3).
3. **Medium — maintainability:** Extract shared types into `src/domains/mt5/types.ts`.
4. **Medium — maintainability:** Split `convex/coreQueries.ts` into MT5-specific and lab-specific query files.
5. **Low — cleanliness:** Move `src/lib/mt5-bridge/index.ts` guard into `src/domains/mt5/guard.ts`.
6. **Low — correctness:** Fix dead `spreadAsPrice` code in `scoreTimeframe()` (R7).

---

## 11. Verdict

### Read-only safety: PASS

The read-only contract is rigorously implemented across all three layers:

- The Python service has a hardcoded `READ_ONLY_MODE = True` constant with a `_enforce_read_only_policy()` guard on every handler. `order_send`, `order_close`, `order_modify`, and `order_check` are explicitly documented as forbidden and never imported.
- Every Convex mutation calls `enforceGovernanceReadOnly()` which forcibly writes `tradingEnabled: false, readOnly: true` regardless of incoming data. The governance state cannot be flipped to `tradingEnabled: true` by any existing code path.
- The UI lab page has a permanently disabled execution button. The analysis panel has no execution button at all.
- `src/lib/mt5-bridge/index.ts` provides a runtime assertion guard.

No path to `order_send` or any execution function exists in the current codebase.

### Architecture: FUNCTIONAL but needs consolidation

The system works end-to-end:
- Python service reliably provides OHLCV, ticks, positions, symbols, and history.
- Convex persistence is robust — chunked uploads, deduplication, broker clock-skew handling, freshness tracking.
- The lab analysis pipeline correctly computes indicators entirely in Convex TypeScript and produces a structured preview.
- Governance state is consistently maintained.

Key gaps to address before scaling:
1. **Authentication** on proxy routes (R1/R2) — currently unauthenticated.
2. **User-scoping** of `mt5MarketTicks` (R3) — currently a cross-user table.
3. **Domain isolation** — MT5 logic is scattered; consolidating into `src/domains/mt5/` will make future OKX domain addition cleaner and safer.

### OKX readiness

No OKX files exist. The codebase is clean for a parallel domain. When OKX is introduced:
- It must **not** touch `mt5_readonly_service/`, `convex/mt5Bridge.ts`, or any `mt5*` table.
- It should live under `src/domains/okx/` and `convex/okxBridge.ts` (separate file).
- The `governanceState` table's `tradingEnabled` flag should remain controlled per-domain, not globally, if both domains are live simultaneously.

---

_End of MT5 Domain Review. Total files audited: 18. No source files were modified._
