# PROJECT AUDIT — نظام الملك الهندسي للتداول العالمي

> Audit date: 2026-04-28  
> Auditor: Claude Sonnet 4.6  
> Repository: MT5-NEXT.js-main  
> Build status at audit: ✅ PASSING — `pnpm build` clean, `tsc --noEmit` clean, Python compile clean

---

## 1. Current Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | Next.js (Turbopack) | 16.2.4 |
| UI library | React | 19.2.4 |
| Language | TypeScript | 5.x (strict) |
| Styling | Tailwind CSS 4 | latest |
| UI components | shadcn/ui + Base UI | — |
| Icons | Lucide React | 1.11.0 |
| Charts | Recharts | 3.8.1 |
| Backend / DB | Convex | 1.36.1 |
| Auth | Clerk Next.js | 7.2.7 |
| Package manager | pnpm | 10.33.2 |
| MT5 agent | Python FastAPI + Uvicorn | — |
| MT5 binding | MetaTrader5 (Windows DLL) | — |
| HTTP client | Node fetch (built-in) | — |

---

## 2. Folder Structure

```
MT5-NEXT.js-main/
├── convex/                        ← Convex backend
│   ├── schema.ts                  ← 16-table database schema
│   ├── auth.config.ts             ← Clerk auth config
│   ├── mt5Bridge.ts               ← Read-only bridge mutations + safety guards
│   ├── coreQueries.ts             ← All read queries (accounts, ticks, signals…)
│   ├── coreSeed.ts                ← Demo data seeding (dev only)
│   ├── testEvents.ts              ← Convex connectivity test
│   ├── technicalIndicators.ts     ← EMA/RSI/MACD/ATR computation
│   ├── health.ts                  ← Health check query
│   └── _generated/                ← Auto-generated Convex types
│
├── mt5_readonly_service/          ← Python FastAPI read-only proxy
│   ├── main.py                    ← 22.6KB — all read-only endpoints
│   ├── requirements.txt           ← FastAPI, MetaTrader5, NumPy…
│   ├── .env.example               ← SYMBOLS env var template
│   └── README.md                  ← Setup + run instructions
│
├── src/
│   ├── app/
│   │   ├── page.tsx               ← Root redirect to /dashboard
│   │   ├── sign-in/               ← Clerk sign-in
│   │   ├── sign-up/               ← Clerk sign-up
│   │   └── (dashboard)/
│   │       ├── dashboard/         ← Main dashboard
│   │       ├── lab/               ← Signal lab + technical analysis
│   │       ├── monitoring/        ← Service health monitoring
│   │       ├── replay/            ← Historical replay
│   │       ├── reports/           ← Trade history + committee reports
│   │       ├── settings/          ← MT5 connection + symbol settings
│   │       ├── convex-core/       ← Dev: data seeding + sync controls
│   │       └── convex-test/       ← Dev: Clerk + Convex integration test
│   │
│   │   └── api/mt5-readonly/      ← Next.js API route proxies
│   │       ├── connection-status/
│   │       ├── connect/
│   │       ├── snapshot/
│   │       ├── symbols/
│   │       ├── history-deals/
│   │       └── candles/
│   │
│   ├── components/
│   │   ├── layout/                ← AppShell, AppHeader, AppSidebar
│   │   ├── dashboard/             ← 9 dashboard widgets
│   │   ├── monitoring/            ← MonitoringDashboard
│   │   ├── providers/             ← Convex+Clerk, mock stream, monitoring snapshot
│   │   ├── ui/                    ← 18 shadcn components
│   │   └── common/                ← StatusBadge
│   │
│   └── lib/
│       ├── api/                   ← HTTP clients for Python service
│       ├── constants/             ← mock-data.ts, navigation.ts, market-sessions.ts
│       ├── hooks/                 ← use-mt5-connection-status, use-read-only-monitoring-snapshot
│       ├── mock-market-stream.ts  ← Client-side price simulation
│       ├── mt5-bridge/            ← Read-only assertions + constants
│       ├── types/                 ← trading.ts, monitoring-api.ts
│       └── utils.ts / ui-institutional.ts / market-session-time.ts
│
├── public/                        ← Static assets
├── package.json
├── tsconfig.json
├── next.config.ts                 ← Empty (no overrides)
├── postcss.config.mjs
└── components.json
```

