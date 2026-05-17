# OKX READ-ONLY FOUNDATION PLAN

**Project:** MT5-NEXT.js — OKX Integration Phase 0 (Read-Only Foundation)
**Date:** 2026-05-02
**Status:** PLAN ONLY — No implementation has been performed.
**Author:** OKX Domain Teammate (AI planning agent)

---

## 1. Existing OKX Files Found

**Result: NONE.**

A full content search across the project for `okx`, `OKX`, `bybit`, and `binance` (case-insensitive) returned zero matches in any source file. The only hit was `pnpm-lock.yaml`, which contained no actionable exchange references — only transitive dependency metadata unrelated to OKX.

**Conclusion:** The OKX domain is a greenfield addition. No cleanup, renaming, or conflict resolution with existing OKX code is required.

---

## 2. Existing Project Context (Relevant Schema, Nav, Packages)

### 2.1 Convex Schema — Existing Tables (READ-ONLY REFERENCE — DO NOT MODIFY)

The following tables already exist in `convex/schema.ts`. OKX tables must never conflict with or reference these:

| Table Name | Purpose |
|---|---|
| `testEvents` | Dev/test events |
| `users` | Clerk-authenticated user records |
| `mt5AccountSnapshots` | MT5 broker account state |
| `mt5MarketTicks` | MT5 live tick data |
| `mt5OpenPositions` | MT5 open trade positions |
| `mt5Symbols` | MT5 symbol/instrument list |
| `mt5TradeHistoryDeals` | MT5 closed deal history |
| `mt5Candles` | MT5 OHLCV candle data |
| `labSignalSnapshots` | Lab analysis signals |
| `committeeReports` | Multi-mind committee verdicts |
| `technicalIndicatorSnapshots` | Computed TA indicators (EMA, RSI, ATR, MACD) |
| `protectionEvents` | Risk/protection audit events |
| `governanceState` | Trading mode + kill-switch state |
| `auditEvents` | System-wide audit log |
| `monitoringStatus` | Service health check records |
| `userSymbolSettings` | Per-user symbol preferences |

**Critical observation:** MT5 indicator snapshots (`technicalIndicatorSnapshots`) store EMA20/50/200, RSI14, ATR14, MACD. OKX must implement its own equivalent fields in a separate table. No shared indicator functions.

### 2.2 Dashboard Page Structure

Existing pages under `src/app/(dashboard)/`:

```
/dashboard       — main dashboard
/lab             — signal lab
/monitoring      — MT5 service health
/replay          — historical replay
/reports         — trade reports
/settings        — user settings
/convex-core     — dev-only Convex inspector
/convex-test     — dev-only Convex test harness
```

The new `/okx-lab` page will live at the same level as these pages.

### 2.3 Navigation Structure

Navigation is driven by `src/lib/constants/navigation.ts` via `NAV_GROUPS` (grouped, collapsible). Current groups:

- `home` — Dashboard
- `mt5` — MT5 Platform (Monitoring, Replay)
- `analysis` — Analysis & Lab
- `reports` — Reports & Monitoring
- `system` — Settings & System (dev tools)

A new `okx` group must be added when implementation begins. This plan documents the intended entry; **no file is modified now**.

### 2.4 Existing API Routes

Under `src/app/api/`:

```
/api/mt5-readonly/
  candles/
  connect/
  connection-status/
  history-deals/
  snapshot/
  symbols/
/api/lab/
  analyze-preview/
```

All new OKX routes will live under `/api/okx/` — never under `/api/mt5-readonly/` or `/api/lab/`.

### 2.5 Installed Packages (Relevant)

From `package.json`:

| Package | Relevance |
|---|---|
| `next` 16.2.4 | Route handlers use `src/app/api/.../route.ts` pattern |
| `convex` ^1.36.1 | Database layer — OKX tables added to existing schema |
| `recharts` ^3.8.1 | Already available for OKX price charts (no new install needed) |
| `@clerk/nextjs` ^7.2.7 | Auth — OKX pages protected by same Clerk middleware |
| `lucide-react` ^1.11.0 | Icons — use for OKX nav entry |

