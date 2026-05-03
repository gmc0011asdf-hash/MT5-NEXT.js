# SECURITY & QA REVIEW

**Project:** MT5-NEXT.js Trading Analysis System  
**Reviewed by:** Security / QA Teammate (automated audit)  
**Date:** 2026-05-02  
**Scope:** Read-only audit — no files were modified.

---

## 1. Clerk Authentication Enforcement

### Finding: PARTIAL — middleware.ts is MISSING

**Status: MEDIUM RISK**

No `src/middleware.ts` (or any equivalent Clerk middleware) file exists in the project. In a standard `@clerk/nextjs` setup, the middleware is responsible for:
- Protecting all non-public routes at the edge
- Redirecting unauthenticated users to `/sign-in`
- Propagating session tokens to API routes

Without middleware, route-level protection depends entirely on each individual API handler calling `auth()` explicitly.

**Routes that DO check auth (safe):**
- `src/app/api/lab/analyze-preview/route.ts` — calls `auth()` and returns HTTP 401 if `token` is null. Auth is enforced before any Convex query.
- `src/app/api/mt5-readonly/candles/route.ts` — calls `auth()` inside `persistCandlesToConvex()`. However, persistence is described as "best-effort"; if the user is unauthenticated, candle data is still returned (raw), persistence is just skipped silently.

**Routes that do NOT check auth (unauthenticated access possible):**
- `src/app/api/mt5-readonly/snapshot/route.ts` — no `auth()` call. Any anonymous caller can proxy to the local MT5 service and receive account snapshot data.
- `src/app/api/mt5-readonly/connect/route.ts` — no `auth()` call. Any caller can POST MT5 login credentials (login, password, server, terminal path) to the Python service and receive account data.
- `src/app/api/mt5-readonly/connection-status/route.ts` — no `auth()` call. Returns MT5 account info including login, balance, server, company.
- `src/app/api/mt5-readonly/history-deals/route.ts` — no `auth()` call. Returns closed trade history.
- `src/app/api/mt5-readonly/symbols/route.ts` — no `auth()` call. Returns symbol catalog.

**Summary:** 5 out of 7 API routes have no authentication check. An unauthenticated user with network access to the Next.js server can read all MT5 account data, trade history, and connection details.

---

## 2. Convex userId Isolation

### Finding: STRONG — All queries/mutations are userId-scoped

**Status: LOW RISK**

Every Convex query and mutation in both `convex/coreQueries.ts` and `convex/mt5Bridge.ts` enforces user identity before touching the database.

**Pattern in coreQueries.ts (`requireUserId`):**
```ts
const userId = await requireUserId(ctx);
if (!userId) return null; // or return []
```
This is applied consistently across all 18+ exported queries. Every `db.query()` call is then further filtered by `withIndex("by_userId", (q) => q.eq("userId", userId))`.

**Pattern in mt5Bridge.ts (`requireIdentifiedUser`):**
```ts
const identity = await ctx.auth.getUserIdentity();
const userId = requireIdentifiedUser(identity);
// throws ConvexError if identity is null
```
All 7 mutations in mt5Bridge.ts apply this guard.

**Notable difference:** `requireUserId` in coreQueries.ts returns `null` on failure (soft fail), while `requireIdentifiedUser` in mt5Bridge.ts throws a `ConvexError` (hard fail). The soft-fail path in coreQueries returns empty arrays/null to unauthenticated callers rather than an error, which is acceptable but slightly inconsistent with the harder fail in mutations.

**Market Ticks Cross-Tenant Leak (LOW):**
`getLatestMarketTicks` and `getLatestRealMt5MarketTicks` query `mt5MarketTicks` by `by_capturedAt` index (not by userId), returning up to 500/1000 rows across ALL users before filtering by source. The `mt5MarketTicks` table has no `userId` field in the schema — market tick data is global/shared across tenants by design. This is acceptable for market price data but should be documented.

---

## 3. Execution Guard Assessment

### Finding: STRONG — Multiple defense-in-depth layers