---

## 3. Currently Implemented Features

| Feature | Status | Notes |
|---|---|---|
| MT5 read-only data proxy (Python) | ✅ Working | All 10 endpoints implemented |
| MT5 connection status polling | ✅ Working | 12s interval hook |
| Account snapshot ingestion | ✅ Working | Convex mutation + query |
| Market ticks ingestion | ✅ Working | Real MT5 bid/ask/spread |
| Open positions ingestion | ✅ Working | Read-only, no execution |
| Trade history deals ingestion | ✅ Working | Date range + symbol filter |
| Candle (OHLCV) ingestion | ✅ Working | Multi-symbol, multi-timeframe |
| Technical indicators (EMA/RSI/MACD/ATR) | ✅ Working | Computed from Convex candles |
| Symbol catalog (Market Watch) | ✅ Working | Batch sync, 200/call limit |
| Governance enforcement | ✅ Working | readOnly=true, tradingEnabled=false |
| Audit event trail | ✅ Working | All mutations logged |
| Protection event log | ✅ Working | Severity + blocked flag |
| Committee reports | ✅ Working | Multi-factor decision records |
| Lab signal snapshots | ✅ Working | Verdict + probability + risk |
| Monitoring status | ✅ Working | 6 service components tracked |
| Authentication (Clerk) | ✅ Working | Sign-in/up, user isolation |
| Arabic RTL UI | ✅ Working | All labels in Arabic |
| Collapsible RTL sidebar | ✅ Working | 5 groups, auto-open on active route |
| Header with real MT5 status | ✅ Working | Connection + account badges |
| Dashboard page | ✅ Working | Summary cards, ticks, monitoring |
| Lab page | ✅ Working | Signals, indicators, committee |
| Reports page | ✅ Working | Trade history table |
| Monitoring page | ✅ Working | Service health grid |
| Settings page | ✅ Working | MT5 form + symbol watch |
| Replay page | ⚠️ Partial | JSON bar input only, no real data feed |
| Mock market stream | ⚠️ Demo | Client-side random walk, not real |
| Market sparklines | ⚠️ Demo | Based on mock stream |
| Market pulse indicator | ⚠️ Demo | mockLive param, not real |
| convex-core dev page | ✅ Dev-only | Data seeding + sync controls |
| convex-test dev page | ✅ Dev-only | Integration test events |
| Convex codegen | ✅ Working | _generated/ present |

---

## 4. MT5 Integration Status

### Python Service (`mt5_readonly_service/main.py`)

| Endpoint | Status | Notes |
|---|---|---|
| POST /connect | ✅ Implemented | Validates credentials, no persistence |
| GET /connection-status | ✅ Implemented | Real account info when connected |
| GET /health | ✅ Implemented | read_only_mode always true |
| GET /readonly/account | ✅ Implemented | login, balance, equity, margin |
| GET /readonly/ticks | ✅ Implemented | bid/ask/spread for configured symbols |
| GET /readonly/positions | ✅ Implemented | All open positions |
| GET /readonly/snapshot | ✅ Implemented | account + ticks + positions combined |
| GET /readonly/symbols | ✅ Implemented | Market Watch catalog, search, pagination |
| GET /readonly/history-deals | ✅ Implemented | Date range + symbol filter |
| GET /readonly/candles | ✅ Implemented | OHLCV, multi-symbol, multi-timeframe |