**No crypto/exchange SDK is currently installed.** OKX public API is REST-based and requires no SDK — plain `fetch()` is sufficient for read-only public endpoints.

---

## 3. Proposed File Structure

All new files are listed here. **Nothing is created during planning.**

```
convex/
  schema.ts                          ← ADD okx* tables (append only, no MT5 changes)
  okxMarketData.ts                   ← NEW: Convex queries for OKX market data
  okxInstruments.ts                  ← NEW: Convex queries for OKX instruments
  okxRegime.ts                       ← NEW: Convex queries for OKX BTC regime data

src/
  lib/
    okx/
      client.ts                      ← NEW: OKX public REST client (fetch wrapper)
      types.ts                       ← NEW: TypeScript types for OKX API responses
      regime.ts                      ← NEW: BTC regime calculation (price vs 200-day MA)
    constants/
      navigation.ts                  ← MODIFY: add okx nav group (implementation phase)

  app/
    (dashboard)/
      okx-lab/
        page.tsx                     ← NEW: /okx-lab placeholder page
        loading.tsx                  ← NEW: loading skeleton

    api/
      okx/
        ticker/
          route.ts                   ← NEW: GET /api/okx/ticker?symbol=BTC-USDT
        instruments/
          route.ts                   ← NEW: GET /api/okx/instruments?instType=SPOT
        regime/
          route.ts                   ← NEW: GET /api/okx/regime (BTC/USDT 200-day MA)

  components/
    okx/
      OkxReadOnlyBanner.tsx          ← NEW: persistent "READ-ONLY · No Execution" banner
      OkxBtcPriceCard.tsx            ← NEW: BTC/USDT spot price display card
      OkxRegimeCard.tsx              ← NEW: bull/bear/neutral regime display
      OkxInstrumentTable.tsx         ← NEW: paginated SPOT instruments list

.env.local                           ← DOCUMENT ONLY: add OKX_API_KEY, OKX_API_SECRET,
                                        OKX_PASSPHRASE (for future auth — not used in Phase 0)
```

---

## 4. OKX API Client Design (Read-Only)

### 4.1 Principles

- **Public endpoints only in Phase 0.** No authentication required.
- **No secrets in source code.** If private endpoints are added in a future phase, credentials come exclusively from environment variables (`process.env.OKX_API_KEY`, etc.).
- **Server-side only.** The client runs only in Next.js API route handlers (`route.ts`) or Convex actions — never in client components.
- **No SDK dependency.** Use native `fetch()` with typed wrappers.

### 4.2 Base Configuration

```
Base URL: https://www.okx.com
Public endpoints require no Authorization header.
Rate limits: OKX public endpoints — 20 requests/2 seconds per IP.
```

### 4.3 Public Endpoints to Use

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v5/market/ticker?instId=BTC-USDT` | GET | Current BTC/USDT spot price, 24h change |
| `/api/v5/market/books?instId=BTC-USDT&sz=5` | GET | Orderbook top 5 levels (display only) |
| `/api/v5/public/instruments?instType=SPOT` | GET | Full SPOT instruments list |
| `/api/v5/market/candles?instId=BTC-USDT&bar=1D&limit=200` | GET | Daily candles for 200-day MA regime |

### 4.4 Client Module Design (`src/lib/okx/client.ts`)

```typescript
// Conceptual design — not implemented yet

const OKX_BASE = "https://www.okx.com";

async function okxGet<T>(path: string, params?: Record<string, string>): Promise<T>
// - Builds URL with query params
// - Sets Accept: application/json header
// - Throws OkxApiError on non-2xx or error code in response body
// - Returns typed response data field