**Status: LOW RISK**

**Layer 1 — Python service (main.py):**
- `READ_ONLY_MODE: bool = True` is a module-level constant, hardcoded to `True`.
- `_enforce_read_only_policy()` is called at the start of every endpoint handler and raises `RuntimeError` if `READ_ONLY_MODE` is not `True`.
- `FORBIDDEN_MT5_FUNCTION_NAMES` documents the blocked functions: `order_send`, `order_close`, `order_modify`, `order_check`.
- Confirmed: none of these function names appear in the function body — only in the FORBIDDEN list and in comments.
- All MT5 API calls are read-only: `account_info`, `symbol_info_tick`, `positions_get`, `symbols_get`, `history_deals_get`, `copy_rates_from_pos`.

**Layer 2 — Convex governance (mt5Bridge.ts):**
- `enforceGovernanceReadOnly()` is called on every mutation, setting `tradingEnabled: false` and `readOnly: true` in the `governanceState` table.
- No mutation ever sets `tradingEnabled: true`.
- The schema allows `tradingEnabled: v.boolean()` but the codebase never writes `true`.

**Layer 3 — UI (AnalysisControlPanel.tsx):**
- The component has an "Analyze Opportunity" button that calls `/api/lab/analyze-preview` (POST).
- There is no "Execute Trade", "Place Order", or "Buy/Sell" button anywhere in the component.
- The response type is `AnalysisResult` which carries `readOnly: true` as a literal type — the server enforces this in the response.
- The route handler `analyze-preview/route.ts` never calls any MT5 execution function and never writes to the DB directly.

**Layer 4 — Safety contract comments:**
- `mt5Bridge.ts` has a documented SAFETY CONTRACT comment block at the top.
- `AGENT_RULES.md` explicitly forbids adding `order_send` before Stage 14 approval.
- `DEVELOPMENT_ROADMAP.md` stages 1–13 all have `order_send must NOT be called` checklist items.

**One Gap:** The `clearDemoMt5ReadOnlyData` mutation uses an unbounded `ctx.db.query(table).collect()` (line 1265) without a userId filter on some tables, then filters by `source`. While this only deletes demo seed rows and requires `ALLOW_DEV_CLEANUP=true`, it is an unbounded scan over full tables which could be expensive in production.

---

## 4. Secret Handling

### Finding: MEDIUM RISK — One hardcoded Clerk domain; .env.local present on disk

**Issues found:**

**4a. Hardcoded Clerk domain in production code:**
In `src/app/api/mt5-readonly/candles/route.ts`, line 139:
```ts
const convexExpectedDomain = "https://national-ant-59.clerk.accounts.dev";
```
This is a hardcoded Clerk frontend API domain used in the `?debugAuth=1` diagnostic path. While it is used only for diagnostic comparison (not for authentication), it:
- Leaks the actual Clerk subdomain in source code / version control.
- Would produce incorrect diagnostic messages if the Clerk app is ever changed or migrated.
- Should be replaced with `process.env.CLERK_FRONTEND_API_URL`.

**4b. `.env.local` exists on disk:**
The file `d:\Projects -Ahmed\MT5-NEXT.js-main\MT5-NEXT.js-main\.env.local` was found. This file was NOT read (per rules — no secret exposure). Verify that it is listed in `.gitignore` and has never been committed to version control.

**4c. `.env.local.example` is clean:**
The example file contains only placeholder values (`pk_test_your_key_here`, `sk_test_your_key_here`) and no real credentials. Good practice.

**4d. No other hardcoded secrets found:**
No `sk_live_`, `sk_test_`, `pk_live_`, hardcoded passwords, or API tokens were found in source files (excluding the domain item above).

**4e. MT5 service URL:**
All 7 API routes use `process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010"` — the env var override is available. The localhost fallback is safe for development.

---

## 5. Python Service Safety

### Finding: STRONG — READ_ONLY_MODE correctly enforced; FORBIDDEN functions absent

**Status: LOW RISK**

