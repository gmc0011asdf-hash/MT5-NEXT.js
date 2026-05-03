# DATA & BACKEND REVIEW

**Project:** MT5-NEXT.js — Professional Trading Analysis System  
**Stack:** Next.js 16.2.4 · Convex 1.36.1 · Clerk (@clerk/nextjs 7.2.7)  
**Review date:** 2026-05-02  
**Scope:** Read-only audit — no schema, migration, or code changes made.

---

## 1. Convex Schema Inventory (all tables)

| # | Table | Key fields | Indexes | userId field? | Risk notes |
|---|-------|-----------|---------|---------------|-----------|
| 1 | `testEvents` | title, source, userId, email, createdAt | `by_user [userId]` | `userId` (string) | Dev/test only; email stored in plain text alongside userId |
| 2 | `users` | clerkUserId, email, name, role, status, createdAt, updatedAt | `by_clerkUserId`, `by_email` | `clerkUserId` (string) | `role` and `status` are free strings — no enum enforcement at schema level |
| 3 | `mt5AccountSnapshots` | userId, accountLogin, broker, server, currency, balance, equity, margin, freeMargin, marginLevel, capturedAt, source, syncRunId | `by_userId`, `by_capturedAt`, `by_userId_capturedAt` | `userId` | Grows unboundedly — no TTL or row-cap mechanism |
| 4 | `mt5MarketTicks` | symbol, bid, ask, spread, capturedAt, source, syncRunId | `by_symbol`, `by_capturedAt`, `by_symbol_capturedAt` | **None** | No userId — tick data is global/shared. Any authenticated user's mutation can insert ticks readable by all queries that do not scope by user |
| 5 | `mt5OpenPositions` | userId, ticket, symbol, type, volume, openPrice, currentPrice, stopLoss, takeProfit, profit, openedAt, capturedAt, source, syncRunId | `by_userId`, `by_symbol`, `by_userId_symbol`, `by_capturedAt` | `userId` | Old position rows from prior sync runs are never deleted; resolved via in-memory syncRunId grouping |
| 6 | `labSignalSnapshots` | userId, symbol, timeframe, verdict, probability, entry, stopLoss, takeProfit, riskUsd, recommendedLot, status, reason, createdAt, source | `by_userId`, `by_symbol`, `by_createdAt`, `by_userId_createdAt` | `userId` | Grows unboundedly — no archival strategy |
| 7 | `committeeReports` | signalId (optional ref), userId, symbol, scores×3, finalVerdict, summary, createdAt | `by_userId`, `by_symbol`, `by_createdAt` | `userId` | `signalId` is `v.optional(v.id(...))` — weak reference; referential integrity not enforced |
| 8 | `protectionEvents` | userId, symbol, eventType, severity, message, blocked, createdAt, source | `by_userId`, `by_symbol`, `by_createdAt`, `by_severity` | `userId` | `severity` index allows cross-user query by severity — ensure queries always scope by userId |
| 9 | `governanceState` | userId, mode, tradingEnabled, readOnly, maxDailyTrades, maxRiskUsd, updatedAt | `by_userId` | `userId` | `tradingEnabled` and `readOnly` are plain booleans — every sync mutation re-enforces read-only; no cryptographic lock |
| 10 | `auditEvents` | userId, action, entity, entityId, message, createdAt, source, syncRunId | `by_userId`, `by_action`, `by_createdAt` | `userId` | `by_action` index is cross-user — ensure all action-based queries also filter by userId |
| 11 | `monitoringStatus` | userId, service, status, message, checkedAt, syncRunId | `by_userId`, `by_service`, `by_checkedAt`, `by_userId_service` | `userId` | `by_service` index is cross-user |
| 12 | `mt5Symbols` | name, path, description, currency fields, digits, visible, tradeMode, point, spread, visibleOnly, selectedInMarketWatch, source, syncRunId, capturedAt | `by_name`, `by_capturedAt`, `by_source`, `by_source_capturedAt` | **None** | No userId — symbol catalog is shared/global. All authenticated users see the same catalog |
| 13 | `userSymbolSettings` | userId, symbol, enabled, showInLab, updatedAt | `by_userId`, `by_symbol`, `by_userId_symbol` | `userId` | `by_symbol` index is cross-user |
| 14 | `mt5TradeHistoryDeals` | userId, dealTicket, orderTicket, positionId, symbol, type, entry, volume, price, profit, commission, swap, fee, time, comment, magic, source, syncRunId, capturedAt | `by_userId`, `by_symbol`, `by_time`, `by_userId_time`, `by_dealTicket`, `by_userId_dealTicket` | `userId` | `by_symbol` and `by_time` are cross-user; `by_dealTicket` is cross-user — dedup must use `by_userId_dealTicket` |
| 15 | `mt5Candles` | userId, symbol, timeframe, time, open, high, low, close, tickVolume, spread, realVolume, source, syncRunId, capturedAt | `by_userId`, `by_symbol_timeframe`, `by_symbol_timeframe_time`, `by_userId_symbol_timeframe`, `by_userId_symbol_timeframe_time` | `userId` | `by_symbol_timeframe` and `by_symbol_timeframe_time` are cross-user; high row count expected |
| 16 | `technicalIndicatorSnapshots` | userId, symbol, timeframe, candleCount, ema20–ema200, rsi14, atr14, macd×3, volatility, recentHigh/Low, lastClose, trendBias, momentumBias, createdAt, source, syncRunId | `by_userId_symbol_timeframe`, `by_symbol_timeframe`, `by_createdAt`, `by_userId_createdAt` | `userId` | Grows unboundedly — old snapshots never purged; `by_symbol_timeframe` is cross-user |