export const okxClient = {
  getTicker(instId: string): Promise<OkxTickerData>
  getInstruments(instType: "SPOT" | "FUTURES"): Promise<OkxInstrument[]>
  getCandles(instId: string, bar: string, limit: number): Promise<OkxCandleRow[]>
  getOrderbook(instId: string, depth: number): Promise<OkxOrderbook>
}
```

### 4.5 Error Handling Strategy

- OKX wraps errors as `{ code: "0", data: [...] }` — code `"0"` = success.
- Non-zero codes must be thrown as typed errors, not silently swallowed.
- API route handlers return `{ error: string, code: string }` on failure — never expose raw OKX error details to the browser in production.

---

## 5. Convex Schema Additions Needed

These tables are **appended** to `convex/schema.ts`. No existing table is touched.

### 5.1 `okxTickerSnapshots` — BTC/USDT spot price snapshots

```typescript
okxTickerSnapshots: defineTable({
  instId: v.string(),           // e.g. "BTC-USDT"
  instType: v.string(),         // "SPOT"
  last: v.number(),             // last traded price
  open24h: v.number(),          // 24h open price
  high24h: v.number(),          // 24h high
  low24h: v.number(),           // 24h low
  vol24h: v.number(),           // 24h volume (base currency)
  volCcy24h: v.number(),        // 24h volume (quote currency)
  change24hPct: v.number(),     // computed: (last - open24h) / open24h * 100
  capturedAt: v.number(),       // Unix ms timestamp
  source: v.string(),           // "okx-public-api"
})
  .index("by_instId", ["instId"])
  .index("by_capturedAt", ["capturedAt"])
  .index("by_instId_capturedAt", ["instId", "capturedAt"]),
```

### 5.2 `okxInstruments` — SPOT instruments catalogue

```typescript
okxInstruments: defineTable({
  instId: v.string(),           // e.g. "BTC-USDT"
  instType: v.string(),         // "SPOT"
  baseCcy: v.string(),          // base currency e.g. "BTC"
  quoteCcy: v.string(),         // quote currency e.g. "USDT"
  tickSz: v.string(),           // tick size (string to preserve precision)
  lotSz: v.string(),            // lot size
  minSz: v.string(),            // minimum order size
  state: v.string(),            // "live" | "suspend" | "preopen"
  listTime: v.optional(v.number()),
  capturedAt: v.number(),
  source: v.string(),           // "okx-public-api"
})
  .index("by_instId", ["instId"])
  .index("by_baseCcy", ["baseCcy"])
  .index("by_state", ["state"])
  .index("by_capturedAt", ["capturedAt"]),
```

### 5.3 `okxBtcRegimeSnapshots` — BTC market regime

```typescript
okxBtcRegimeSnapshots: defineTable({
  instId: v.string(),           // "BTC-USDT"
  currentPrice: v.number(),     // latest close price
  ma200: v.optional(v.number()),// 200-day simple moving average (null if <200 candles)
  candleCount: v.number(),      // how many daily candles were used
  regime: v.string(),           // "bull" | "bear" | "neutral" | "insufficient_data"
  distancePct: v.optional(v.number()), // (price - ma200) / ma200 * 100
  rationale: v.string(),        // human-readable explanation
  capturedAt: v.number(),
  source: v.string(),           // "okx-public-api"
})
  .index("by_instId", ["instId"])
  .index("by_capturedAt", ["capturedAt"])
  .index("by_regime", ["regime"])
  .index("by_instId_capturedAt", ["instId", "capturedAt"]),
```

### 5.4 `okxDailyCandles` — Raw daily candle storage for regime computation

```typescript
okxDailyCandles: defineTable({
  instId: v.string(),           // "BTC-USDT"
  bar: v.string(),              // "1D"
  time: v.number(),             // candle open timestamp (Unix ms)
  open: v.number(),
  high: v.number(),
  low: v.number(),
  close: v.number(),
  vol: v.number(),              // base currency volume
  volCcy: v.optional(v.number()), // quote currency volume
  capturedAt: v.number(),
  source: v.string(),
})
  .index("by_instId_bar", ["instId", "bar"])
  .index("by_instId_bar_time", ["instId", "bar", "time"])
  .index("by_capturedAt", ["capturedAt"]),