**Positive findings:**
- `READ_ONLY_MODE = True` is a module-level boolean constant (line 53). Not configurable via environment variable, which is intentional and prevents accidental toggle.
- `_enforce_read_only_policy()` raises `RuntimeError` immediately if `READ_ONLY_MODE is not True` — called at the top of every endpoint.
- Confirmed scan: `order_send`, `order_close`, `order_modify`, `order_check` do NOT appear in any function call in `main.py` — only in the FORBIDDEN list documentation and comments.
- All active MT5 function calls verified as read-only: `mt5.initialize()`, `mt5.account_info()`, `mt5.symbol_info_tick()`, `mt5.symbol_info()`, `mt5.symbol_select()`, `mt5.positions_get()`, `mt5.symbols_get()`, `mt5.history_deals_get()`, `mt5.copy_rates_from_pos()`.
- `mt5.shutdown()` is always called in `finally` blocks — no resource leaks.

**Concerns:**

**5a. No authentication on Python service endpoints:**
The FastAPI service (`main.py`) has no authentication layer. Any process on the local machine (or on the network if the port is exposed) can call `/connect`, `/readonly/snapshot`, etc. The Python service assumes it is only accessible from the local Next.js server. If `MT5_SERVICE_URL` is ever changed to a non-loopback address, this becomes a critical exposure.

**5b. `/connect` endpoint accepts MT5 credentials:**
The `POST /connect` endpoint accepts `login`, `password`, `server`, and `terminal_path` in plaintext JSON. These are MT5 account credentials. This endpoint is currently unprotected — any caller who can reach the Python service can attempt MT5 logins with arbitrary credentials.

**5c. No request size limit:**
FastAPI by default accepts large request bodies. No explicit body size limit is configured, which could allow DoS via oversized payloads.

---

## 6. API Route Authorization

### Finding: CRITICAL GAP — 5 of 7 routes have no auth check

**Status: HIGH RISK**

| Route | Auth Check | Risk |
|---|---|---|
| `GET /api/mt5-readonly/snapshot` | NONE | MT5 account data exposed |
| `POST /api/mt5-readonly/connect` | NONE | MT5 credentials can be proxied |
| `GET /api/mt5-readonly/connection-status` | NONE | Account login/balance exposed |
| `GET /api/mt5-readonly/history-deals` | NONE | Trade history exposed |
| `GET /api/mt5-readonly/symbols` | NONE | Symbol catalog exposed (low value) |
| `GET /api/mt5-readonly/candles` | Partial (persistence only) | Candle data returned even without auth |
| `POST /api/lab/analyze-preview` | YES — returns 401 | Correctly protected |

The missing middleware means there is no edge-level guard. In production, these routes must either:
1. Add `auth()` checks with explicit 401 responses, OR
2. Have a Clerk middleware configured to block unauthenticated access to `/api/*`.

---

## 7. Rate Limiting & Abuse Prevention

### Finding: NONE IMPLEMENTED

**Status: MEDIUM RISK**

No rate limiting was found at any layer:
- No middleware-level rate limiting in Next.js
- No rate limiting in the Python FastAPI service
- No Convex mutation rate guards (the `MAX_SYMBOLS_PER_MUTATION = 200` / `MAX_DEALS_PER_MUTATION = 200` / `MAX_CANDLES_PER_MUTATION = 1000` constants are payload size caps, not rate limits)
- No request frequency control on the `/api/lab/analyze-preview` route (which is the most compute-intensive — it calls Convex queries for each candidate timeframe in parallel)

**Attack scenarios in current state:**
- A caller could rapidly POST to `/api/lab/analyze-preview` to exhaust Convex read quota.
- A caller could POST thousands of candles/deals to the sync mutations, repeatedly.
- The Python service has no connection throttling.

**Mitigation present:** Convex has its own platform-level rate limits, but there are no application-level controls.

---

## 8. Multi-Tenant Isolation

### Finding: MOSTLY STRONG with one shared-table design note

**Status: LOW RISK**