**Total tables: 16**

---

## 2. Mutations Audit

### 2.1 `mt5Bridge.ts`

| Mutation | Writes to | Auth check | Governance enforced | Notes |
|----------|-----------|------------|--------------------|----|
| `demoSyncReadOnlySnapshotsFromMt5Stub` | `governanceState`, `mt5AccountSnapshots`, `mt5MarketTicks`, `mt5OpenPositions`, `monitoringStatus`, `auditEvents` | Yes — `requireIdentifiedUser` throws if no identity | Yes — forces `tradingEnabled:false, readOnly:true` | Stub / demo only; safe |
| `syncReadOnlySnapshotFromLocalService` | `monitoringStatus`, `mt5AccountSnapshots`, `mt5MarketTicks`, `mt5OpenPositions`, `governanceState`, `auditEvents` | Yes — `requireIdentifiedUser` | Yes — `enforceGovernanceReadOnly` called at end | mt5MarketTicks inserts have **no userId** — shared across all users |
| `syncReadOnlySymbolsFromLocalService` | `mt5Symbols`, `userSymbolSettings`, `governanceState`, `auditEvents` | Yes — `requireIdentifiedUser` | Yes — on final chunk only | mt5Symbols has **no userId** — global catalog; any user's sync overwrites all users' symbol data |
| `syncReadOnlyTradeHistoryFromLocalService` | `monitoringStatus`, `governanceState`, `auditEvents`, `mt5TradeHistoryDeals` | Yes — `requireIdentifiedUser` | Yes — on final chunk only | Dedup uses `by_userId_dealTicket` (correct) |
| `syncReadOnlyCandlesFromLocalService` | `monitoringStatus`, `mt5Candles`, `governanceState`, `auditEvents` | Yes — `requireIdentifiedUser` | Yes — on final chunk only | Dedup uses `by_userId_symbol_timeframe_time` (correct); OHLC validation is thorough |
| `updateMySymbolSetting` | `userSymbolSettings`, `governanceState`, `auditEvents` | Yes — `requireIdentifiedUser` | Yes — `enforceGovernanceReadOnly` called unconditionally | Symbol setting UI is user-scoped |
| `clearDemoMt5ReadOnlyData` | `mt5AccountSnapshots`, `mt5MarketTicks`, `mt5OpenPositions`, `auditEvents`, `labSignalSnapshots`, `protectionEvents` | Yes — `requireIdentifiedUser` | Gated by `process.env.ALLOW_DEV_CLEANUP === "true"` | Uses **`collect()` on 6 tables** — full table scan; acceptable only in dev; must never run in prod |

### 2.2 `technicalIndicators.ts`

| Mutation | Writes to | Auth check | Governance enforced | Notes |
|----------|-----------|------------|--------------------|----|
| `computeTechnicalIndicatorsForEnabledSymbols` | `governanceState`, `technicalIndicatorSnapshots`, `auditEvents` | Yes — `identity.subject` throws implicitly | Yes — forces `tradingEnabled:false, readOnly:true` | Inner loop does **N × M** individual candle fetches (symbols × timeframes) — each fetch is indexed but overall DB read count is high for large symbol sets |

