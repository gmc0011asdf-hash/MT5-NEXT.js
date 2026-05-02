# FRONTEND UI REVIEW

**System:** نظام الملك الهندسي للتداول العالمي  
**Stack:** Next.js 16 · Convex · Clerk · Tailwind CSS · shadcn/ui  
**Review Date:** 2026-05-02  
**Reviewer Role:** Frontend UI / RTL Teammate (read-only)

---

## 1. Current Page Inventory

| Route | File | Page Title (AR) | Purpose |
|---|---|---|---|
| `/dashboard` | `(dashboard)/dashboard/page.tsx` | لوحة التحكم | Account snapshot, market ticks, governance state, protection events, market sessions panel. Primary landing after auth. |
| `/lab` | `(dashboard)/lab/page.tsx` | المختبر المؤسسي | Full analysis lab: AnalysisControlPanel (Stage 5A), technical indicators table, Convex signals table, protection events, committee reports. |
| `/monitoring` | `(dashboard)/monitoring/page.tsx` | مراقبة Convex | Monitoring status table, protection events, governance card, audit events, MonitoringDashboard component (live/mock). |
| `/replay` | `(dashboard)/replay/page.tsx` | اختبار Replay | Static placeholder with mock stats, OHLC JSON textarea, disabled Replay button. |
| `/reports` | `(dashboard)/reports/page.tsx` | التقارير | Active positions table, closed deal history, stat cards, filter controls (period/symbol/type/result/search), sync buttons. |
| `/settings` | `(dashboard)/settings/page.tsx` | الإعدادات | MT5 connection form, symbol sync & toggle table, audit log, readiness checklist, platform/risk/pair/governance/UI/alert settings sections. |
| `/convex-core` | `(dashboard)/convex-core/page.tsx` | اختبار قاعدة النظام في Convex | Developer tool: seed demo data, local MT5 sync, read all Convex collections. **Dev-only** (hidden in production). |
| `/convex-test` | `(dashboard)/convex-test/page.tsx` | اختبار Convex | Developer tool: create/list test events via Convex. **Dev-only** (hidden in production). |
| `/sign-in` | `sign-in/[[...sign-in]]/page.tsx` | — | Clerk sign-in page (outside dashboard layout). |
| `/sign-up` | `sign-up/[[...sign-up]]/page.tsx` | — | Clerk sign-up page (outside dashboard layout). |
| `/` | `page.tsx` | — | Root redirect (not examined; likely redirects to /dashboard). |

**Total public dashboard pages:** 6 (dashboard, lab, monitoring, replay, reports, settings)  
**Dev-only pages:** 2 (convex-core, convex-test) — filtered by `AppSidebar` in production builds.

---

## 2. Sidebar Navigation

### Source: `src/lib/constants/navigation.ts` + `src/components/layout/AppSidebar.tsx`

The sidebar uses a **collapsible group** architecture (`NAV_GROUPS`). There are three navigation data structures defined (NAV_GROUPS, NAV_ITEMS, NAV_SECTIONS) — only `NAV_GROUPS` is consumed by `AppSidebar`. The flat `NAV_ITEMS` and `NAV_SECTIONS` exports are legacy/unused.

**Current NAV_GROUPS:**

| Group ID | Group Title (AR) | Items |
|---|---|---|
| `home` | الرئيسية | لوحة التحكم → /dashboard |
| `mt5` | منصة MT5 | المراقبة → /monitoring, إعادة التشغيل → /replay |
| `analysis` | التحليل والمختبر | المختبر → /lab |
| `reports` | التقارير والمراقبة | التقارير → /reports |
| `system` | الإعدادات والنظام | الإعدادات → /settings, Convex Core → /convex-core (dev), Convex Test → /convex-test (dev) |

**Sidebar behavior:**
- Fixed right-side panel, `w-72`, dark `bg-black/20 backdrop-blur-sm`, amber border.
- `dir="rtl"` applied directly on `<aside>`.
- Auto-expands the group containing the active route on pathname change.
- Chevron icon rotates 90° when group is open (using `ChevronLeft` — rotated for RTL).
- Active item: amber highlight (`border-amber-400/20 bg-amber-500/15 text-amber-100`).
- Footer shows static text: "MT5 الحقيقي · قراءة فقط".
- Dev routes (`/convex-core`, `/convex-test`) hidden in production via `DEV_ONLY_HREFS` filter.

