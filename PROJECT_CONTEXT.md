# PROJECT_CONTEXT.md
# نظام الملك الهندسي للتداول العالمي

> **⚠️ هذا الملف يجب أن يُقرأ قبل أي تنفيذ في هذا المشروع.**  
> أي وكيل أو مطور يبدأ يجب أن يقرأ هذا الملف أولاً.  
> آخر تحديث: 2026-05-25 (إتمام Gold Pro Lab — مختبر تحليل الذهب المؤسسي)

---

## 1. اسم المشروع

**نظام الملك الهندسي للتداول العالمي**  
Institutional-grade analytical trading system — informational analysis only.

---

## 2. الهدف

نظام تحليل تداول مؤسسي يعمل كأداة معلوماتية فقط:

- **MT5 حالياً:** متصل — Read-only bridge عبر FastAPI محلي.
- **OKX مستقبلاً:** Placeholder فقط — لا ربط حقيقي.
- **لا تنفيذ تداول مباشر** في أي مرحلة حالية.
- **Decision Journal:** سجل قرارات تحليلية — قراءة فقط.
- **ليس توصية مالية.** لا يحتوي على أوامر تنفيذ.

---

## 3. Stack التقني

| المكوّن | الإصدار / التفصيل |
|---|---|
| **Next.js** | 16.2.4 (Turbopack) |
| **React** | 19.2.4 |
| **TypeScript** | ^5 |
| **Tailwind CSS** | ^4 |
| **Convex** | ^1.36.1 — قاعدة بيانات real-time |
| **Clerk** | ^7.2.7 — مصادقة المستخدمين |
| **MT5 Bridge** | FastAPI Python — قراءة فقط — port 8010 |
| **pnpm** | مدير الحزم |
| **Lucide React** | أيقونات |
| **Recharts** | رسوم بيانية |

---

## 4. حالة المراحل المنجزة

| المرحلة | الاسم | الحالة |
|---|---|---|
| A1/A2 | فصل Lab MT5/OKX — إنشاء مجلدات الفصل | ✅ منجز |
| A3 | Settings placeholders — تنظيم الإعدادات | ✅ منجز |
| A4 | Decision Journal placeholder | ✅ منجز |
| A5 | System Health + Error Center | ✅ منجز |
| A6 | Data Contract — عقد بيانات Decision Journal | ✅ منجز |
| A7 | UI Type-only — ربط الصفحة بالعقد | ✅ منجز |
| A8 | Convex Schema Plan — خطة توثيق | ✅ منجز |
| A9 | Convex Schema — إضافة الجداول الخمسة | ✅ منجز |
| A10 | Read-only Queries — 6 queries | ✅ منجز |
| A11 | UI → Convex — ربط الصفحة بـ useQuery | ✅ منجز |
| DOCS-1 | Markdown Cleanup Plan | ✅ منجز |
| DOCS-2 | Reorganize docs + PROJECT_CONTEXT + Skills | ✅ منجز |
| Convex AI | تثبيت Convex AI Skills | ✅ منجز |
| Fix-0 | توثيق `.env.local.example` وتحديث السياق | ✅ منجز |
| Fix-1 | تأمين مسارات Proxy بـ Clerk Auth + عزل userId | ✅ منجز |
| Fix-2 | Cron Jobs لتنظيف الجداول دورياً | ✅ منجز |
| Fix-3 | واجهات Frontend الناقصة + إصلاحات بصرية | ✅ منجز |
| **Gold Plan** | **MT5_GOLD_MASTER_DEVELOPMENT_PLAN** | |
| 8-A | مكتبة الاستراتيجيات — Schema + Queries + Mutations | ✅ منجز |
| 8-B | صفحة مكتبة الاستراتيجيات `/strategy-library` | ✅ منجز |
| 8-C | صفحة تفاصيل الاستراتيجية `/strategy-library/[id]` + Shadow Mode | ✅ منجز |
| 8-D | حفظ نتائج Strategy Lab في مكتبة الاستراتيجيات | ✅ منجز |
| 8-E | Shadow Signal Form: lot افتراضي + rule compliance badges | ✅ منجز |
| 8-F | مقارنة الاستراتيجيات `/strategy-library/compare` | ✅ منجز |
| 7.3 | StrategyCompliancePanel — لجنة الاستراتيجية في مركز الذهب | ✅ منجز |
| 4.2 | Expected Value (EV) — عمود EV في جدول المقارنة | ✅ منجز |
| 4.3 | Consistency Score (σ) — انحراف معياري في إحصاءات التجربة | ✅ منجز |
| 2.2 | calculatedLot — الـ lot الافتراضي في نموذج الإشارة | ✅ منجز |
| 8-G/8-H | Controlled Experiment + Pending Orders | 🔒 محظور — Stage 14 |
| **Gold Pro Lab** | مختبر تحليل الذهب المؤسسي `/lab/gold-pro` | ✅ منجز |

---