**Safety enforcement:**
- `READ_ONLY_MODE = True` constant checked on every request
- `FORBIDDEN_MT5_FUNCTION_NAMES` tuple blocks `order_send`, `order_close`, `order_modify`, `order_check`
- No buy/sell/close endpoints exist
- Arabic safety contract comment at file top

**Known gaps:**
- `/health` returns only `{"status": "ok", "read_only_mode": true, "mt5_connected": bool}` — no version, uptime, last-sync time
- No `/readonly/candles` streaming or progress for large requests
- No rate limiting on any endpoint
- `terminal_path` is passed by client but not validated server-side
- Password received in POST /connect but not stored (correct, but should be logged as received)
- No `max-age` or cache headers — clients must set their own timeouts
- No reconnection logic if MT5 terminal disconnects mid-session

### Next.js API Proxies (`src/app/api/mt5-readonly/`)

All six routes proxy to `http://127.0.0.1:8010/` with:
- 5-8 second fetch timeout
- `force-dynamic` cache directive
- Arabic error messages
- 503 on unavailability

**Known gaps:**
- Hardcoded `127.0.0.1:8010` — no env var for remote/different-port service
- No retry logic on timeout
- No request ID / correlation header
- Timeout values inconsistent across routes (some 5s, some 8s)

---

## 5. Convex Integration Status

### Schema — 16 Tables

| Table | Purpose | Indexed by | Status |
|---|---|---|---|
| testEvents | Dev integration test | userId | ✅ |
| users | User profiles | clerkId, email | ✅ |
| mt5AccountSnapshots | Account balance history | userId + capturedAt | ✅ |
| mt5MarketTicks | Live bid/ask data | userId + symbol + capturedAt | ✅ |
| mt5OpenPositions | Open positions | userId + capturedAt | ✅ |
| labSignalSnapshots | Signal analysis results | userId + createdAt | ✅ |
| committeeReports | Decision audit | userId + createdAt | ✅ |
| protectionEvents | Risk/protection blocks | userId + createdAt | ✅ |
| governanceState | User trading governance | userId | ✅ |
| auditEvents | Full action audit | userId + createdAt | ✅ |
| monitoringStatus | Service health | userId + component | ✅ |
| mt5Symbols | Symbol catalog | userId + name | ✅ |
| userSymbolSettings | Per-symbol user filters | userId + symbol | ✅ |
| mt5TradeHistoryDeals | Closed deals | userId + symbol + openTime | ✅ |
| mt5Candles | OHLCV data | userId + symbol + timeframe + time | ✅ |
| technicalIndicatorSnapshots | EMA/RSI/MACD/ATR | userId + symbol + timeframe + computedAt | ✅ |

**Known gaps:**
- No pagination on `coreQueries.ts` queries — `.collect()` on large tables is a scaling risk
- `mt5Candles` and `mt5MarketTicks` will grow unbounded — no TTL or archival strategy
- No compound index on `mt5Candles` by `(userId, symbol, timeframe, time)` for range queries
- `technicalIndicators.ts` `computeTechnicalIndicatorsForEnabledSymbols` — no per-symbol/timeframe deduplication guard

### Mutations

| Mutation | Safety | Notes |
|---|---|---|
| syncReadOnlySnapshotFromLocalService | ✅ Read-only | Ingest from Python service |
| syncMt5SymbolsCatalog | ✅ Read-only | 200/call batch |
| syncMt5TradeHistoryDeals | ✅ Read-only | 200/call batch |
| syncMt5Candles | ✅ Read-only | 1000/call batch |
| demoSyncReadOnlySnapshotsFromMt5Stub | ⚠️ Demo | Dev-only fake data writer |
| seedCoreDemoData | ⚠️ Demo | Dev-only seeder |
| purgeDemoAndStubRowsDevOnly | ⚠️ Dev-only | Requires `PURGE_DEMO=true` flag |
| computeTechnicalIndicatorsForEnabledSymbols | ✅ Read-only | Pure computation |

---

## 6. Clerk Auth Status