**Missing from navigation (not yet registered):**
- OKX Lab — no route, no nav entry.
- Decision Journal — no route, no nav entry.
- Error Center / System Health — no route, no nav entry.

---

## 3. Arabic RTL Assessment

### Root Layout (`src/app/layout.tsx`)
- `<html lang="ar" dir="rtl">` — correct root-level RTL declaration.
- Font: **Cairo** (Google Fonts) with `subsets: ["arabic", "latin"]` — appropriate professional Arabic font.
- `dark` class applied on `<html>` — global dark mode enforced.
- `font-sans` maps to `--font-sans` which maps to `var(--font-sans)` (Cairo variable) — correct.

### AppShell (`src/components/layout/AppShell.tsx`)
- Sidebar is `fixed right-0` — correct RTL placement.
- Main content uses `mr-72` (margin-right = sidebar width) — **correct for RTL** because the sidebar is on the right.
- No `dir` override at shell level; inherits root `dir="rtl"`.

### AppSidebar (`src/components/layout/AppSidebar.tsx`)
- `dir="rtl"` explicitly set on `<aside>` — redundant but harmless, and provides safety.
- `text-start` and `text-end` used correctly (logical properties respect RTL).
- Chevron uses `ChevronLeft` icon — in RTL this points right which is the correct "collapsed" direction. The open state uses `-rotate-90` to point down. This is semantically correct for RTL collapsible groups.
- Nav item padding uses `pr-3` (padding-right for indent) — in RTL this means left-indent which may look inverted. Should use `ps-3` (padding-start = right in RTL) for semantic correctness. Minor issue.

### AppHeader (`src/components/layout/AppHeader.tsx`)
- `bg-gradient-to-l` — gradient goes right-to-left, correct for RTL reading direction.
- `border-s` / `ps-2` / `ps-3` — logical CSS properties used correctly for the auth button separator.
- `flex-wrap` on badge row — may cause badge overflow alignment issues at narrow widths in RTL.
- Some badge labels mix Arabic and English (e.g., "Equity:", "Free Margin:") — inconsistent language use in a fully Arabic UI.

### Page-level RTL
- `AnalysisControlPanel`: has explicit `dir="rtl"` on its root `<div>` — correct, protects nested LTR content.
- `convex-core/page.tsx`: has `dir="rtl"` on its root `<div>` — correct.
- `convex-test/page.tsx`: has `dir="rtl"` on its root `<div>` — correct.
- `dashboard/page.tsx`, `lab/page.tsx`, `monitoring/page.tsx`, `reports/page.tsx`, `replay/page.tsx`, `settings/page.tsx`: **no explicit `dir` attribute** on page roots. They inherit from `<html dir="rtl">` which should work, but explicit `dir="rtl"` on page wrappers is recommended for robustness, especially when certain child elements override with `dir="ltr"` (inputs in settings).

### Input directionality
- In `settings/page.tsx`, several inputs have `dir="ltr"` for account number, server, password, terminal path — correct, as these are technical/numeric fields.
- Symbol search input has `dir="ltr"` — acceptable.
- `Textarea` in replay page has `dir="ltr"` for JSON — correct.

### Table headers
- `TableHead` cells in most tables do not have explicit `text-right` or `text-start` — they rely on inherited RTL direction. Arabic table text should flow RTL, which works with `dir="rtl"` on the `<html>` element.

### Overall RTL verdict
RTL implementation is **generally correct** at the global level. The Cairo Arabic font is loaded, `dir="rtl"` is on `<html>`, sidebar is right-aligned, main content pushes left. A few logical-property inconsistencies exist (`pr-3` vs `ps-3`) but are not breaking. The lack of explicit `dir="rtl"` on individual page root divs is a minor robustness gap.

---

## 4. Lab Page Current State