## 4.5. الحالة الأمنية وخطة الإصلاح (Security & Fixes Roadmap)
بناءً على المراجعة الأمنية والمعمارية الأخيرة، المشروع في حالة **Read-only Foundation** ممتازة، لكنه يحتاج إلى إصلاحات تنظيمية وأمنية عاجلة قبل المضي قدماً:

- **الخطورة P0:** غياب المصادقة (Authentication) عن مسارات البروكسي في `api/mt5-readonly`.
- **الخطورة P1:** الحاجة إلى عزل البيانات في جداول Convex باستخدام `userId` (مثل `mt5MarketTicks`).
- **المخاطر التشغيلية:** نمو غير محدود للجداول (Unbounded Growth) يتطلب وظائف تنظيف مجدولة (Cron Jobs).

**المراحل الإصلاحية (مكتملة جميعها):**
- [✅] **Fix-0:** إعداد البيئة وتوثيق `.env.local.example` وتحديث السياق.
- [✅] **Fix-1:** تأمين مسارات الـ Proxy بـ Clerk Auth وعزل بيانات Convex بـ userId.
- [✅] **Fix-2:** تحسين قاعدة البيانات عبر إضافة وظائف تنظيف دورية (Cron Jobs).
- [✅] **Fix-3:** استكمال واجهات الـ Frontend الناقصة وتنظيف المشاكل البصرية الطفيفة.

---

## 5. المسارات المهمة

### صفحات التطبيق

| المسار | الوصف |
|---|---|
| `src/app/(dashboard)/lab/mt5/page.tsx` | مختبر MT5 — Client Component — يستخدم Convex |
| `src/app/(dashboard)/lab/okx/page.tsx` | مختبر OKX — Placeholder فقط |
| `src/app/(dashboard)/decision-journal/page.tsx` | سجل القرارات — مربوط بـ Convex (A11) |
| `src/app/(dashboard)/settings/page.tsx` | الإعدادات — يستخدم Convex |
| `src/app/(dashboard)/system-health/page.tsx` | صحة النظام — Placeholder |
| `src/app/(dashboard)/error-center/page.tsx` | مركز الأخطاء — Placeholder |
| `src/app/(dashboard)/gold/page.tsx` | مركز الذهب المؤسسي — يشمل StrategyCompliancePanel |
| `src/app/(dashboard)/lab/gold-pro/page.tsx` | Gold Pro Lab — مختبر تحليل الذهب المؤسسي |
| `src/app/(dashboard)/gold/strategy-lab/page.tsx` | مختبر الاستراتيجية + حفظ في المكتبة (8-D) |
| `src/app/(dashboard)/strategy-library/page.tsx` | مكتبة الاستراتيجيات — قائمة كاملة (8-B) |
| `src/app/(dashboard)/strategy-library/[id]/page.tsx` | تفاصيل الاستراتيجية — Shadow Mode + إحصاءات (8-C) |
| `src/app/(dashboard)/strategy-library/compare/page.tsx` | مقارنة الاستراتيجيات — EV + Level-2 Plans (8-F) |

### Convex

| الملف | الوصف |
|---|---|
| `convex/schema.ts` | Schema الكامل — 19+ جدول (يشمل strategies, strategyFiles, strategyBacktests, strategySignals, strategyExperiments) |
| `convex/strategies.ts` | Queries + Mutations لمكتبة الاستراتيجيات الكاملة |
| `convex/decisionJournal.ts` | 6 read-only queries للـ Decision Journal |
| `convex/coreQueries.ts` | Queries الرئيسية للنظام |
| `convex/mt5Bridge.ts` | Mutations لجمع بيانات MT5 |
| `convex/crons.ts` | Cron Jobs لتنظيف الجداول (Fix-2) |
| `convex/_generated/api.d.ts` | أنواع API المولَّدة |
| `convex/_generated/ai/guidelines.md` | إرشادات Convex AI |

### Library و Contracts

| الملف | الوصف |
|---|---|
| `src/lib/trading/shared/decision-contract.ts` | عقد بيانات Decision Journal (الأنواع) |
| `src/lib/constants/navigation.ts` | Navigation للتطبيق |
| `src/lib/mt5-bridge/index.ts` | MT5 bridge utilities |
| `src/lib/gold/gold-profile.ts` | GOLD_PROFILE ثوابت رمز XAUUSD |
| `src/components/lab/StrategyCompliancePanel.tsx` | لجنة الاستراتيجية — Section 7.3 |

### Python Service

| الملف | الوصف |
|---|---|
| `mt5_readonly_service/main.py` | FastAPI — Read-only bridge — port 8010 |

---

## 6. الملفات المحمية — ممنوع تعديلها

> أي تعديل على هذه الملفات يحتاج موافقة صريحة مكتوبة من أحمد.

| الملف | السبب |
|---|---|
| `convex/technicalIndicators.ts` | Stage 5A — محرك المؤشرات الفنية |
| `mt5_readonly_service/main.py` | Stage 5A — جسر MT5 Read-only |
| `src/app/api/lab/analyze-preview/route.ts` | Stage 5A — تحليل مسبق |
| `.env.local` | أسرار البيئة — لا تُلمس أبداً |
| `convex/schema.ts` | يُعدَّل فقط بمرحلة صريحة + codegen |