### 2.3 `coreSeed.ts`

| Mutation | Writes to | Auth check | Governance enforced | Notes |
|----------|-----------|------------|--------------------|----|
| `seedCoreDemoData` | `users`, `governanceState`, `mt5AccountSnapshots`, `mt5MarketTicks`, `labSignalSnapshots`, `committeeReports`, `mt5OpenPositions`, `protectionEvents`, `auditEvents`, `monitoringStatus` | Yes — `ConvexError` if no identity | Yes — `govPayload` forces `tradingEnabled:false, readOnly:true` | `monitoringStatus` insert does **not** use `_upsertMonitoringStatus` — will create duplicate rows on repeated seed calls |

### 2.4 `testEvents.ts`

| Mutation | Writes to | Auth check | Governance enforced | Notes |
|----------|-----------|------------|--------------------|----|
| `createTestEvent` | `testEvents` | Yes — `ConvexError` if no identity | No | Test/dev only; no governance guard needed for a test table; acceptable |

---

## 3. Queries Audit

### 3.1 `coreQueries.ts`

| Query | Reads from | Auth check | userId scoped | Notes |
|-------|-----------|------------|---------------|-------|
| `getMyLatestAccountSnapshot` | `mt5AccountSnapshots` | Soft — returns `null` if no identity | Yes — `by_userId` index | `collect()` on user's snapshot rows, then in-memory sort — acceptable if row count per user stays bounded |
| `getMyLatestRealMt5AccountSnapshot` | `mt5AccountSnapshots` | Soft — returns `null` | Yes | Same collect-then-sort pattern |
| `getLatestMarketTicks` | `mt5MarketTicks` | Soft — returns `[]` | **No** — `by_capturedAt` only (global) | Takes 500 global rows, merges in-memory — tick table has no userId; data returned is same for all users |
| `getLatestRealMt5MarketTicks` | `mt5MarketTicks` | Soft — returns `[]` | **No** — global | Takes 1000 global rows |
| `getMyLatestSignals` | `labSignalSnapshots` | Soft — returns `[]` | Yes — `by_userId_createdAt` | `.take(8)` — bounded |
| `getMyLatestRealSignals` | `labSignalSnapshots` | Soft — returns `[]` | Yes | `.take(100)` then filter — acceptable |
| `getMySignalReportSnapshots` | `labSignalSnapshots` | Soft — returns `[]` | Yes | `.take(50)` — bounded |
| `getMyOpenPositions` | `mt5OpenPositions` | Soft — returns `[]` | Yes — `by_userId` | `collect()` then `resolveLocalOpenPositions` — positions grow unboundedly |
| `getMyMt5ReadOnlySummary` | `mt5AccountSnapshots`, `mt5OpenPositions`, `monitoringStatus`, `governanceState` | Soft — returns `null` | Yes | Multiple `collect()` calls within single query; acceptable now but watch as data grows |
| `getMyProtectionEvents` | `protectionEvents` | Soft — returns `[]` | Yes — `by_userId` | `collect()` then sort + slice 15 |
| `getMyGovernanceState` | `governanceState` | Soft — returns `null` | Yes | `.unique()` — correct |
| `getMyCommitteeReports` | `committeeReports` | Soft — returns `[]` | Yes — `by_userId` | `collect()` then sort + slice 20 |
| `getMyMonitoringStatus` | `monitoringStatus` | Soft — returns `[]` | Yes — `by_userId` | `collect()` then sort |
| `getMyAuditEvents` | `auditEvents` | Soft — returns `[]` | Yes — `by_userId` | `collect()` then sort + slice 25 |
| `getMyMt5SymbolsWithSettings` | `mt5Symbols`, `userSymbolSettings` | Soft — returns `[]` | Partial — symbols catalog is global; settings scoped to user | `.take(25_000)` on symbol catalog — large; acceptable for MT5 symbol counts but watch memory |
| `getMyEnabledLabSymbols` | `userSymbolSettings`, `mt5Symbols` | Soft — returns `[]` | Yes for settings; global for symbols | Same `.take(25_000)` pattern |
| `getMyActiveMt5Positions` | `mt5OpenPositions` | Soft — returns `[]` | Yes | `collect()` then filter + resolve |
| `getMyTradeHistoryDeals` | `mt5TradeHistoryDeals` | Soft — returns `[]` | Yes — `by_userId_time` | `.take(300)` then filter — fine |
| `getMyRealMt5ReportSummary` | `mt5OpenPositions`, `mt5TradeHistoryDeals` | Soft — returns `null` | Yes | Multiple `collect()` + `.take(300)` |