**Route:** `/lab`  
**Component:** `src/app/(dashboard)/lab/page.tsx`  
**Sub-component:** `src/components/lab/AnalysisControlPanel.tsx`

### What the Lab page currently shows:

**Page heading:** "المختبر المؤسسي" with subtitle "تحليل رموز MT5 الظاهرة — قراءة فقط."

**Section 1 — AnalysisControlPanel (Stage 5A)**
- Header: "لوحة تحليل الفرصة" — read-only opportunity analysis.
- Symbol selector: dropdown populated from `api.coreQueries.getMyEnabledLabSymbols` (Settings-controlled, Convex-backed). Free-text entry is intentionally removed.
- Timeframe mode toggle: Manual / Auto (best timeframe).
- Manual TF buttons: M1, M5, M15, M30, H1, H4, D1.
- Auto mode: multi-select candidate timeframes.
- Inputs: candle count (50–350), stop loss points, target (RR ratio or points), risk USD.
- Analyze button: "تحليل الفرصة" — **enabled only** when symbol is selected and not busy. Posts to `/api/lab/analyze-preview` (read-only route).
- Result card: shows opportunity status, direction, entry/SL/TP/RR, lot, risk, indicators snapshot, data quality, reasons, warnings.
- Persistent read-only disclaimer: "قراءة فقط — لا يتم تنفيذ أي صفقة."

**Section 2 — Convex Read Status Card**
- Shows Convex auth state, governance readOnly/tradingEnabled flags.
- Button: "تنفيذ تجريبي (معطّل)" — **permanently disabled** regardless of governance state due to `executionBlocked` logic that requires `governance.tradingEnabled` to be truthy AND `readOnly` to be false, both of which are gated.
- Inline disabled explanation when Convex is authenticated but execution blocked.

**Section 3 — Alert Banner**
- Amber alert: "هذه نسخة واجهة Next.js للعرض والقراءة فقط، التنفيذ ما زال غير مفعل هنا."

**Section 4 — Technical Indicators Table**
- Header: "المؤشرات الفنية من MT5"
- Button: "حساب المؤشرات الفنية" — calls `api.technicalIndicators.computeTechnicalIndicatorsForEnabledSymbols`. **Enabled** when Convex is authenticated and not busy (this is a compute, not a trade execution, so it is intentionally allowed).
- Table columns: الرمز, الإطار, EMA20, EMA50, EMA200, RSI14, ATR14, MACD Histogram, اتجاه الترند, اتجاه الزخم, المصدر.
- Empty/loading states handled.

**Section 5 — MT5 Signals Table (Convex)**
- Header: "إشارات MT5 (قراءة)" — reads from `api.coreQueries.getMyLatestRealSignals`.
- Filtered by `api.coreQueries.getMyEnabledLabSymbols`.
- Table columns: الرمز, الإطار, الحكم, الاحتمالية, دخول, وقف, هدف, الحالة, السبب, المصدر.
- No action buttons — pure display.

**Section 6 — Protection Events Table (Convex)**
- Header: "أحداث الحماية (Convex)".
- Columns: الخطورة, الرسالة, محظور.

**Section 7 — Committee Reports Table (Convex)**
- Header: "تقارير اللجنة (Convex)".
- Columns: الرمز, عقل السوق, عقل الحماية, عقل التنفيذ, القرار النهائي, ملخص.

**Lab page summary:** This is an MT5-specific analysis lab. It is functional and connected to real Convex data. The page title "المختبر المؤسسي" does not explicitly say "MT5 Lab." Adding a sub-label or badge like "MT5" would clarify it before OKX Lab is added.

---

## 5. Missing Pages & Placeholders Needed

### 5.1 OKX Lab (`/okx-lab`)
**Status:** Does not exist. No route, no nav entry, no component.  
**Need:** A placeholder page behind a "قريبًا" / "قيد التطوير" banner. Should be clearly distinguished from the MT5 Lab with an OKX brand marker. Must contain a prominent read-only banner — no functionality until backend is ready.  
**Suggested nav location:** Under a new group "منصة OKX" or added to the existing "التحليل والمختبر" group as a second item.