- Provider: `convex-clerk-provider.tsx` wraps both `ClerkProvider` and `ConvexProviderWithClerk`
- Sign-in: `/sign-in` — Clerk hosted UI
- Sign-up: `/sign-up` — Clerk hosted UI
- All Convex queries/mutations require `ctx.auth.getUserIdentity()` — missing identity throws
- User table stores Clerk subject as `clerkId`
- `useAuth()` hook used in `AppHeader` for user button / sign-in buttons
- After sign-in: redirects to `/dashboard`
- Status: ✅ Working

---

## 7. Pages and Routes

| Route | Type | Purpose |
|---|---|---|
| / | Static | Redirect to /dashboard |
| /dashboard | Static | Main dashboard |
| /lab | Static | Signal lab + indicators |
| /monitoring | Static | Service health |
| /replay | Static | Historical replay |
| /reports | Static | Trade history |
| /settings | Static | Connection + user settings |
| /convex-core | Static | Dev: data seeding |
| /convex-test | Static | Dev: integration test |
| /sign-in/[[...sign-in]] | Dynamic | Clerk auth |
| /sign-up/[[...sign-up]] | Dynamic | Clerk auth |
| /api/mt5-readonly/connection-status | Dynamic | MT5 proxy |
| /api/mt5-readonly/connect | Dynamic | MT5 proxy |
| /api/mt5-readonly/snapshot | Dynamic | MT5 proxy |
| /api/mt5-readonly/symbols | Dynamic | MT5 proxy |
| /api/mt5-readonly/history-deals | Dynamic | MT5 proxy |
| /api/mt5-readonly/candles | Dynamic | MT5 proxy |

---

## 8. Data Flow

```
MetaTrader 5 Terminal (Windows)
        │
        │ MetaTrader5 Python DLL
        ▼
Python FastAPI  (127.0.0.1:8010)
  READ_ONLY_MODE = True
  No order_send / order_close / order_modify
        │
        │ HTTP fetch (5-8s timeout)
        ▼
Next.js API Routes  (/api/mt5-readonly/*)
  force-dynamic, error handling, Arabic messages
        │
        │ fetch() from client components
        ▼
Browser / React Components
  (AppHeader, Dashboard widgets, Lab page…)
        │
        │ useMutation() — data ingestion
        ▼
Convex Cloud Backend
  Mutations: syncReadOnlySnapshot, syncCandles, syncDeals, syncSymbols
  Queries: getMyLatest*, getMyOpen*, getMyTechnicalIndicators
        │
        │ useQuery() — reactive
        ▼
React UI Components
  Dashboard, Lab, Reports, Monitoring, Settings
```

**Parallel flows:**
- Mock market stream: pure client-side, React Context, random walk, no API calls
- MT5 connection status: direct poll to `/api/mt5-readonly/connection-status` every 12s

---

## 9. Real Data vs Fake/Demo Data Analysis

| Component | Data Source | Real or Fake? | Risk |
|---|---|---|---|
| AppHeader connection badge | useMt5ConnectionStatus hook → real API | ✅ Real | Low |
| AppHeader account badges | useMt5ConnectionStatus → real API | ✅ Real | Low |
| Dashboard account summary | Convex getMyLatestRealMt5AccountSnapshot | ✅ Real (if synced) | Low |
| Dashboard market ticks | Convex getLatestRealMt5MarketTicks | ✅ Real (if synced) | Low |
| Dashboard system cards | Convex governance + monitoring | ✅ Real | Low |
| LiveMarketCard / LiveMarketTicker | MockMarketStreamContext | ❌ Fake | HIGH |
| MiniMarketSparkline | MockMarketStreamContext (24 bar history) | ❌ Fake | HIGH |
| MarketPulseIndicator | mockLive parameter + mock stream | ❌ Fake | HIGH |
| AnalogMarketClock | System clock + static session times | ⚠️ Partial | Medium |
| MarketSessionsPanel | System clock + static session times | ⚠️ Partial | Medium |
| Lab signals | Convex labSignalSnapshots | ✅ Real (if computed) | Low |
| Lab technical indicators | Convex technicalIndicatorSnapshots | ✅ Real (if candles synced) | Low |
| Reports trade history | Convex mt5TradeHistoryDeals | ✅ Real (if synced) | Low |
| Monitoring dashboard | Convex monitoringStatus | ✅ Real | Low |
| Replay page | User-provided JSON bars | ⚠️ Manual | Medium |
| convex-core seed data | coreSeed.ts — hardcoded demo values | ❌ Fake | HIGH (dev only) |
| Demo account snapshot | 100,000 USD DEMO-10001 | ❌ Fake | HIGH (dev only) |
| Mock market stream | Random-walk generator | ❌ Fake | HIGH (visible in UI) |