**Properly isolated tables (userId required in every query):**
- `mt5AccountSnapshots` — always filtered by `userId`
- `mt5OpenPositions` — always filtered by `userId`
- `labSignalSnapshots` — always filtered by `userId`
- `committeeReports` — always filtered by `userId`
- `protectionEvents` — always filtered by `userId`
- `governanceState` — always filtered by `userId`
- `auditEvents` — always filtered by `userId`
- `monitoringStatus` — always filtered by `userId`
- `userSymbolSettings` — always filtered by `userId`
- `mt5TradeHistoryDeals` — always filtered by `userId`
- `mt5Candles` — always filtered by `userId`
- `technicalIndicatorSnapshots` — always filtered by `userId`

**Shared/global tables (no userId isolation — by design):**
- `mt5MarketTicks` — no `userId` field in the schema. Market price ticks are shared global data. `getLatestMarketTicks` queries by `by_capturedAt` and takes 500 rows globally. This is by design (market prices are not per-user), but the auth check at the top (`requireUserId`) still gates access to authenticated users.
- `mt5Symbols` — no `userId` field in the schema. Symbol catalog is shared. Same design rationale.

**Verdict:** User A cannot see User B's account snapshots, positions, signals, audit logs, or trade history. The only shared data is market prices and symbol catalogs, which is intentional.

---

## 9. Build & Test Commands

### Finding: NO TEST SUITE; build commands present but untested

**Status: MEDIUM RISK**

From `package.json`:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint"
}
```

**Observations:**
- No `test` script exists. There are no unit tests, integration tests, or end-to-end tests in the project.
- No `jest`, `vitest`, `playwright`, or `cypress` packages are in `dependencies` or `devDependencies`.
- The `lint` script runs `eslint` but does not specify a path/config — may fail silently or lint nothing.
- No `--no-verify` or dangerous skip flags were found in the scripts.
- No CI configuration files were found in the project root.

**Package versions:**
- `next: 16.2.4` — very recent (beyond typical training data). No known vulnerability info available for this exact version from this audit.
- `@clerk/nextjs: ^7.2.7` — current major.
- `convex: ^1.36.1` — current.
- `react: 19.2.4` / `react-dom: 19.2.4` — React 19 stable.
- `recharts: ^3.8.1` — charting library, no security implications.
- No known high-risk packages detected (no `serialize-javascript`, `lodash` old versions, etc.).

---

## 10. Vulnerability Summary Table

| # | Category | Finding | Severity | Location |
|---|---|---|---|---|
| V-01 | API Auth | 5 MT5-readonly routes have no `auth()` check | HIGH | `src/app/api/mt5-readonly/` |
| V-02 | Middleware | No Clerk middleware (`src/middleware.ts` missing) | HIGH | Project root |
| V-03 | Secret Leak | Hardcoded Clerk domain in source code | MEDIUM | `candles/route.ts:139` |
| V-04 | Rate Limiting | No rate limiting at any layer | MEDIUM | All API routes |
| V-05 | Python Auth | FastAPI service has no authentication | MEDIUM | `mt5_readonly_service/main.py` |
| V-06 | Candles Auth | Candle data returned to unauthenticated callers (persistence skipped) | MEDIUM | `mt5-readonly/candles/route.ts` |
| V-07 | Testing | No test suite exists | MEDIUM | `package.json` |
| V-08 | Unbounded scan | `clearDemoMt5ReadOnlyData` does full `collect()` without userId filter | LOW | `convex/mt5Bridge.ts:1265` |
| V-09 | Shared table | `mt5MarketTicks`/`mt5Symbols` are not userId-scoped (by design) | LOW / INFO | `convex/schema.ts` |
| V-10 | Soft auth fail | `requireUserId` returns null instead of throwing in queries | LOW / INFO | `convex/coreQueries.ts:8-15` |
| V-11 | .env.local | Real `.env.local` present on disk — must not be committed | INFO | Project root |
| V-12 | Python body limit | No request body size limit on FastAPI service | LOW | `mt5_readonly_service/main.py` |

---

## 11. Critical Findings

### CRITICAL-1: Missing Clerk Middleware (V-02)
No `src/middleware.ts` file exists. Without this, Clerk does not intercept unauthenticated requests before they reach API handlers. All route-level auth is ad-hoc. If a developer adds a new route without an `auth()` call, it is silently public.

**Impact:** Any unauthenticated user who can reach the Next.js server can access most API routes.

**Fix:** Create `src/middleware.ts` using `clerkMiddleware()` from `@clerk/nextjs/server`, and define a `publicRoutes` matcher to allow only `/sign-in`, `/sign-up`, and public pages:
```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) await auth.protect();
});
export const config = { matcher: ["/((?!_next|.*\\..*).*)"] };
```

### CRITICAL-2: Unauthenticated MT5 Account Data Exposure (V-01)
The routes `/api/mt5-readonly/snapshot`, `/api/mt5-readonly/connection-status`, `/api/mt5-readonly/history-deals`, and `/api/mt5-readonly/connect` return account balance, equity, trade history, login numbers, and server details with no authentication check.

**Impact:** If the application is deployed to any internet-accessible host, MT5 financial account data is publicly readable.

**Fix (per route):** Add at the top of each handler:
```ts
import { auth } from "@clerk/nextjs/server";
const { userId } = await auth();
if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