### 5.2 Decision Journal (`/journal` or `/decision-journal`)
**Status:** Does not exist. No route, no nav entry, no component.  
**Need:** A placeholder page for recording and reviewing trading decisions. Could show an empty state with Arabic placeholder text and a "قريبًا" banner. No data connections needed at placeholder stage.  
**Suggested nav location:** Under "التقارير والمراقبة" group or a new "السجلات" group.

### 5.3 Error Center / System Health (`/error-center` or `/system-health`)
**Status:** Does not exist as a dedicated page. Monitoring data is split between `/monitoring` (Convex-level monitoring) and the `MonitoringDashboard` component (backend API health). There is no unified error log surface.  
**Need:** A dedicated page aggregating system errors, backend health, Convex errors, MT5 connection failures, and protection events in one place. At minimum a placeholder with a "قريبًا" banner reusing the existing `MonitoringDashboard` component.  
**Suggested nav location:** Under "الإعدادات والنظام" group.

### 5.4 Settings — OKX Section
**Status:** The settings page has sections for MT5 connection, symbols, risk, pairs, governance, UI, alerts — but **no OKX section**.  
**Need:** A new `<Section title="إعدادات منصة OKX">` card in `/settings`, initially showing read-only placeholder fields (API Key masked, API Secret masked, Passphrase masked, connection status). All fields disabled with a "قريبًا" badge.

---

## 6. UI Problems Found

### 6.1 Language Mixing in Header Badges (Medium)
**File:** `src/components/layout/AppHeader.tsx` lines 109–117.  
Labels "Equity:" and "Free Margin:" are English in an Arabic-first UI. Inconsistent with "الرصيد:" which is Arabic. Should be "حقوق الملكية:" and "الهامش الحر:" respectively, or at minimum use the same language pattern as the balance label.