---

## 10. Current UI Issues

1. **Mock market stream visible in production UI** — `LiveMarketCard`, `LiveMarketTicker`, `MiniMarketSparkline`, and `MarketPulseIndicator` all render mock data without clear "DEMO" labelling. A user could mistake random-walk prices for real MT5 prices.

2. **Replay page has no real data feed** — The replay page accepts raw JSON bars but has no integration with real MT5 candles from Convex. It is incomplete.

3. **Duplicate navigation groups** — Previous sidebar sessions left `العقول واللجان` pointing to `/lab` (same as `المختبر`). Now cleaned but should be verified.

4. **Settings page password input** — Password field in MT5 connection form; while not stored in DB, it is transmitted in plaintext to the Next.js API which proxies it to Python. No TLS enforcement for local connection (acceptable for localhost but should be documented).

5. **No empty state differentiation** — Pages do not clearly distinguish between "no data yet — sync first" vs "MT5 disconnected" vs "no trades in period". Users see generic empty states.

6. **DashboardActivitySection uses mock data constants** — `mock-data.ts` signals are rendered in dashboard activity unless real signals exist. No "no real signals yet" empty state.

7. **convex-core and convex-test pages are dev interfaces exposed in production build** — They appear in the sidebar navigation. Should be hidden or protected by role/env check.

8. **Replay page has no guard** — JSON input is unvalidated — malformed JSON will throw unhandled error.

---

## 11. Current Backend Issues

1. **No `.collect()` pagination guards** — Several Convex queries use `.collect()` which loads all matching documents. On large `mt5Candles` or `mt5MarketTicks` tables this will hit Convex document limits.

2. **mt5Candles table has no deduplication on write** — `syncMt5Candles` inserts new rows without checking if `(userId, symbol, timeframe, time)` already exists. Long-running sync will create duplicate candles.

3. **No TTL on mt5MarketTicks** — Ticks accumulate indefinitely. This table will grow to millions of rows for active users.

4. **technicalIndicators computation has no guard** — `computeTechnicalIndicatorsForEnabledSymbols` re-computes for all enabled symbols every call. No freshness check or debounce.

5. **Python service has no reconnection logic** — If MT5 terminal disconnects between requests, the service returns 503 with no automatic retry or reconnection attempt.

6. **Hardcoded service URL** — `http://127.0.0.1:8010` is hardcoded in all six API route files. No env var makes this inflexible for different configs.

7. **No rate limiting** — Python service has no rate limit on any endpoint. A runaway client could flood it with candle requests.

8. **No `/health` uptime or version** — The health endpoint returns minimal info. No build version, uptime, or last successful MT5 call timestamp.

9. **coreSeed demo data has no idempotency guard** — Calling `seedCoreDemoData()` multiple times creates duplicate demo users and snapshots. The purge mutation exists but is a manual step.

10. **No Convex scheduled actions** — There is no automated sync schedule. All data ingestion is user-triggered from the convex-core dev page. For a production system, syncs should be scheduled.

---

## 12. Current Security Risks