### 3.2 `mt5Bridge.ts` (queries)

| Query | Auth | userId scoped | Notes |
|-------|------|---------------|-------|
| `getMt5BridgeConnectionStatus` | None — public | N/A | Returns static stub data; no DB read; safe |
| `previewReadOnlyAccountSnapshotStub` | None — public | N/A | Returns static example; no DB read; safe |
| `previewReadOnlyMarketTicksStub` | None — public | N/A | Returns static example; safe |
| `previewReadOnlyOpenPositionsStub` | None — public | N/A | Returns static example; safe |
| `getLatestCandleFreshness` | Yes — `requireIdentifiedUser` throws | Yes — `by_userId_symbol_timeframe` | Nested loops (symbols × timeframes) with indexed queries; efficient |

### 3.3 `technicalIndicators.ts` (queries)

| Query | Auth | userId scoped | Notes |
|-------|------|---------------|-------|
| `getMyLatestTechnicalIndicators` | Soft — returns `[]` | Yes — `by_userId_createdAt` | `.take(400)` then deduplicate in memory |
| `getIndicatorsForSymbol` | Soft — returns `[]` | **No** — `by_symbol_timeframe` (global, cross-user) | Any user can read any other user's indicator snapshots for a given symbol — **isolation gap** |
| `computeIndicatorsForSymbol` | Soft — returns `{status:"unauthenticated"}` | Yes — `by_userId_symbol_timeframe` | On-demand compute; no DB write |
| `getIndicatorReadiness` | Soft — returns `null` | Yes — `by_userId_createdAt`, `by_userId` | `.take(max(combos×3, 120))` — bounded |

### 3.4 `health.ts` (query)

| Query | Auth | Notes |
|-------|------|-------|
| `status` | None — public | Returns `ok`, `authenticated`, `subject`, `email`, `timestamp` — exposes `subject` (Clerk userId) and `email` in response body. Acceptable for a health endpoint only if not publicly indexed |

### 3.5 `testEvents.ts` (queries)

| Query | Auth | userId scoped | Notes |
|-------|------|---------------|-------|
| `listTestEvents` | Yes — throws | Yes — `by_user` | `collect()` then sort — fine for test data |
| `latestTestEvent` | Yes — throws | Yes | `collect()` then reduce — fine |

---

## 4. API Routes Audit

| Route | Method | Clerk auth | Convex auth | Input validated | userId enforced | Notes |
|-------|--------|-----------|-------------|-----------------|-----------------|-------|
| `GET /api/mt5-readonly/connection-status` | GET | **None** | None | N/A | **No** | Pure proxy to local MT5 service; no user data; no auth needed for connection status |
| `POST /api/mt5-readonly/connect` | POST | **None** | None | Partial — body parsed, errors caught | **No** | Forwards raw JSON body to MT5 service; no Clerk auth. MT5 credentials (login, password, server) may be in the body — these are proxied without session validation |
| `GET /api/mt5-readonly/snapshot` | GET | **None** | None | N/A | **No** | Proxy only; result returned to caller; no Convex write triggered from this route |
| `GET /api/mt5-readonly/symbols` | GET | **None** | None | Query params forwarded | **No** | Proxy only; no Convex write |
| `GET /api/mt5-readonly/history-deals` | GET | **None** | None | `days` and `symbol` params forwarded | **No** | Proxy only; no Convex write |
| `GET /api/mt5-readonly/candles` | GET | **Yes** — `auth()` from `@clerk/nextjs/server` | **Yes** — `getToken({template:"convex"})` + `ConvexHttpClient.setAuth(token)` | Query params forwarded; candle array validated in Convex mutation | Yes — token binds to Clerk subject which becomes Convex userId | Only route with full auth chain; persistence is best-effort (returns raw data even if Convex write fails) |
| `POST /api/lab/analyze-preview` | POST | **Yes** — `auth()` + `getToken` | **Yes** — `ConvexHttpClient.setAuth(token)` | Body validated: symbol, stopPoints, riskUsd, timeframe, candleCount | Yes — token enforced; 401 returned if no token | Read-only analysis; no DB writes from this route |