---

## 7. القواعد الصارمة

### ممنوعات تنفيذ التداول
- ❌ ممنوع `order_send` في أي ملف
- ❌ ممنوع `order_close / order_modify / order_delete`
- ❌ ممنوع `pending orders` حقيقية
- ❌ ممنوع تمكين `tradingEnabled: true` أو إلغاء `readOnly: true`
- ❌ ممنوع أي execution قبل Stage 14 بموافقة صريحة

### ممنوعات OKX
- ❌ ممنوع OKX API حقيقي الآن
- ❌ ممنوع Futures / Leverage
- ❌ ممنوع Live Trading على OKX

### ممنوعات Convex
- ❌ ممنوع تمرير `userId` من الواجهة إلى أي query أو mutation
- ❌ Convex queries تعتمد على `ctx.auth.getUserIdentity()` فقط
- ❌ ممنوع `delete` على أي decision run
- ❌ ممنوع `update` حر على القرارات
- ❌ ممنوع mutations في Decision Journal إلا بمرحلة صريحة

### ممنوعات عامة
- ❌ ممنوع تخزين أسرار أو API keys في الكود
- ❌ ممنوع خلط MT5 و OKX في نفس الملف أو الـ document
- ❌ ممنوع push بدون موافقة أحمد

---

## 8. قواعد Git

| القاعدة | التفصيل |
|---|---|
| `git status` قبل البدء | تأكد من نظافة الـ working tree |
| لا commit قبل typecheck | `pnpm exec tsc --noEmit` يجب أن يكون `EXIT:0` |
| لا commit قبل build | `pnpm run build` يجب أن ينجح |
| كل مرحلة commit منفصل | لا خلط docs مع code مع schema |
| لا push بدون موافقة | أحمد يراجع ويوافق قبل كل push |
| commit message واضح | مثال: `stage A12: ...` أو `docs: ...` |

---

## 9. أوامر الفحص الإلزامية

```bash
# TypeScript check — يجب EXIT:0
pnpm exec tsc --noEmit

# Build — يجب نجاح جميع الصفحات
pnpm run build

# Git status
git status --short

# Python compile check (إذا عُدِّل main.py)
python -m py_compile mt5_readonly_service/main.py
```

---

## 10. أوامر التشغيل

```bash
# Next.js development
pnpm dev

# MT5 Python bridge (Windows فقط — يحتاج MetaTrader 5 مفتوح)
cd mt5_readonly_service
uvicorn main:app --host 127.0.0.1 --port 8010 --reload

# Convex codegen (يحتاج auth)
pnpm exec convex codegen
```

---

## 11. خريطة وثائق docs/

| المسار | الموضوع |
|---|---|
| `docs/README.md` | فهرس كل الوثائق |
| `docs/architecture/LAB_BOUNDARIES.md` | حدود MT5/OKX المعمارية |
| `docs/decision-journal/DATA_CONTRACT.md` | عقد بيانات القرارات |
| `docs/decision-journal/CONVEX_SCHEMA_PLAN.md` | خطة Convex Schema |
| `docs/roadmap/ROADMAP.md` | خارطة الطريق |
| `docs/roadmap/TASKS.md` | قائمة المهام |
| `docs/reviews/BACKEND_REVIEW.md` | مراجعة Backend |
| `docs/reviews/FRONTEND_REVIEW.md` | مراجعة Frontend |
| `docs/reviews/MT5_REVIEW.md` | مراجعة MT5 |
| `docs/trading/OKX_PLAN.md` | خطة OKX |
| `docs/security/SECURITY_REVIEW.md` | مراجعة الأمان |
| `docs/agent/AGENT_TEAM.md` | فريق الوكلاء |
| `docs/archive/` | وثائق تاريخية — للمرجع فقط |

---

## 12. تعليمات لأي وكيل يبدأ العمل

### الخطوات الإلزامية قبل أي تعديل:

1. اقرأ `PROJECT_CONTEXT.md` (هذا الملف).
2. اقرأ `AGENTS.md` و `AGENT_RULES.md`.
3. اقرأ `docs/README.md`.
4. اقرأ `convex/_generated/ai/guidelines.md` إذا كنت ستعدل Convex.
5. شغّل `git status --short` وتأكد من نظافة الـ working tree.
6. حدّد الملفات المسموح تعديلها والملفات المحمية.
7. نفّذ التغيير الأدنى المطلوب فقط.
8. شغّل `pnpm exec tsc --noEmit` و `pnpm run build`.
9. قدّم تقريراً بالعربية يشمل الملفات المعدَّلة، نتائج الفحص، وgit status.
10. انتظر موافقة أحمد قبل commit أو push.

---

*هذا الملف يُحدَّث في نهاية كل مرحلة رئيسية.*
