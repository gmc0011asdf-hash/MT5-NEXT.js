# TASKS — نظام الملك الهندسي للتداول العالمي

> Format: Stage | Task | Files | Risk | Test | Manual check | Done criteria  
> Updated: 2026-05-17 (تحديث ما بعد المراجعة الأمنية - بدء مرحلة Fix-0)

---

## Security & Fixes Roadmap (مراحل الإصلاح الأمنية والتنظيمية)

بناءً على التقرير التقني الشامل، تم إيقاف تقدم خارطة الطريق مؤقتاً لتنفيذ الإصلاحات التالية:

### Fix-0 — Environment & Context Stabilization
- [✅] **إنشاء `.env.local.example`**: توثيق المتغيرات المطلوبة.
- [✅] **تحديث التوثيق**: تحديث `PROJECT_CONTEXT.md` و `TASKS.md`.

### Fix-1 — Security Hotfixes
- [⏳] **مصادقة البروكسي**: إضافة `Clerk Auth` لمسارات `api/mt5-readonly`.
- [⏳] **عزل البيانات**: تأمين `userId` filtering في جميع جداول Convex و Queries.

### Fix-2 — Database Maintenance
- [⏳] **نمو غير محدود**: إضافة Convex Cron Jobs لتنظيف `mt5AccountSnapshots` و `mt5MarketTicks`.

### Fix-3 — Frontend Polish
- [⏳] **استكمال النواقص**: إكمال `Decision Journal Placeholder` و `OKX Placeholder`.
- [⏳] **RTL Fixes**: حل المشاكل البصرية الطفيفة في الواجهة.

---

## Stage 0 — Stabilization and Baseline

### T0-01 — Move MT5 service URL to env var

| Field | Detail |
|---|---|
| Stage | 0 |
| Task | Replace hardcoded `http://127.0.0.1:8010` with `process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010"` |
| Files | `src/app/api/mt5-readonly/connection-status/route.ts`, `connect/route.ts`, `snapshot/route.ts`, `symbols/route.ts`, `history-deals/route.ts`, `candles/route.ts` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit && pnpm build` |
| Manual | Set `MT5_SERVICE_URL=http://127.0.0.1:8010` in `.env.local`, verify /dashboard loads |
| Done | All 6 route files use env var. Build passes. |

### T0-02 — Gate dev pages from production navigation

| Field | Detail |
|---|---|
| Stage | 0 |
| Task | Hide `/convex-core` and `/convex-test` from NAV_GROUPS when `NODE_ENV !== "development"` |
| Files | `src/lib/constants/navigation.ts`, `src/components/layout/AppSidebar.tsx` |
| Risk | Low |
| Test | `pnpm build` |
| Manual | In production build, open /dashboard — confirm convex-core and convex-test do not appear in sidebar |
| Done | Sidebar shows 3 system items in prod (Convex Core, Convex Test hidden). |

### T0-03 — Create .env.local.example

| Field | Detail |
|---|---|
| Stage | 0 |
| Task | Create `.env.local.example` documenting all required variables |
| Files | `.env.local.example` (new file) |
| Risk | None |
| Test | File exists and is committed |
| Manual | `cat .env.local.example` shows all keys without real values |
| Done | File present, all variables documented, no secrets committed. |

### T0-04 — Standardize API route timeouts

| Field | Detail |
|---|---|
| Stage | 0 |
| Task | Set all 6 Next.js API proxy routes to uniform 8-second AbortController timeout |
| Files | All 6 `src/app/api/mt5-readonly/*/route.ts` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Disconnect Python service, call `/api/mt5-readonly/connection-status`, confirm 503 within 9 seconds |
| Done | All routes use 8000ms timeout. No route uses hardcoded 5000. |

### T0-05 — Document run commands in README

| Field | Detail |
|---|---|
| Stage | 0 |
| Task | Update README.md with complete step-by-step run instructions for both Next.js and Python service |
| Files | `README.md` |
| Risk | None |
| Test | Manual read |
| Manual | A new developer can follow README to run the full stack |
| Done | README contains: Python setup, Next.js setup, env var setup, run commands, health check verification. |

---

## Stage 1 — Real Data Truthfulness

### T1-01 — Label mock market stream components