**Critical observations:**
- `/api/mt5-readonly/connect` accepts POST without any Clerk session check. If this endpoint is reachable from a browser, any unauthenticated request can attempt to connect the local MT5 service with arbitrary credentials.
- Five of seven routes have no authentication — acceptable for pure proxy routes that only read from a local service, but should be documented as deliberate and traffic should be limited to localhost in production.
- The hardcoded Clerk issuer domain `https://national-ant-59.clerk.accounts.dev` in `candles/route.ts` (line 139) must be updated before deploying to a production Clerk app.

---

## 5. Clerk User Isolation Assessment

### How userId is derived

All Convex functions obtain the user identity via `ctx.auth.getUserIdentity()`, which returns the JWT claims validated by Convex's auth layer. The `subject` field of the identity (Clerk's `user_id`) is used as the `userId` string stored in all user-scoped tables.

**Auth configuration (`convex/auth.config.ts`):**
```
providers: [{ domain: process.env.CLERK_FRONTEND_API_URL!, applicationID: "convex" }]
```
Convex validates the JWT signature against Clerk's JWKS endpoint automatically. `identity.subject` = Clerk user ID.

**API route auth (`candles/route.ts`, `analyze-preview/route.ts`):**  
`auth()` from `@clerk/nextjs/server` reads the session from the incoming Next.js request (cookies/headers). `getToken({ template: "convex" })` mints a JWT with `aud: "convex"`. This token is passed to `ConvexHttpClient.setAuth(token)`, which means the Convex mutation receives the same identity as a browser-side call would.

### Consistency assessment

| Pattern | Consistency | Risk |
|---------|-------------|------|
| Mutations in `mt5Bridge.ts` | Consistent — all use `requireIdentifiedUser(identity)` which throws `ConvexError` on missing identity | Low |
| Mutations in `technicalIndicators.ts` | Consistent — `if (!identity) throw new ConvexError(AUTH_MSG)` | Low |
| Mutations in `coreSeed.ts`, `testEvents.ts` | Consistent — throws on missing identity | Low |
| Queries in `coreQueries.ts` | **Soft auth** — returns `null`/`[]` instead of throwing when not authenticated. This is intentional defensive coding but means an unauthenticated caller silently gets empty data rather than an explicit auth error | Low severity; acceptable |
| `health.ts` query | No auth; returns subject+email in response | Low for internal use; medium if exposed publicly |
| `getIndicatorsForSymbol` query | No userId scope — `by_symbol_timeframe` index is cross-user | **Medium** — any authenticated user can read another user's indicator snapshots by guessing/knowing a symbol name |
| `getLatestMarketTicks` / `getLatestRealMt5MarketTicks` | No userId — tick table has no userId column | Acceptable — tick data is market-public data, not user-private |
| `mt5Symbols` table | No userId — shared catalog | Acceptable — symbol metadata is not user-private |

### Cross-user data exposure risks

1. `getIndicatorsForSymbol` uses `by_symbol_timeframe` with no userId filter. An authenticated user querying `symbol="EURUSD"` receives indicator rows belonging to any user who computed indicators for EURUSD.
2. `mt5MarketTicks` has no userId column — any mutation by any user writes ticks that any other user's query can see. This is by design (market data is public) but should be documented explicitly.
3. `mt5Symbols` is a shared catalog — one user's sync run patches symbol properties globally, affecting all users' symbol display.

---

## 6. Index Coverage Assessment

### Well-indexed operations

| Operation | Index used | Assessment |
|-----------|-----------|------------|
| Account snapshot lookup | `by_userId_capturedAt` / `by_userId` | Good |
| Candle dedup | `by_userId_symbol_timeframe_time` | Excellent — 4-field compound key |
| Trade history dedup | `by_userId_dealTicket` | Good |
| MonitoringStatus upsert | `by_userId_service` | Good — compound upsert pattern |
| Governance lookup | `by_userId` + `.unique()` | Good |
| Symbol catalog fetch | `by_source_capturedAt` | Good |
| Candle freshness query | `by_userId_symbol_timeframe` + `.order("desc").first()` | Good |
| User symbol settings | `by_userId_symbol` | Good |

### collect() usage — unbounded scan risk