### 6.2 Padding Direction Inconsistency in Sidebar (Low)
**File:** `src/components/layout/AppSidebar.tsx` line 111.  
Sub-items use `pr-3` (physical right padding = indentation toward center in LTR, but in RTL it pushes items toward the right edge of the sidebar). Should use `ps-3` (padding-start = right in RTL, which means indentation from the sidebar's starting edge, i.e., from the right). Current behavior may look slightly off — the indent goes toward the right wall instead of stepping inward from the right.

### 6.3 Missing `dir="rtl"` on Page Root Elements (Low)
**Files:** `dashboard/page.tsx`, `lab/page.tsx`, `monitoring/page.tsx`, `reports/page.tsx`, `replay/page.tsx`, `settings/page.tsx`.  
These pages inherit RTL from `<html dir="rtl">` which works, but child components that contain `dir="ltr"` inputs (like settings) can create implicit bidirectional context switches. Adding `dir="rtl"` on the page wrapper div makes the directionality chain explicit and prevents subtle layout bugs when more LTR elements are added.

### 6.4 Native `<select>` Elements in Reports Page (Medium)
**File:** `src/app/(dashboard)/reports/page.tsx` lines 280–315.  
The filter controls use native `<select>` elements with inline `className` styling rather than the shadcn/ui `Select` component. This creates visual inconsistency — native selects do not follow the dark institutional theme on all browsers/OS (especially Windows where native dropdowns use system chrome). All other dropdowns in the system (e.g., AnalysisControlPanel) use the shadcn `Select` component.

### 6.5 Hardcoded Mock/Placeholder Values in Settings (Low)
**File:** `src/app/(dashboard)/settings/page.tsx` lines 619–623.  
The "إعدادات الأزواج (واجهة)" section has hardcoded strings: `"EURUSD, XAUUSD (وهمي)"` and `"H1 / M15 (عرض)"`. These are visible placeholder values that expose internal development notes to the user. Should either be replaced with actual Convex data or use a proper empty-state placeholder.

### 6.6 Symbol Toggle Switch RTL Thumb Position (Low)
**File:** `src/app/(dashboard)/settings/page.tsx` lines 66–70.  
The custom `SymbolToggleSwitch` component uses absolute positioning with `translate-x-[48px]` to move the thumb to the OFF (left) position. In an RTL context, "left" for OFF and "right" for ON may need to be semantically swapped (OFF thumb should be on the visually "end" side, which in RTL is the left side). The current logic has `checked=true` → thumb at `left-1` (right side of container) and `checked=false` → thumb at `left-1 + translate-x-[48px]` (left side of container). In RTL reading, right=start=ON and left=end=OFF. This is actually correct — but the text labels "ON"/"OFF" with `text-right`/`text-left` classes may conflict with RTL text flow. Needs visual verification.

### 6.7 Monitoring Page Has Duplicate Data Display (Low)
**File:** `src/app/(dashboard)/monitoring/page.tsx`.  
The page renders Convex monitoring tables (monitoringStatus, protectionEvents, governance, auditEvents) AND then renders `<MonitoringDashboard />` which queries a separate backend API health endpoint. Both sections have their own "لوحة المراقبة" heading. This creates a page with two conceptually separate monitoring sections without a clear visual hierarchy separating them. Users may be confused about which section is "authoritative."

### 6.8 Convex-Core Page Accessible in Dev Without Warning Banner (Low)
**File:** `src/app/(dashboard)/convex-core/page.tsx`.  
This page has active mutation buttons (seed demo data, demo bridge sync) that write to the production Convex database if used in the wrong environment. While filtered from the sidebar in production, the route remains accessible by direct URL in all environments. No "DANGER: dev-only" banner is present on the page itself.

### 6.9 Missing Loading Skeleton on Lab Page Main Sections (Low)
**File:** `src/app/(dashboard)/lab/page.tsx`.  
The AnalysisControlPanel uses a loading state for symbols (`جاري تحميل الأزواج…`) but the four Convex data tables below show inline paragraph loading states rather than skeleton cards. `DashboardSystemCards` uses proper `<Skeleton>` components. The Lab page should adopt the same skeleton pattern for visual consistency.

### 6.10 Reports Page Select Dropdowns Have Mixed Arabic/English Values (Low)
**File:** `src/app/(dashboard)/reports/page.tsx` lines 288–291.  
The Symbols filter `<select>` shows "All" in English (`<option value="all">All</option>`) while all other options show Arabic. Should be "الكل" for consistency with the النوع and الحالة and النتيجة filters which correctly use "الكل."

---

## 7. Proposed Safe Changes (Plan Only — No Code)

All changes below are additive or rename-only. No existing functionality is modified. Lead approval required before implementation.

### 7.1 Rename / Badge Lab Page as "MT5 Lab"

**Plan:**
- In `src/app/(dashboard)/lab/page.tsx`, change the `<h2>` from "المختبر المؤسسي" to "مختبر MT5 المؤسسي" (or add a `<Badge>` next to the existing heading with the text "MT5").
- In `src/lib/constants/navigation.ts`, update the `NAV_GROUPS` `analysis` group item label from "المختبر" to "مختبر MT5".
- This clarifies that this lab is MT5-specific before OKX Lab is added, without breaking any route or Convex query.

### 7.2 OKX Lab Placeholder Page

**Plan:**
- Create `src/app/(dashboard)/okx-lab/page.tsx`.
- Page body: a single `institutionalCardClass` card with:
  - Heading: "مختبر OKX"
  - A prominently styled banner (rose or amber, similar to the Replay page's AlertNote pattern) stating this page is under development and read-only: "هذه الصفحة قيد التطوير — لا يوجد اتصال بمنصة OKX حالياً."
  - Static metadata fields (platform name, status badge showing "قريبًا") — no live data, no buttons.
- Add to `NAV_GROUPS` in `navigation.ts`: add a new group `id: "okx"`, title: "منصة OKX", icon: `Globe` (or a dedicated OKX icon), items: `{ label: "مختبر OKX", href: "/okx-lab", icon: FlaskConical }`.
- No Convex queries, no API calls.

### 7.3 Decision Journal Placeholder Page

**Plan:**
- Create `src/app/(dashboard)/journal/page.tsx`.
- Page body: heading "سجل القرارات", subtitle "سجل قراراتك التداولية للمراجعة والتحسين."
- Banner: "قيد التطوير — سيتم ربط هذه الصفحة بنظام Convex في مرحلة لاحقة."
- Empty state card using `institutionalCardClass`, showing an icon and Arabic placeholder text.
- No data connections.
- Add to `NAV_GROUPS` under the `reports` group or as a new "السجلات" group.

### 7.4 Error Center / System Health Placeholder Page

**Plan:**
- Create `src/app/(dashboard)/error-center/page.tsx`.
- Page body: heading "مركز الأخطاء وصحة النظام".
- Reuse the existing `MonitoringDashboard` component (it already handles loading/live/mock states).
- Add a banner above it: "هذه الصفحة تجمع حالة النظام — قراءة فقط." using the amber alert pattern.
- This immediately gives the Error Center functional content (it shows backend health, MT5 status, governance, kill switch) without writing new logic.
- Add to `NAV_GROUPS` under the `system` group.
- Optional later: add a dedicated Convex errors table by reusing the existing audit events / protection events query pattern.

### 7.5 Settings — Add OKX Section

**Plan:**
- In `src/app/(dashboard)/settings/page.tsx`, add a new `<Section title="إعدادات منصة OKX">` card after the existing "اتصال منصة MT5 الحقيقية" section.
- Content: use the existing `<Field>` component (already defined in settings page) with:
  - Field: "مفتاح API (OKX)" — disabled, placeholder "غير مُعدَّل بعد"
  - Field: "API Secret" — disabled, placeholder "——"
  - Field: "Passphrase" — disabled, placeholder "——"
  - Field: "حالة الاتصال" — disabled, value "غير متصل"
- Add a top banner inside the section: "إعدادات OKX معطّلة — قيد التطوير." using `Badge variant="secondary"`.
- Reuses existing `Section` and `Field` helper components — zero new component code needed.

### 7.6 Fix English Labels in Header

**Plan:**
- In `AppHeader.tsx` lines 109–117, change "Equity:" to "حقوق الملكية:" and "Free Margin:" to "الهامش الحر:".
- This is a one-line change per label, purely cosmetic, no logic change.

### 7.7 Fix Reports Page Native Selects to shadcn Select

**Plan:**
- Replace the five native `<select>` elements in `reports/page.tsx` filter controls with the shadcn/ui `<Select>` / `<SelectTrigger>` / `<SelectContent>` / `<SelectItem>` pattern already used in `AnalysisControlPanel.tsx`.
- No logic change — only UI component swap.
- This is medium effort (5 select replacements, each 8–12 lines) but high visual impact.

---

## 8. Shared Components Available

### From `src/components/ui/` (shadcn/ui primitives)

| Component | File | Current Usage |
|---|---|---|
| `Alert` + `AlertTitle` + `AlertDescription` | `alert.tsx` | Lab, Dashboard, MonitoringDashboard — amber/rose warning banners |
| `Badge` | `badge.tsx` | Header status badges, settings readiness, reports status, all pages |
| `Button` | `button.tsx` | All interactive pages; analysis, settings, reports |
| `Card` + `CardContent` + `CardHeader` + `CardTitle` | `card.tsx` | All dashboard cards, always wrapped with `institutionalCardClass()` |
| `Dialog` | `dialog.tsx` | **Not currently used in any page** — available for future modals |
| `DropdownMenu` | `dropdown-menu.tsx` | **Not currently used in any page** — available |
| `Input` | `input.tsx` | Settings, AnalysisControlPanel, Reports search |
| `Progress` | `progress.tsx` | **Not currently used in any page** — available for loading/progress indicators |
| `ScrollArea` | `scroll-area.tsx` | **Not currently used in any page** — available for tall tables |
| `Select` + `SelectTrigger` + `SelectContent` + `SelectItem` | `select.tsx` | AnalysisControlPanel symbol dropdown and timeframe buttons |
| `Separator` | `separator.tsx` | AppHeader divider line |
| `Sheet` | `sheet.tsx` | **Not currently used** — available for mobile sidebar drawer |
| `Skeleton` | `skeleton.tsx` | DashboardSystemCards loading, MonitoringDashboard loading |
| `Table` + `TableHeader` + `TableBody` + etc. | `table.tsx` | Lab, Monitoring, Reports, Settings — all data tables |
| `Tabs` + `TabsList` + `TabsTrigger` + `TabsContent` | `tabs.tsx` | **Not currently used in any page** — excellent candidate for Lab sub-sections |
| `Textarea` | `textarea.tsx` | Replay page OHLC input |
| `Tooltip` + `TooltipProvider` | `tooltip.tsx` | Provider loaded at root, individual Tooltips not yet used on any page |

### From `src/components/common/`

| Component | Purpose | Current Usage |
|---|---|---|
| `StatusBadge` (variant: ok/warning/danger/neutral/mock) | Colored status pill with optional icon | AppHeader, DashboardSystemCards, MonitoringDashboard, MarketSessionsPanel |
| `PulseDot` (tone: ok/warning/danger/neutral/mock) | Animated glowing dot for live indicators | MarketSessionsPanel session cards |
| `MarketMoveIcon` | TrendingUp / TrendingDown / Activity icon | Available, not currently used on pages |
| `ActivityMicroBar` | Animated bar chart indicator showing market activity | MarketSessionsPanel session cards |
| `Mt5EmptyState` | `src/components/common/Mt5EmptyState.tsx` | Read but not yet consumed by any page (empty state pattern) |

### From `src/lib/`

| Utility | File | Purpose |
|---|---|---|
| `institutionalCardClass(extra?)` | `ui-institutional.ts` | Primary card surface: dark + amber border + gradient. Used on every card in the system. |
| `institutionalCardInner()` | `ui-institutional.ts` | Inner card variant with backdrop blur. Currently unused in pages but available. |
| CSS utilities: `.page-title`, `.card-title-inst`, `.label-secondary`, `.price-figure` | `globals.css` | Typography hierarchy used consistently across pages. |

### Component Reuse Opportunities for New Placeholder Pages

1. **Alert + AlertDescription** — for "قريبًا" / development banners on all three missing pages.
2. **Card + institutionalCardClass** — for any content section on placeholder pages.
3. **StatusBadge variant="neutral"** — for "قريبًا" / "قيد التطوير" status pills.
4. **Tabs** — currently unused but ideal for Lab page to separate MT5 Lab / OKX Lab sub-tabs once OKX is ready; also useful for Settings to organize sections.
5. **Skeleton** — for placeholder loading states on new pages that will eventually have live data.
6. **`Section` and `Field` helpers** — defined inline in settings page, could be extracted to `src/components/settings/` for reuse in OKX settings section.
7. **MonitoringDashboard component** — ready to be reused in Error Center page with no changes.

---

## 9. Execution Buttons Audit

This system is explicitly read-only. All buttons that could be confused with trade execution have been audited below.

| Page | Button Label | Disabled? | Condition | Notes |
|---|---|---|---|---|
| `/lab` | "تنفيذ تجريبي (معطّل)" | **Always disabled** | `executionBlocked = !canUseConvex OR governance.readOnly OR !governance.tradingEnabled` | Correct — governance gate prevents any accidental enable. Label also says معطّل. |
| `/lab` | "حساب المؤشرات الفنية" | Disabled if `!canUseConvex OR computeBusy` | Enabled when authenticated | This is a Convex compute operation, NOT a trade execution. Correctly enabled. |
| `/lab` (AnalysisControlPanel) | "تحليل الفرصة" | Disabled if `!canAnalyze` (`busy OR symbol=="" OR symbol not in allowedSymbols`) | Enabled when symbol selected | Posts to `/api/lab/analyze-preview` — read-only API route. Correct. |
| `/replay` | "تشغيل Replay (معطّل)" | **Always disabled** (`disabled` prop hardcoded) | Static | Correct — hardcoded disabled, not governance-dependent. |
| `/reports` | "سحب سجل الصفقات من MT5" | Disabled if `!canUseConvex OR historySyncBusy` | Enabled when authenticated | This is a READ/sync operation from MT5 to Convex. Not a trade execution. Correct. |
| `/reports` | "تحديث الصفقات النشطة من MT5" | Disabled if `!canUseConvex OR activeSyncBusy` | Enabled when authenticated | Same — read/sync operation. Correct. |
| `/settings` | "اتصال بمنصة MT5" | Disabled if `connectBusy` | Enabled when not busy | Initiates READ-ONLY MT5 connection. Response forces `read_only: true`. Correct. |
| `/settings` | "مزامنة الرموز الظاهرة في MT5" | Disabled if `!canUseConvex OR syncBusy` | Enabled when authenticated | Read/sync operation. No trade execution. Correct. |
| `/convex-core` | "مزامنة MT5 المحلي للقراءة فقط" | Disabled if `buttonDisabled` (not authenticated OR pending) | Enabled when authenticated | Read/sync. The `syncReadOnlySnapshotFromLocalService` mutation name itself enforces read-only mode. Correct. |
| `/convex-core` | "إنشاء بيانات تجريبية للنظام" | Disabled if `buttonDisabled` | Enabled when authenticated | Writes DEMO data to Convex. Dev-only page. Not a trade execution. **Note: accessible by URL in production.** |
| `/convex-core` | "مزامنة قراءة تجريبية من MT5" | Disabled if `buttonDisabled` | Enabled when authenticated | Demo sync stub. Dev-only page. Same note as above. |
| `/convex-test` | "إرسال اختبار إلى Convex" | Disabled if `buttonDisabled` | Enabled when authenticated | Creates test event in Convex. Dev-only page. Not trade-related. Correct. |

**Summary:** No live trade execution button exists anywhere in the codebase. All action buttons are for data sync (read from MT5), Convex compute (indicators), analysis preview (read-only API call), or dev data seeding. The execution gate (`governance.readOnly`, `governance.tradingEnabled`) is properly checked for the one button explicitly labeled as execution-capable ("تنفيذ تجريبي (معطّل)") and that button is always disabled under current governance defaults. **System is safe.**

---

## 10. Verdict & Priority List

### Overall Assessment
The frontend is architecturally sound: proper RTL foundation, professional dark institutional theme, Arabic-first labels, Cairo font, consistent shadcn/ui usage, and a well-defined `institutionalCardClass` design token. The system is genuinely read-only with no trade execution paths. The navigation, layout, and component hierarchy are clean.

The main gaps are: (a) absence of three planned pages (OKX Lab, Decision Journal, Error Center), (b) the Lab page not being labeled as MT5-specific before OKX Lab is added, and (c) a handful of minor visual inconsistencies.

### Priority List

**P0 — Before next demo/review (low effort, high clarity):**
1. Rename Lab page heading and nav item to include "MT5" label — prevents confusion when OKX Lab route is added.
2. Fix English labels "Equity:" and "Free Margin:" in AppHeader to Arabic equivalents.
3. Fix "All" English option in Reports page symbol filter to "الكل."

**P1 — Placeholder pages (medium effort, unblocks roadmap):**
4. Create `/okx-lab` placeholder page with read-only banner and nav entry.
5. Create `/journal` (Decision Journal) placeholder page with nav entry.
6. Create `/error-center` placeholder page reusing MonitoringDashboard, with nav entry.
7. Add OKX section to Settings page using existing `Section`/`Field` helpers.

**P2 — UI consistency fixes (medium effort):**
8. Replace native `<select>` dropdowns in Reports page with shadcn `Select` components.
9. Add `dir="rtl"` explicitly to page root `<div>` elements in dashboard, lab, monitoring, reports, replay, settings pages.
10. Fix sidebar sub-item indentation: `pr-3` → `ps-3`.

**P3 — Polish (lower priority):**
11. Refactor `Section`/`Field` helpers from settings page into `src/components/settings/` for reuse by OKX section.
12. Replace inline loading paragraph states in Lab page data tables with `<Skeleton>` components to match the DashboardSystemCards pattern.
13. Add a "DEV ONLY" warning banner to `/convex-core` page visible in all environments.
14. Investigate and fix visual rendering of the `SymbolToggleSwitch` RTL thumb position in a browser.
15. Consider using `Tabs` component to separate MT5 and OKX content in both Lab and Settings pages as OKX features are introduced.

---

*Review is read-only. No source files were modified. All proposed changes are plans only, pending lead approval.*