| Field | Detail |
|---|---|
| Stage | 1 |
| Task | Add `[تجريبي]` badge to LiveMarketCard, LiveMarketTicker, MiniMarketSparkline, MarketPulseIndicator when using mock data |
| Files | `src/components/dashboard/LiveMarketCard.tsx`, `LiveMarketTicker.tsx`, `MiniMarketSparkline.tsx`, `MarketPulseIndicator.tsx` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit && pnpm build` |
| Manual | Open /dashboard — all mock price widgets show تجريبي badge |
| Done | No mock price appears without clear label. Real data removes the badge when available. |

### T1-02 — Fix DashboardActivitySection empty state

| Field | Detail |
|---|---|
| Stage | 1 |
| Task | Replace mock signal constants with real `getMyLatestRealSignals()` query; show honest empty state if no signals |
| Files | `src/components/dashboard/DashboardActivitySection.tsx`, `src/lib/constants/mock-data.ts` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Open /dashboard with no real signals in Convex — see "لا توجد إشارات حقيقية بعد" message |
| Done | No hardcoded mock signal data rendered. Empty state is honest. |

### T1-03 — Fix monitoring snapshot provider fallback

| Field | Detail |
|---|---|
| Stage | 1 |
| Task | Replace fake "ok" monitoring fallback values in `monitoring-snapshot-provider.tsx` with loading skeleton |
| Files | `src/components/providers/monitoring-snapshot-provider.tsx` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Open /monitoring before Convex loads — see skeleton, not fake green status |
| Done | No mock monitoring constants shown as real status. |

### T1-04 — Three-state empty state differentiation

| Field | Detail |
|---|---|
| Stage | 1 |
| Task | Add helper component `<Mt5EmptyState />` that accepts `reason: "disconnected" | "not_synced" | "no_data"` and renders appropriate Arabic message |
| Files | `src/components/common/Mt5EmptyState.tsx` (new), affected page files |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Test each state manually by toggling MT5 connection / clearing Convex data |
| Done | All pages show correct empty state for each scenario. |

---

## Stage 2 — MT5 Agent Hardening

### T2-01 — Improve /health endpoint

| Field | Detail |
|---|---|
| Stage | 2 |
| Task | Add `uptime_seconds`, `build_version`, `last_successful_call_at`, `symbols_configured` to GET /health response |
| Files | `mt5_readonly_service/main.py` |
| Risk | Low |
| Test | `python -m py_compile main.py` |
| Manual | GET http://127.0.0.1:8010/health — see all new fields in JSON response |
| Done | Health response includes uptime, version string, last call time, symbols list. |

### T2-02 — Validate terminal_path before MT5 init

| Field | Detail |
|---|---|
| Stage | 2 |
| Task | In POST /connect, check `os.path.exists(terminal_path)` before calling `mt5.initialize(path=...)`. Return 400 with Arabic error if path invalid. |
| Files | `mt5_readonly_service/main.py` |
| Risk | Low |
| Test | `python -m py_compile main.py` |
| Manual | POST /connect with fake terminal_path — receive `{"error": "مسار المنصة غير موجود"}` 400 |
| Done | Clear error returned for invalid paths. No Python exception. |

### T2-03 — Market closed state annotation

| Field | Detail |
|---|---|
| Stage | 2 |
| Task | In `/readonly/ticks` and `/readonly/snapshot`, check tick timestamp age. If last tick > 4h ago, add `"market_closed": true` flag to response |
| Files | `mt5_readonly_service/main.py` |
| Risk | Low |
| Test | `python -m py_compile main.py` |
| Manual | Connect during weekend or after market hours — response includes `market_closed: true` |
| Done | All tick responses include `market_closed` boolean. UI can display "السوق مغلق" when true. |

### T2-04 — Per-symbol error handling in /readonly/symbols

| Field | Detail |
|---|---|
| Stage | 2 |
| Task | If a symbol in request is not in Market Watch, return `{"symbol": "X", "error": "غير موجود في Market Watch"}` for that symbol rather than failing entire request |
| Files | `mt5_readonly_service/main.py` |
| Risk | Low |
| Test | `python -m py_compile main.py` |
| Manual | Request symbol "FAKEUSDT" — partial success response with error for that symbol only |
| Done | Other symbols in same request succeed. Only missing symbol has error field. |

### T2-05 — Env var for service URL in Next.js routes

| Field | Detail |
|---|---|
| Stage | 2 |
| Task | All 6 Next.js API routes read `process.env.MT5_SERVICE_URL` (this is T0-01 — verify it was completed) |
| Files | All 6 `src/app/api/mt5-readonly/*/route.ts` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit && pnpm build` |
| Manual | Verify `.env.local.example` includes `MT5_SERVICE_URL` |
| Done | Zero hardcoded IP/port strings in route files. |

---

## Stage 3 — Convex Persistence Foundation

### T3-01 — Pagination on large table queries

| Field | Detail |
|---|---|
| Stage | 3 |
| Task | Replace `.collect()` with `.paginate()` on `mt5Candles`, `mt5MarketTicks`, `mt5TradeHistoryDeals`, `auditEvents` queries. Add cursor-based pagination to page components. |
| Files | `convex/coreQueries.ts`, `convex/mt5Bridge.ts`, affected page components |
| Risk | Medium — API shape changes |
| Test | `pnpm exec tsc --noEmit && pnpm exec convex codegen && pnpm build` |
| Manual | Load /reports with 1000+ deals — page loads without timeout |
| Done | No `.collect()` on tables with potentially >200 rows. All queries paginated. |

### T3-02 — Candle deduplication on write

| Field | Detail |
|---|---|
| Stage | 3 |
| Task | In `syncMt5Candles` mutation, check for existing `(userId, symbol, timeframe, time)` before inserting. Update if OHLC differs (history revision). Skip if identical. |
| Files | `convex/mt5Bridge.ts` |
| Risk | Medium |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Sync same candles twice — Convex candle count does not increase on second sync |
| Done | Duplicate candles are skipped. OHLC revisions are updated and logged. |

### T3-03 — Market ticks TTL cleanup

| Field | Detail |
|---|---|
| Stage | 3 |
| Task | Create Convex scheduled action (cron every 6h) to delete `mt5MarketTicks` older than 7 days per user |
| Files | `convex/mt5Bridge.ts` or new `convex/cleanup.ts` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Check tick table row count after 7+ days of use — old rows purged |
| Done | Scheduled action runs, old ticks deleted, recent ticks preserved. |

### T3-04 — Monitoring status upsert

| Field | Detail |
|---|---|
| Stage | 3 |
| Task | `monitoringStatus` writes should upsert by `(userId, component)` not insert new rows every sync |
| Files | `convex/mt5Bridge.ts` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Sync monitoring 10 times — monitoringStatus table has exactly N_components rows per user |
| Done | One row per component per user. No row accumulation. |

### T3-05 — Trade history deduplication

| Field | Detail |
|---|---|
| Stage | 3 |
| Task | Check by `(userId, ticket)` before inserting new trade history deal. Skip duplicates. |
| Files | `convex/mt5Bridge.ts` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Sync deals twice — deal count does not increase |
| Done | No duplicate tickets in mt5TradeHistoryDeals per user. |

### T3-06 — Scheduled auto-sync action

| Field | Detail |
|---|---|
| Stage | 3 |
| Task | Create Convex action (not mutation) that calls the Next.js sync endpoint every 60 seconds for active users. Use `cronJobs` if available in Convex version. |
| Files | `convex/crons.ts` (new), `convex/mt5Bridge.ts` |
| Risk | Medium |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Leave dashboard open for 5 minutes — data updates without manual sync button |
| Done | Account snapshot, ticks, positions auto-refresh without user action. |

---

## Stage 4 — Candle Persistence and Data Quality

### T4-01 — Last-synced tracking per symbol/timeframe

| Field | Detail |
|---|---|
| Stage | 4 |
| Task | Add `candleSyncState` table: `(userId, symbol, timeframe, lastSyncedTime, totalCandles)`. Update after each successful sync. Use to fetch only new candles. |
| Files | `convex/schema.ts`, `convex/mt5Bridge.ts` |
| Risk | Medium — schema change |
| Test | `pnpm exec tsc --noEmit && pnpm exec convex codegen` |
| Manual | Sync M15 EURUSD — check candleSyncState shows correct lastSyncedTime |
| Done | New table present. Candle sync only fetches candles newer than lastSyncedTime. |

### T4-02 — OHLC validation before insert

| Field | Detail |
|---|---|
| Stage | 4 |
| Task | In `syncMt5Candles`, validate each candle: `open > 0`, `high >= max(open,close)`, `low <= min(open,close)`, `volume >= 0`. Reject and log invalid candles to `auditEvents`. |
| Files | `convex/mt5Bridge.ts` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Inject malformed candle — audit log shows rejection, invalid candle not inserted |
| Done | All inserted candles pass OHLC validation. Invalid candles in audit log. |

### T4-03 — Candle freshness display

| Field | Detail |
|---|---|
| Stage | 4 |
| Task | On Lab page and any chart view, show "آخر شمعة: منذ X دقيقة" computed from newest candle timestamp. Warn with amber color if age > 2× timeframe. |
| Files | `src/app/(dashboard)/lab/page.tsx`, new freshness util in `src/lib/` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit && pnpm build` |
| Manual | Open Lab page — freshness label visible and updating. Stale candles show amber warning. |
| Done | Freshness label present. Stale state visually distinct from fresh. |

---

## Stage 5 — Technical Indicators Foundation

### T5-01 — Minimum candles guard

| Field | Detail |
|---|---|
| Stage | 5 |
| Task | Before computing any indicator, check candle count ≥ indicator minimum. Return `{computed: false, reason: "candles_insufficient", needed: N, available: M}` if not met. |
| Files | `convex/technicalIndicators.ts` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Compute indicators on symbol with only 10 candles — response shows computed: false |
| Done | No indicator computed on insufficient data. Clear reason returned. |

### T5-02 — Real candles source guard

| Field | Detail |
|---|---|
| Stage | 5 |
| Task | Refuse to compute indicators from candles where `source !== "mt5-local-readonly"`. Log attempt to auditEvents. |
| Files | `convex/technicalIndicators.ts` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Seed demo candles, attempt compute — blocked, audit event logged |
| Done | Indicators only computed from real MT5 candles. |

### T5-03 — Indicator freshness guard

| Field | Detail |
|---|---|
| Stage | 5 |
| Task | Skip recomputation if `technicalIndicatorSnapshots.computedAt` is newer than 1× timeframe duration. Return cached result with `cached: true` flag. |
| Files | `convex/technicalIndicators.ts` |
| Risk | Low |
| Test | `pnpm exec tsc --noEmit` |
| Manual | Call compute twice within 15 min on M15 — second call returns cached result |
| Done | No unnecessary recomputation. Cache flag present in response. |

### T5-04 — Bollinger Bands addition

| Field | Detail |
|---|---|
| Stage | 5 |
| Task | Add Bollinger Bands (20 period, 2 standard deviations) to `technicalIndicators.ts` computation and `technicalIndicatorSnapshots` schema |
| Files | `convex/technicalIndicators.ts`, `convex/schema.ts` |
| Risk | Medium — schema change |
| Test | `pnpm exec tsc --noEmit && pnpm exec convex codegen` |
| Manual | Compute indicators — response includes `bb_upper`, `bb_middle`, `bb_lower` |
| Done | BB values stored per snapshot. Schema updated. |

---

## Stages 6–14

> Tasks for Stages 6–14 will be detailed in a separate sprint planning document once Stages 0–5 are complete. This prevents planning ahead of validated foundations.

### Stage 6 Skeleton Tasks (for planning)
- T6-01: Implement swing high/low fractal detection
- T6-02: Support/resistance level clustering
- T6-03: BOS/CHoCH detection
- T6-04: Liquidity sweep detection
- T6-05: Multi-timeframe trend alignment check
- T6-06: Add mt5StructureSnapshots to schema

### Stage 7 Skeleton Tasks (for planning)
- T7-01: Spread filter implementation
- T7-02: Volatility extreme filter
- T7-03: Market closed detection integration
- T7-04: Max daily analysis count
- T7-05: Cooldown rule implementation
- T7-06: Data quality veto gate

### Stage 14 — LOCKED

> Stage 14 tasks are not listed. This stage requires explicit written approval from the project owner before any task is created or implemented. Creating task items here does not authorize implementation.