| Risk | Severity | Description |
|---|---|---|
| MT5 password in request body | Medium | POST /connect sends password in JSON body. Not stored, but transmitted in plaintext over localhost. Acceptable for localhost, must be documented. |
| Dev pages in production | Low-Medium | /convex-core and /convex-test are accessible without role guard. They expose seed/purge controls. |
| No env var for service URL | Low | Hardcoded 127.0.0.1:8010 — no way to misconfigure to an unintended host, but inflexible. |
| No Clerk middleware on API routes | Low | `/api/mt5-readonly/*` routes do not verify Clerk session. Any caller on the same origin can proxy to MT5 service. |
| purgeDemoAndStubRowsDevOnly requires PURGE_DEMO env | Low | Guard exists but is string comparison `=== "true"` — easy to bypass by typo. |
| No CORS config on Python service | Info | FastAPI default allows all origins. For localhost-only this is acceptable. |
| No request size limit on /connect | Info | Password and terminal_path are unbounded strings. |

---

## 13. Current Missing Tests

- No unit tests for any TypeScript code
- No unit tests for Python service
- No integration tests for Convex mutations/queries
- No API route tests
- No E2E tests
- No indicator computation tests (EMA, RSI, MACD, ATR)
- No candle deduplication tests
- `testEvents` Convex module is a connectivity test, not a proper test suite
- `convex-test` page is a manual dev tool, not automated

---

## 14. Current Technical Debt

| Item | Priority |
|---|---|
| Mock market stream must be clearly labelled or replaced with real MT5 ticks | HIGH |
| `.collect()` calls need pagination (`.paginate()`) | HIGH |
| Candle deduplication on write | HIGH |
| No automated sync schedule (Convex actions) | HIGH |
| Hardcoded service URL — env var needed | MEDIUM |
| Dev pages need role/env guard | MEDIUM |
| Settings page password field UX (show/hide, confirm) | MEDIUM |
| `/health` endpoint needs uptime + version | MEDIUM |
| Replay page needs real candle data integration | MEDIUM |
| Technical indicator computation needs freshness guard | MEDIUM |
| No TTL/archival for market ticks | MEDIUM |
| Empty state differentiation | LOW |
| Consistent fetch timeout across API routes | LOW |
| Request ID / correlation header on proxied calls | LOW |

---

## 15. Current Build / Typecheck Status

| Check | Status | Notes |
|---|---|---|
| `pnpm install` | ✅ Pass | Done in 5.7s |
| `pnpm exec tsc --noEmit` | ✅ Pass | No errors |
| `pnpm build` | ✅ Pass | 12 pages, all routes compiled |
| `python -m py_compile main.py` | ✅ Pass | No syntax errors |
| `pnpm exec convex codegen` | ⚠️ Not run | Requires live Convex deployment |

---

## 16. Fake/Demo Data Removal Plan

### F-01 — Mock Market Stream (LiveMarketCard, LiveMarketTicker, MiniMarketSparkline, MarketPulseIndicator)

| Field | Value |
|---|---|
| Files | `src/lib/mock-market-stream.ts`, `src/components/providers/mock-market-stream-provider.tsx`, `src/components/providers/dashboard-experience-providers.tsx`, `src/components/dashboard/LiveMarketCard.tsx`, `src/components/dashboard/LiveMarketTicker.tsx`, `src/components/dashboard/MiniMarketSparkline.tsx`, `src/components/dashboard/MarketPulseIndicator.tsx` |
| What it does | Generates random-walk prices for 6 symbols. Used as live-looking price feed in dashboard. |
| Still needed? | NO for production. Can be kept as a dev fallback or removed entirely. |
| Replacement | Real `mt5MarketTicks` from Convex (`getLatestRealMt5MarketTicks`), polled every sync cycle. |
| Safe migration stage | Stage 1–2: add "DEMO" badge to all mock-stream widgets immediately. Stage 3: replace with real Convex ticks. Stage 4: remove mock stream when real ticks are stable. |