| Location | Table | Bounded? | Risk |
|----------|-------|----------|------|
| `clearDemoMt5ReadOnlyData` (mt5Bridge) | 6 tables | No — full table scan | High for prod; dev-only gate via env var |
| `getMyLatestAccountSnapshot` (coreQueries) | `mt5AccountSnapshots` | Per-user via index, but no row limit | Medium — grows per sync cycle |
| `getMyOpenPositions` (coreQueries) | `mt5OpenPositions` | Per-user via index, no row limit | Medium — old position rows accumulate |
| `getMyMt5ReadOnlySummary` (coreQueries) | `mt5AccountSnapshots`, `mt5OpenPositions`, `monitoringStatus` | Per-user, no row limits | Medium — three collect() calls per query |
| `getMyProtectionEvents` (coreQueries) | `protectionEvents` | Per-user, no row limit | Low-medium |
| `getMyCommitteeReports` (coreQueries) | `committeeReports` | Per-user, no row limit | Low |
| `getMyMonitoringStatus` (coreQueries) | `monitoringStatus` | Per-user, no row limit | Low |
| `getMyAuditEvents` (coreQueries) | `auditEvents` | Per-user, no row limit | Medium — audit events are high frequency |
| `getMyActiveMt5Positions` (coreQueries) | `mt5OpenPositions` | Per-user, no row limit | Medium |
| `listTestEvents` (testEvents) | `testEvents` | Per-user, no row limit | Low |
| `getIndicatorsForSymbol` (technicalIndicators) | `technicalIndicatorSnapshots` | Per-symbol (cross-user), no row limit | Medium |

### Large `.take()` calls

| Location | Limit | Assessment |
|----------|-------|-----------|
| `getMyMt5SymbolsWithSettings` | 25,000 × 2 sources | High memory for large MT5 symbol sets; acceptable for typical broker catalogs (< 5,000 symbols) |
| `getMyEnabledLabSymbols` | 25,000 × 2 | Same |
| `computeTechnicalIndicatorsForEnabledSymbols` | 25,000 for symbol catalog | Same |

---

## 7. Missing Tables for Future Features

| Future Feature | Required Table | Recommended fields | Notes |
|----------------|----------------|--------------------|-------|
| Decision journal | `decisionJournalEntries` | userId, signalId (optional ref), symbol, timeframe, decision (enter/skip/exit), reason, outcome, profitUsd, emotionTag, createdAt, updatedAt | Links to `labSignalSnapshots` and `committeeReports`; userId-scoped |
| Notification settings | `notificationSettings` | userId, channel (email/push/webhook), eventType, enabled, minSeverity, webhookUrl (encrypted), updatedAt | Per-user per-channel; index `by_userId`, `by_userId_channel` |
| System health logs | `systemHealthLogs` | service, status, latencyMs, errorCode, message, checkedAt, source | No userId — system-level; index `by_service_checkedAt`; distinct from `monitoringStatus` which is per-user |
| OKX market snapshots | `okxMarketSnapshots` | symbol, bidPrice, askPrice, lastPrice, volume24h, openInterest, fundingRate, capturedAt, source, syncRunId | No userId — market data is public; index `by_symbol_capturedAt`; mirror the `mt5MarketTicks` pattern |
| OKX candles | `okxCandles` | symbol, timeframe, time, open, high, low, close, volume, source, syncRunId, capturedAt | Index `by_symbol_timeframe_time` and `by_source_capturedAt` |
| User feature flags / permissions | `userFeatureFlags` | userId, feature (string), enabled, grantedBy, grantedAt, expiresAt (optional), notes | Index `by_userId`, `by_userId_feature`; enables per-user rollout and permission gating beyond the binary role field in `users` |

**Notable:** The existing `users.role` field is a free string. Structured feature flags in a separate table are preferable for granular, auditable permission management.

---

## 8. Governance & Execution Guard Assessment

### Current governance model

All mutations that write live MT5 data call `enforceGovernanceReadOnly(ctx, userId, now)`, which upserts `governanceState` with:
```
tradingEnabled: false
readOnly: true
maxDailyTrades: 0
maxRiskUsd: 0
```

This is re-enforced on **every sync call**, meaning even if a row were manually patched to `tradingEnabled: true`, the next sync call would revert it.

### Strengths

