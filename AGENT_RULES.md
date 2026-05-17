# AGENT RULES — نظام الملك الهندسي للتداول العالمي

> These rules apply to every AI agent, human developer, or automated process that modifies this repository.  
> Version: 1.0 — 2026-04-28

---

## Rule 1 — Never Change MT5 Safety Contracts Without Explicit Stage Approval

The following are permanent safety constants. They must NOT be changed, weakened, or removed without a separate explicit written approval by the project owner:

- `READ_ONLY_MODE = true` in `mt5_readonly_service/main.py`
- `READ_ONLY_MODE = true` in `convex/mt5Bridge.ts`
- `FORBIDDEN_MT5_FUNCTION_NAMES` tuple in Python service
- `governance.readOnly = true` default in Convex governance table
- `governance.tradingEnabled = false` default in Convex governance table

If you are asked to change any of these, stop and ask the project owner for explicit stage approval.

---

## Rule 2 — Never Add order_send Before Stage 14 Approval

These functions must NOT appear anywhere in the codebase before Stage 14 explicit approval:

```
order_send
order_close
order_modify
order_check
OrderSend
```

If you find these in new code, remove them immediately and report the finding.

---

## Rule 3 — No Secrets in Code or Commits

Never commit to git:
- MT5 account passwords
- Clerk secret keys (`sk_test_*`, `sk_live_*`)
- Convex deployment URLs with credentials
- API keys of any kind
- `.env.local` file (already in .gitignore — verify)

If you discover a secret in the codebase, remove it immediately and notify the project owner. Do not just add it to .gitignore and leave the value in code.

---

## Rule 4 — Preserve Arabic RTL

Every UI change must maintain:
- `dir="rtl"` on the root layout or affected component
- Arabic text is right-to-left aligned by default
- Navigation labels, error messages, and empty states remain in Arabic
- No English-only UI visible to end users (technical identifiers like "MT5" are acceptable)
- Test RTL manually after any layout change

If you are unsure whether an RTL change is needed, default to adding it.

---

## Rule 5 — Preserve Real Data Truthfulness

Never show fake or demo values in the production UI as if they were real:
- All mock/demo components must be clearly labelled `[تجريبي]`
- Empty states must be honest: explain WHY data is missing, not show fake zeros
- `source` field on all Convex data must be checked before display
- If real data is unavailable, show "غير متصل" or "لم تتم المزامنة" — never a fake value

---

## Rule 6 — Every Change Must Pass tsc and Build

Before reporting any task as done:

```bash
pnpm exec tsc --noEmit   # must produce zero errors
pnpm build               # must complete without errors
```

If modifying the Python service, also run:

```bash
python -m py_compile mt5_readonly_service/main.py
```

If modifying Convex schema or mutations, also run:

```bash
pnpm exec convex codegen
```

Do NOT report a task as done if any of these fail.

---

## Rule 7 — Every Stage Must Have a Clear Report

After completing any stage task, produce a short report containing:
- Files changed (with line references if significant)
- What was added, removed, or changed
- Build/typecheck results
- Manual verification steps taken
- Any risks or follow-up items identified

Do not silently complete tasks without a report.

---

## Rule 8 — Avoid Broad Rewrites

Do not rewrite entire files unless the task explicitly requires it.  
Do not refactor adjacent code while fixing a bug.  
Do not rename variables, reorganize imports, or change formatting in files you are not modifying for the task.  
Small, focused changes are preferred. They are easier to review, easier to revert, and less likely to introduce regressions.

Acceptable: Edit 3 lines in a route file to add an env var.  
Not acceptable: Rewrite the entire route file structure to "clean it up" while adding the env var.

---

## Rule 9 — Prefer Small Commits

Each git commit should contain one logical change. Examples of correct scope:
- "Add MT5_SERVICE_URL env var to all API routes"
- "Add market closed annotation to /readonly/ticks response"
- "Fix empty state in DashboardActivitySection"

Examples of too-broad scope:
- "Refactor entire API layer and add env vars and fix types"
- "Clean up code"
- "Various fixes"

---

## Rule 10 — No Speculation About Trading Accuracy

Do not add any copy, comments, or documentation that implies:
- The system is profitable
- The system will produce winning trades
- Any signal is a recommendation to buy or sell
- Any indicator guarantees a future price movement

Use only:
- "نظام تحليل معلوماتي مؤسسي" (institutional informational analysis system)
- "تحليل للأغراض المعلوماتية فقط" (analysis for informational purposes only)
- "ليس توصية مالية" (not financial advice)

---

## Rule 11 — Convex Schema Changes Require Codegen

Any change to `convex/schema.ts` requires:
1. `pnpm exec convex codegen` to regenerate `_generated/`
2. `pnpm exec tsc --noEmit` to verify generated types are correct
3. Update any queries/mutations that reference the changed table

Do not manually edit files in `convex/_generated/`.

---

## Rule 12 — No collect() on Large Tables

Do not use `.collect()` on tables that can grow large:
- `mt5Candles`
- `mt5MarketTicks`
- `mt5TradeHistoryDeals`
- `auditEvents`
- `labSignalSnapshots`

Use `.paginate()` with cursor-based pagination instead. See Convex docs for `usePaginatedQuery`.

---

## Rule 13 — Do Not Break Clerk Auth

- Never remove `ClerkProvider` from the provider tree
- Never bypass Clerk middleware (`middleware.ts`)
- Never call Convex mutations from unauthenticated contexts
- All Convex mutations and sensitive queries must check `ctx.auth.getUserIdentity()`
- Sign-in and sign-up routes must remain functional

---

## Rule 14 — Do Not Break Existing MT5 Routes

The six API routes under `/api/mt5-readonly/` must remain functional:
- `connection-status`
- `connect`
- `snapshot`
- `symbols`
- `history-deals`
- `candles`

Do not change their URL paths, response shapes, or error format without updating the Python service and all consuming components simultaneously.

---

## Rule 15 — Stage 14 Is Explicitly Locked

Do not implement, stub, plan, or hint at live execution code anywhere in the codebase until Stage 14 receives explicit written approval from the project owner.

This includes:
- No `order_send` calls
- No open/close/modify order functions
- No SL/TP modification
- No lot size submission to broker
- No execution queue or order manager
- No paper order → real order conversion code

Violation of this rule requires immediate rollback and notification.

---

## Quick Reference Checklist (before marking any task done)

```
[ ] pnpm exec tsc --noEmit → zero errors
[ ] pnpm build → successful
[ ] python -m py_compile main.py → OK (if Python changed)
[ ] pnpm exec convex codegen → OK (if schema changed)
[ ] Arabic RTL verified in browser
[ ] No mock/demo data shown without [تجريبي] label
[ ] No secrets in changed files
[ ] No order_send or trading execution code added
[ ] Report written: files changed + test results + manual checks
```
