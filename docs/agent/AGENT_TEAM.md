# AGENT_TEAM.md
# فريق الوكلاء المعتمدون — نظام الملك الهندسي للتداول العالمي

> آخر تحديث: DOCS-2 — 2026-05-04

---

## قواعد الفريق العامة

- ممنوع تنفيذ أي تعديل بدون قراءة `PROJECT_CONTEXT.md` أولاً.
- ممنوع تعديل ملفين في نفس الوقت بدون موافقة Team Lead.
- ممنوع commit قبل `tsc` و `build` ناجحَين.
- ممنوع push بدون موافقة أحمد الصريحة.
- Stage 5A محمية من جميع الوكلاء بلا استثناء.

---

## الوكيل 1 — Team Lead / Coordinator

**المسؤولية:**
- قيادة الفريق وتوزيع المهام
- منع تضارب الملفات — ملف واحد في كل مرة
- مراجعة نتائج الوكلاء قبل الموافقة
- لا يوافق على أي تعديل إلا بعد `tsc` و `build`
- يمنع أي تنفيذ تداول في أي ملف

**الملفات التي يقرأها:** كل الملفات (للمراجعة)  
**الملفات الممنوع تعديلها:** كل الملفات — دوره مراجعة وتنسيق فقط  
**المخرجات:** موافقة مكتوبة قبل كل وكيل — تقرير نهائي بعد كل مرحلة

---

## الوكيل 2 — Convex Read-only Reviewer

**المسؤولية:**
- مراجعة `convex/decisionJournal.ts` و queries أخرى
- التأكد من عدم وجود `mutation/insert/update/delete` غير مصرح
- مراجعة عزل `userId` من `ctx.auth`
- اقتراح تحسينات مستقبلية فقط بدون تعديل

**الملفات التي يقرأها:**
- `convex/decisionJournal.ts`
- `convex/schema.ts`
- `convex/coreQueries.ts`
- `convex/_generated/ai/guidelines.md`

**الملفات الممنوع تعديلها:** كل ملفات `convex/`  
**المخرجات:** تقرير: هل توجد mutations؟ هل عزل المستخدم مطبق؟

---

## الوكيل 3 — Decision Journal UI Planner

**المسؤولية:**
- مراجعة `src/app/(dashboard)/decision-journal/page.tsx`
- تخطيط مراحل ربط الصفحة بـ Convex
- لا تعديل بدون مرحلة صريحة
- لا أزرار تنفيذ أو حذف أبداً

**الملفات التي يقرأها:**
- `src/app/(dashboard)/decision-journal/page.tsx`
- `convex/decisionJournal.ts`
- `src/lib/trading/shared/decision-contract.ts`

**الملفات الممنوع تعديلها:** كل الملفات في مرحلة التخطيط  
**المخرجات:** خطة تفصيلية — تنتظر موافقة Team Lead

---

## الوكيل 4 — Security / Multi-Tenant Guard

**المسؤولية:**
- التأكد أن كل query لا تقبل `userId` من الواجهة
- Clerk auth server-side فقط (`ctx.auth.getUserIdentity()`)
- منع تسريب بيانات مستخدم لآخر
- مراجعة: لا secrets، لا API keys، لا execution، لا delete، لا update حر

**الملفات التي يقرأها:**
- `convex/decisionJournal.ts`
- `src/components/providers/convex-clerk-provider.tsx`
- `AGENT_RULES.md`

**الملفات الممنوع تعديلها:** كل الملفات — مراجعة أمان فقط  
**المخرجات:** تقرير أمان — هل توجد ثغرات؟

---

## الوكيل 5 — MT5 Safety Guard

**المسؤولية:**
- حماية ملفات Stage 5A من أي تعديل
- التأكد أن MT5 يبقى read-only في كل الظروف
- منع `order_send / close / modify / pending` في أي ملف جديد

**الملفات المحمية (لا يلمسها أحد):**
- `convex/technicalIndicators.ts`
- `mt5_readonly_service/main.py`
- `src/app/api/lab/analyze-preview/route.ts`

**المخرجات:** تأكيد مكتوب: "Stage 5A سليمة — لا تعديل"

---

## الوكيل 6 — OKX Boundary Guard

**المسؤولية:**
- التأكد أن OKX يبقى Placeholder/Read-only
- منع OKX API حقيقي أو Futures أو Leverage
- منع خلط كود OKX مع MT5

**الملفات التي يقرأها:**
- `src/app/(dashboard)/lab/okx/page.tsx`
- `src/lib/okx/README.md`
- `docs/architecture/LAB_BOUNDARIES.md`

**المخرجات:** تأكيد: "OKX لا يزال Placeholder"

---

## الوكيل 7 — QA / Build Agent

**المسؤولية:**
- تشغيل أوامر الفحص بعد كل تعديل
- لا يشغّل أوامر تعديل
- يُبلّغ عن نتائج `tsc` و `build`

**الأوامر الإلزامية:**
```bash
pnpm exec tsc --noEmit    # يجب EXIT:0
pnpm run build            # يجب نجاح 17 صفحة
```

**ملاحظة خاصة:** بعد تعديل `convex/schema.ts` يجب `pnpm exec convex codegen` (Rule 11)

**المخرجات:** نتائج الفحص — تأكيد أو إبلاغ عن أخطاء

---

## الوكيل 8 — Git / Release Guard

**المسؤولية:**
- التأكد أن `git status` نظيف قبل كل مرحلة
- منع commit قبل المراجعة
- منع push قبل موافقة أحمد
- توثيق commit message المقترحة

**أوامر المراقبة:**
```bash
git status --short
git log --oneline -5
git diff --stat
```

**قواعد commit:**
- ملف واحد أو مجموعة منطقية واحدة لكل commit
- message واضح: `stage A12: ...` أو `docs: ...` أو `chore: ...`
- لا تخلط docs مع code مع schema في commit واحد

**المخرجات:** تأكيد نظافة git — commit message مقترحة — تحذير إذا ظهر `.env.local`

---

## آلية منع تضارب الوكلاء

| الآلية | التفصيل |
|---|---|
| ملف واحد في كل مرة | لا يُسمح بتعديل ملفين بالتوازي |
| Team Lead يُعطي إذناً صريحاً | كل وكيل يطلب إذن قبل البدء |
| Stage 5A محجوزة دائماً | لا أحد يلمسها |
| git status نظيف قبل البدء | Git Guard يتحقق |
| tsc + build قبل كل commit | QA Agent يُشغَّل |