- The safety contract comment at the top of `mt5Bridge.ts` is clear and actionable.
- No mutation in the codebase calls any trade execution function; the codebase is consistently read-only at the Convex layer.
- `clearDemoMt5ReadOnlyData` is gated behind an environment variable — it cannot run in production without an explicit env change.
- Chunked mutation size caps (`MAX_SYMBOLS_PER_MUTATION = 200`, `MAX_DEALS_PER_MUTATION = 200`, `MAX_CANDLES_PER_MUTATION = 1000`) prevent oversized payloads.
- OHLC validation in `syncReadOnlyCandlesFromLocalService` is thorough: price > 0, high >= low, open/close within high/low, future candle rejection with broker clock skew tolerance.

### Gaps

1. **No governance check before reading**: Queries do not verify that `tradingEnabled === false` before returning data. This is by design for a read-only system, but means a compromised governance row would not be detected by queries.
2. **Governance is not cryptographically locked**: Any mutation with write access to `governanceState` could theoretically set `tradingEnabled: true`. There is no immutable log of governance changes (though `auditEvents` captures sync events, governance changes themselves are not explicitly audited with a dedicated `governance_state_changed` audit event).
3. **`demoSyncReadOnlySnapshotsFromMt5Stub` is publicly callable**: Any authenticated user can run this mutation, inserting stub demo data into their account. This is benign but should be restricted to dev environments.
4. **`seedCoreDemoData` has no environment guard**: Unlike `clearDemoMt5ReadOnlyData`, the seed mutation has no `ALLOW_DEV_SEED` gate. Any authenticated user can re-seed demo data in production.
5. **`/api/mt5-readonly/connect` has no auth**: A POST to this endpoint with arbitrary MT5 credentials is forwarded to the local MT5 service without a Clerk session check.

---

## 9. Risk Items

| ID | Severity | Area | Description |
|----|----------|------|-------------|
| R-01 | **High** | API Auth | `POST /api/mt5-readonly/connect` has no Clerk authentication. Any unauthenticated HTTP client on the same network can attempt MT5 connection with arbitrary broker credentials. |
| R-02 | **Medium** | Data Isolation | `getIndicatorsForSymbol` (technicalIndicators) uses `by_symbol_timeframe` with no userId filter — authenticated users can read other users' computed indicator snapshots. |
| R-03 | **Medium** | Unbounded Growth | `mt5AccountSnapshots`, `mt5OpenPositions`, `auditEvents`, `technicalIndicatorSnapshots`, `mt5Candles` have no TTL, archival strategy, or row cap. These tables will grow without bound as sync cycles accumulate. |
| R-04 | **Medium** | Dev Cleanup | `clearDemoMt5ReadOnlyData` uses `collect()` on 6 full tables. If run in a large dataset (even accidentally in staging), this will be extremely slow and consume significant function execution time. The env-var guard is present but not deployment-environment aware. |
| R-05 | **Medium** | Seed in Prod | `seedCoreDemoData` has no environment guard. Any authenticated user can invoke it in production, inserting demo positions, signals, and committee reports into their account. |
| R-06 | **Low-Medium** | Cross-user Symbol Catalog | `mt5Symbols` has no userId. A sync run from one user's browser session patches symbol catalog data for all users. For a single-user or single-broker deployment this is fine, but breaks isolation for multi-user deployments with different brokers. |
| R-07 | **Low-Medium** | Hardcoded Clerk Domain | `src/app/api/mt5-readonly/candles/route.ts` line 139 hardcodes `https://national-ant-59.clerk.accounts.dev` as the expected Clerk issuer. This must be replaced with an environment variable before deploying to a different Clerk app. |
| R-08 | **Low** | Governance Audit Gap | Governance state changes are not explicitly audit-logged with a `governance_state_changed` action. Only sync-level events are logged, making it harder to reconstruct when and why governance settings changed. |
| R-09 | **Low** | `health.ts` Public Exposure | `health.ts` query returns `subject` (Clerk userId) and `email` without authentication. Acceptable as a backend health check but should not be publicly indexed or cached. |
| R-10 | **Low** | `committeeReports.signalId` Weak Ref | `signalId` is `v.optional(v.id("labSignalSnapshots"))` — Convex does not enforce foreign key constraints. If a signal snapshot is deleted, orphaned committee reports remain with a stale `signalId`. |
| R-11 | **Low** | Missing `.env.local.example` | No `.env.local.example` file exists in the repository root. New developers have no documented list of required environment variables, increasing misconfiguration risk. |
| R-12 | **Low** | `monitoringStatus` Duplicate in Seed | `coreSeed.ts` uses `ctx.db.insert("monitoringStatus", ...)` directly instead of `_upsertMonitoringStatus`. Repeated seed calls create duplicate monitoring rows for the same (userId, service) pair. |