```

### 5.5 Schema Isolation Rules

- All OKX table names are prefixed `okx`. This is enforced by convention and must be enforced in code review.
- No `okx*` table may hold a reference (`v.id(...)`) to any `mt5*` or `lab*` table.
- No `mt5*` or `lab*` Convex function may import from `convex/okx*.ts` files.

---

## 6. Next.js API Routes Plan

All routes live under `src/app/api/okx/`. All routes are **GET only**. No POST, PUT, PATCH, DELETE.

### 6.1 `GET /api/okx/ticker`

**File:** `src/app/api/okx/ticker/route.ts`

**Query params:** `symbol` (default: `BTC-USDT`)

**Behavior:**
1. Validate `symbol` against an allowlist (`BTC-USDT`, `ETH-USDT`, etc.) to prevent SSRF.
2. Call `okxClient.getTicker(symbol)` server-side.
3. Optionally write result to Convex `okxTickerSnapshots` via a Convex HTTP action.
4. Return sanitized price data as JSON.

**Response shape:**
```json
{
  "instId": "BTC-USDT",
  "last": 94500.12,
  "open24h": 92000.00,
  "high24h": 95100.00,
  "low24h": 91500.00,
  "change24hPct": 2.72,
  "capturedAt": 1746172800000
}
```

### 6.2 `GET /api/okx/instruments`

**File:** `src/app/api/okx/instruments/route.ts`

**Query params:** `instType` (default: `SPOT`), `page` (default: `1`), `limit` (default: `50`, max: `200`)

**Behavior:**
1. Accept only `instType=SPOT` in Phase 0 (block FUTURES/SWAP/OPTIONS).
2. Fetch from OKX public instruments endpoint.
3. Paginate result client-side (full list from OKX, slice on server).
4. Return paginated array.

**Response shape:**
```json
{
  "instType": "SPOT",
  "total": 412,
  "page": 1,
  "limit": 50,
  "instruments": [
    { "instId": "BTC-USDT", "baseCcy": "BTC", "quoteCcy": "USDT", "state": "live" },
    ...
  ]
}
```

### 6.3 `GET /api/okx/regime`

**File:** `src/app/api/okx/regime/route.ts`

**Query params:** `symbol` (default: `BTC-USDT`), `maPeriod` (default: `200`, max: `200`)

**Behavior:**
1. Fetch last 200 daily candles from OKX (`/api/v5/market/candles?bar=1D&limit=200`).
2. Compute simple moving average of close prices over available candles.
3. Determine regime:
   - `"bull"` — current price > MA200 by more than 2%
   - `"bear"` — current price < MA200 by more than 2%
   - `"neutral"` — price within ±2% of MA200
   - `"insufficient_data"` — fewer than 200 candles available
4. Return regime with rationale string. **No execution signal is returned.**

**Response shape:**
```json
{
  "instId": "BTC-USDT",
  "currentPrice": 94500.12,
  "ma200": 68234.55,
  "candlesUsed": 200,
  "regime": "bull",
  "distancePct": 38.49,
  "rationale": "Price is 38.5% above 200-day MA. Market regime: BULL.",
  "capturedAt": 1746172800000,
  "warning": "READ-ONLY. This is an informational indicator only. No trades are executed."
}
```

### 6.4 Route Handler Shared Rules

- All handlers run as Next.js Route Handlers (App Router), not Pages Router API routes.
- All handlers add response header `X-OKX-ReadOnly: true`.
- All handlers enforce `GET` only — `405 Method Not Allowed` for all others.
- No handler accepts a request body.
- No handler reads `OKX_API_KEY` — Phase 0 uses only public endpoints.
- Rate limiting note: Implement a simple in-memory or edge-cache layer if the OKX 20req/2s limit is a concern during development. Full rate-limit middleware is out of scope for Phase 0.

---

## 7. UI Pages Plan

### 7.1 `/okx-lab` — OKX Lab Page

**File:** `src/app/(dashboard)/okx-lab/page.tsx`

**Layout:** Uses the existing `(dashboard)/layout.tsx` — no new layout needed.

**Page sections (top to bottom):**

1. **OKX Read-Only Banner** (`OkxReadOnlyBanner`)
   - Persistent amber/orange warning bar
   - Text: "OKX Lab — Read-Only Mode. Market data only. No orders are placed. No execution."
   - Cannot be dismissed

2. **BTC/USDT Spot Price Card** (`OkxBtcPriceCard`)
   - Fetches from `/api/okx/ticker?symbol=BTC-USDT`
   - Shows: last price, 24h change %, 24h high/low
   - Auto-refreshes every 30 seconds (client-side interval)
   - Loading skeleton while fetching

3. **BTC Market Regime Card** (`OkxRegimeCard`)
   - Fetches from `/api/okx/regime?symbol=BTC-USDT`
   - Shows: regime badge (BULL / BEAR / NEUTRAL / INSUFFICIENT DATA), MA200 value, distance %
   - Includes rationale text
   - Refreshes every 5 minutes (regime does not change rapidly)
   - Explicit disclaimer: "This is a read-only informational indicator. No trading decisions are automated."

4. **OKX Instruments Table** (`OkxInstrumentTable`)
   - Fetches from `/api/okx/instruments?instType=SPOT`
   - Paginated table: instId, base, quote, state columns
   - Client-side search/filter by base currency
   - Clearly labelled "SPOT instruments only"

5. **Phase Placeholder Section**
   - Grayed-out card: "Coming in Phase 2: Orderbook depth view (read-only)"
   - Grayed-out card: "Blocked: Order placement — OUT OF SCOPE"

### 7.2 Loading State

**File:** `src/app/(dashboard)/okx-lab/loading.tsx`

- Renders skeleton placeholders for each card section
- Uses Tailwind `animate-pulse` (already in project via `tw-animate-css`)

### 7.3 Navigation Entry (to be added during implementation)

New nav group to add to `src/lib/constants/navigation.ts`:

```typescript
{
  id: "okx",
  title: "OKX Lab",           // or Arabic: "مختبر OKX"
  icon: Globe,                 // or a dedicated icon
  items: [
    { label: "OKX Lab", href: "/okx-lab", icon: FlaskConical },
  ],
}
```

This group must appear **after** the `mt5` group and **before** the `system` group.

---

## 8. Strict MT5/OKX Separation Rules

These rules are mandatory and must be enforced in code review for every PR that touches OKX code.

| Rule | Enforcement |
|---|---|
| OKX Convex table names are prefixed `okx*` | Naming convention — enforced in review |
| MT5 Convex table names are prefixed `mt5*` | Already established — do not rename |
| No `okx*` Convex query/mutation may reference `mt5*` tables | Code review + TypeScript type check |
| No `mt5*` Convex function may import from `convex/okx*.ts` | Import boundary — code review |
| OKX API client lives in `src/lib/okx/` — MT5 helpers in `src/lib/mt5/` (or root lib) | Directory separation |
| OKX regime computation (`src/lib/okx/regime.ts`) must not import from any MT5 indicator file | Import boundary |
| OKX Next.js routes live under `/api/okx/` — MT5 routes under `/api/mt5-readonly/` | Directory separation |
| OKX UI components live in `src/components/okx/` | Directory separation |
| The `/okx-lab` page must not render any MT5 data components | Page-level isolation |
| The `/lab`, `/monitoring`, `/replay` pages must not render any OKX components | Page-level isolation |
| `governanceState` and `protectionEvents` tables are MT5-scoped — OKX does not read or write them | Strictly enforced |
| `labSignalSnapshots` and `committeeReports` are MT5-scoped — OKX does not write signals there | Strictly enforced |

---

## 9. What Is Explicitly OUT OF SCOPE

The following are **permanently blocked** for Phase 0 and require explicit re-evaluation with a new plan document before any implementation:

| Feature | Reason Blocked |
|---|---|
| Order placement (buy/sell) | Execution is out of scope |
| Futures / perpetual contracts | Leverage instruments — blocked |
| Margin trading | Leverage — blocked |
| OKX API key usage in Phase 0 | Not needed; public data only |
| Martingale or position sizing logic | Blocked permanently |
| Auto-execution of any regime signal | Regime is informational only |
| Copying MT5 signal logic to OKX | MT5 indicators must not be reused |
| Shared risk functions between MT5 and OKX | OKX risk: not in scope for any phase currently |
| Writing to `governanceState` from OKX code | MT5-only governance table |
| Writing to `labSignalSnapshots` from OKX code | MT5/Lab-only table |
| WebSocket streaming (OKX WS API) | Phase 0 is polling only |
| OKX portfolio / account endpoints | Requires auth — not in Phase 0 |
| Options, warrants, ETF instruments | SPOT only in Phase 0 |
| Any form of backtesting on OKX data | Out of scope for Phase 0 |

---

## 10. Implementation Order (Phased)

### Phase 0-A: Foundation (First PR)

1. Add OKX schema tables to `convex/schema.ts` (append-only, no existing changes).
2. Create `src/lib/okx/types.ts` — all TypeScript interfaces for OKX API responses.
3. Create `src/lib/okx/client.ts` — public REST client wrapper.

### Phase 0-B: API Routes (Second PR)

4. Create `src/app/api/okx/ticker/route.ts`.
5. Create `src/app/api/okx/instruments/route.ts`.
6. Create `src/app/api/okx/regime/route.ts` + `src/lib/okx/regime.ts`.
7. Manual test each endpoint with `curl` or browser before proceeding.

### Phase 0-C: UI (Third PR)

8. Create `OkxReadOnlyBanner` component.
9. Create `OkxBtcPriceCard` component.
10. Create `OkxRegimeCard` component.
11. Create `OkxInstrumentTable` component.
12. Create `src/app/(dashboard)/okx-lab/page.tsx` and `loading.tsx`.
13. Add OKX nav group to `src/lib/constants/navigation.ts`.

### Phase 0-D: Convex Persistence (Fourth PR, optional)

14. Create `convex/okxMarketData.ts` — Convex queries and mutations for ticker/regime storage.
15. Update API routes to optionally persist snapshots to Convex via HTTP actions.
16. Create `convex/okxInstruments.ts` for instruments catalogue caching.

Each phase is a separate PR. Each PR must pass TypeScript build (`next build`) before merge.

---

## 11. Risks and Blockers

| Risk | Severity | Mitigation |
|---|---|---|
| OKX public API rate limits (20 req/2s) exceeded during development | Medium | Add client-side caching (30s for ticker, 5min for regime). Log rate-limit 429 errors explicitly. |
| OKX API response schema changes (v5 API is versioned but fields can change) | Medium | Pin typed interfaces to the current v5 spec. Add runtime validation (e.g., Zod) in Phase 0-B. |
| Next.js 16.2.4 — non-standard breaking changes per AGENTS.md warning | High | Read `node_modules/next/dist/docs/` before writing any route handler. Do not assume standard App Router patterns from training data. |
| Convex schema migration — appending tables to live schema | Low | Convex supports additive schema changes without downtime. Review Convex migration docs before deploying. |
| Symbol allowlist omission enabling SSRF via ticker endpoint | High | Implement strict symbol allowlist in `/api/okx/ticker/route.ts` before Phase 0-B goes live. |
| OKX geographic restrictions (some regions block OKX API) | Low | Note in README for developers. Use a proxy or VPN if needed in development. |
| Accidental MT5/OKX data cross-contamination | High | Enforce directory-level separation from day one. Add lint rule to block cross-imports if feasible. |
| Regime MA200 logic diverges from standard definition | Low | Document the exact formula in `src/lib/okx/regime.ts` comments. Use simple moving average of daily close prices only. |
| `technicalIndicatorSnapshots` table temptation for reuse | Medium | Explicitly document in code that this table is MT5-only. OKX must create `okxTechnicalSnapshots` if needed in a future phase. |

---

*End of OKX Read-Only Foundation Plan. This document is a plan only. No source files have been modified.*