---

## 12. Recommendations

**Priority 1 — Immediate (before any production deployment):**

1. **Add `src/middleware.ts`** with Clerk's `clerkMiddleware()` to protect all routes at the edge. This is the single most important fix and closes V-01, V-02, and V-06 simultaneously.

2. **Add `auth()` checks to all 5 unprotected MT5-readonly API routes** (`snapshot`, `connect`, `connection-status`, `history-deals`, `symbols`) — return HTTP 401 if unauthenticated. Even with middleware, defense-in-depth requires per-route checks.

3. **Replace the hardcoded Clerk domain** in `candles/route.ts:139` with `process.env.CLERK_FRONTEND_API_URL` to avoid leaking deployment-specific infrastructure details in source code.

**Priority 2 — Before beta/user testing:**

4. **Add a basic rate limiter** to the `/api/lab/analyze-preview` route (the most expensive endpoint). Consider using Vercel's `@vercel/kv` with sliding window, or `upstash/ratelimit`, to limit e.g. 10 requests per user per minute.

5. **Add Python service authentication** — at minimum, a shared secret header (`X-Internal-Token`) that only the Next.js server knows. This prevents direct access to the Python service from any other local process. Pass the secret via environment variable.

6. **Write a basic test suite** — at minimum, test the Convex auth guards (requireUserId throws/returns null correctly), the governance enforcement (tradingEnabled always false), and the analyze-preview route's 401 behavior.

**Priority 3 — Ongoing hygiene:**

7. **Verify `.env.local` is in `.gitignore`** and has never been committed. Run `git log -- .env.local` to confirm.

8. **Replace unbounded `collect()` in `clearDemoMt5ReadOnlyData`** with batched pagination or a server-side cursor to avoid memory issues as data grows. Add a userId filter or confirm this is dev-only and guarded by `ALLOW_DEV_CLEANUP`.

9. **Add `lint` target path** to the `package.json` scripts: `"lint": "eslint src convex --ext .ts,.tsx"` to prevent silent no-op linting.

10. **Document the shared-table design** for `mt5MarketTicks` and `mt5Symbols` in the schema file — note explicitly that these are intentionally global and not per-user, so future developers do not accidentally add userId filtering that breaks the market data feed.

11. **Harden the Python service** against oversized request bodies by configuring FastAPI's `app = FastAPI(...)` with a `max_request_size` or using a middleware limit.

12. **Add a CI pipeline** (GitHub Actions or equivalent) that runs `next build` and `eslint` on every push, to catch regressions early.

---

*This review was performed as a read-only static analysis. No runtime tests were executed. No files were modified.*