---

## 10. Recommendations (plan only — no changes made)

### Priority 1 — Security

1. **Add Clerk auth to `/api/mt5-readonly/connect`**: Wrap the handler with `auth()` from `@clerk/nextjs/server` and return 401 if the session is missing. This prevents unauthenticated MT5 connection attempts.

2. **Fix `getIndicatorsForSymbol` user isolation**: Change the query to use `by_userId_symbol_timeframe` index with `q.eq("userId", userId)`. Add a `userId` arg or derive it from `ctx.auth.getUserIdentity()`. This closes the cross-user data leak (R-02).

3. **Replace hardcoded Clerk issuer domain**: Move `https://national-ant-59.clerk.accounts.dev` in `candles/route.ts` to an environment variable (e.g., `NEXT_PUBLIC_CLERK_FRONTEND_API_URL`) and read it at runtime.

### Priority 2 — Data Hygiene

4. **Guard `seedCoreDemoData` with an env variable**: Add a check for `process.env.ALLOW_DEV_SEED === "true"` mirroring the pattern in `clearDemoMt5ReadOnlyData`. This prevents accidental demo data injection in production.

5. **Add row-cap or TTL strategy for high-frequency tables**: For `mt5AccountSnapshots`, `mt5OpenPositions`, `auditEvents`, and `technicalIndicatorSnapshots`, implement a sliding-window approach: during each sync, count existing rows per user and delete the oldest N beyond a configurable threshold (e.g., keep last 1,000 candle snapshots per user/symbol/timeframe, last 500 audit events). Use indexed queries for these cleanup passes — never `collect()`.

6. **Replace direct insert in `seedCoreDemoData` for monitoringStatus**: Use `_upsertMonitoringStatus` helper to avoid duplicate monitoring rows on repeated seed invocations (R-12).

### Priority 3 — Governance & Audit

7. **Add explicit governance audit events**: Whenever `governanceState` is patched or inserted, emit a dedicated `governance_state_changed` audit event capturing the before and after values of `tradingEnabled`, `readOnly`, and `mode`. This creates an immutable change trail.

8. **Add environment-aware guard to `clearDemoMt5ReadOnlyData`**: In addition to the env-var check, add a comment warning that this mutation should be excluded from production Convex deployments entirely via a separate dev-only module, rather than relying on an env var that could be accidentally set.

### Priority 4 — Schema & Indexes

9. **Add missing tables for planned features**: Create the six tables identified in Section 7:
   - `decisionJournalEntries` (userId-scoped, refs labSignalSnapshots)
   - `notificationSettings` (userId-scoped, per channel/event)
   - `systemHealthLogs` (system-level, no userId)
   - `okxMarketSnapshots` (market data, no userId)
   - `okxCandles` (market data, no userId)
   - `userFeatureFlags` (userId-scoped, replaces string role for granular gating)

10. **Consider a compound index for `protectionEvents` by `(userId, createdAt)`**: The current `collect()` + sort pattern in `getMyProtectionEvents` will degrade as protection events accumulate. An `by_userId_createdAt` index would allow `.order("desc").take(N)` directly.

11. **Consider a compound index for `committeeReports` by `(userId, createdAt)`**: Same pattern as above — replace `collect()` + sort with an index-ordered `.take(20)`.

12. **Consider a compound index for `auditEvents` by `(userId, createdAt)`**: Current `collect()` + sort is used in `getMyAuditEvents`. A `by_userId_createdAt` index would make this O(log N) instead of O(N).

### Priority 5 — Developer Experience

13. **Create `.env.local.example`**: Document all required environment variables:
    - `NEXT_PUBLIC_CONVEX_URL`
    - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
    - `CLERK_SECRET_KEY`
    - `CLERK_FRONTEND_API_URL` (used in `convex/auth.config.ts`)
    - `MT5_SERVICE_URL` (defaults to `http://127.0.0.1:8010`)
    - `ALLOW_DEV_CLEANUP` (dev only, default: not set)
    - `ALLOW_DEV_SEED` (dev only, once added per Rec-4)

14. **Multi-user broker isolation strategy decision**: For `mt5Symbols` and `mt5MarketTicks`, document explicitly whether the system is designed for single-user deployment (acceptable as-is) or multi-user/multi-broker deployment (requires adding userId to both tables and updating all related queries and mutations accordingly).