### F-02 — Demo Seed Data (`convex/coreSeed.ts`)

| Field | Value |
|---|---|
| Files | `convex/coreSeed.ts` |
| What it does | Seeds a demo user with DEMO-10001 account (100,000 USD), EURUSD/XAUUSD ticks, 0.01 XAUUSD position. All tagged `source: "core-demo-seed"`. |
| Still needed? | YES for dev/onboarding. NOT for production display. |
| Replacement | Queries already filter by source. Ensure no `core-demo-seed` data appears in production user sessions. |
| Safe migration stage | Stage 1: add server-side filter to exclude `core-demo-seed` from all production queries. Stage 3: add `purgeDemoAndStubRowsDevOnly` to CI setup. |

### F-03 — MT5 Bridge Stub (`convex/mt5Bridge.ts` — `demoSyncReadOnlySnapshotsFromMt5Stub`)

| Field | Value |
|---|---|
| Files | `convex/mt5Bridge.ts` lines 133–230 |
| What it does | Writes fake account/ticks/positions with source `"mt5-bridge-read-only-stub"`. |
| Still needed? | YES for dev when MT5 terminal unavailable. NO for production. |
| Replacement | Real `syncReadOnlySnapshotFromLocalService`. |
| Safe migration stage | Stage 2: hide stub sync button behind `NODE_ENV === "development"` check. |

### F-04 — Mock Signals in Dashboard Activity (`src/lib/constants/mock-data.ts`)

| Field | Value |
|---|---|
| Files | `src/lib/constants/mock-data.ts`, `src/components/dashboard/DashboardActivitySection.tsx` |
| What it does | Hardcoded Arabic signal objects (EURUSD, XAUUSD, GBPJPY) rendered in dashboard activity section if no real signals exist. |
| Still needed? | NO. Replace with empty state. |
| Replacement | `getMyLatestRealSignals()` from Convex. Show "لا توجد إشارات حقيقية بعد" if empty. |
| Safe migration stage | Stage 1: add "DEMO" label to any mock data shown. Stage 3: replace with real Convex query + proper empty state. |

### F-05 — Mock Monitoring Data (`src/lib/constants/mock-data.ts` — monitoring section)

| Field | Value |
|---|---|
| Files | `src/lib/constants/mock-data.ts`, `src/components/providers/monitoring-snapshot-provider.tsx` |
| What it does | Fallback monitoring status constants used when Convex monitoring data unavailable. |
| Still needed? | As a fallback skeleton — yes. As actual displayed state — NO. |
| Replacement | Real `getMyMonitoringStatus()` from Convex. Show loading skeleton, not fake "ok" values. |
| Safe migration stage | Stage 1: replace mock monitoring fallback with explicit "جارٍ التحميل" skeleton. |

### F-06 — testEvents Table

| Field | Value |
|---|---|
| Files | `convex/schema.ts`, `convex/testEvents.ts`, `src/app/(dashboard)/convex-test/page.tsx` |
| What it does | Convex connectivity dev test — creates/lists test events. |
| Still needed? | YES for dev. Should not appear in production navigation. |
| Replacement | Keep but remove from sidebar navigation in production. |
| Safe migration stage | Stage 0: add `NODE_ENV` or role guard on `/convex-test` page. Remove from NAV_GROUPS if not `development`. |

### F-07 — convex-core Dev Page in Sidebar

| Field | Value |
|---|---|
| Files | `src/lib/constants/navigation.ts`, `src/app/(dashboard)/convex-core/page.tsx` |
| What it does | Exposes data seeding, stub sync, purge buttons to any signed-in user. |
| Still needed? | YES for dev. NOT for production. |
| Replacement | Gate behind `process.env.NODE_ENV === "development"` or admin role check. |
| Safe migration stage | Stage 0: add env guard immediately. |
