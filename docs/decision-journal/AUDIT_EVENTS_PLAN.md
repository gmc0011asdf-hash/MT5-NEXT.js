# AUDIT_EVENTS_PLAN.md
# خطة سجل أحداث التدقيق — decisionAuditEvents

> **المرحلة:** A12 — توثيق الخطة فقط — لا تعديل في Convex  
> **الحالة:** Plan  
> **آخر تحديث:** 2026-05-04  
> **الجداول المعنية:** `decisionAuditEvents` (مُعرَّف في `convex/schema.ts`)  
> **الـ Queries الموجودة:** `listAuditEventsByDecision` في `convex/decisionJournal.ts`

---

## 1. الهدف من decisionAuditEvents

### ما هو سجل التدقيق؟

`decisionAuditEvents` هو جدول **Append-only** (للإضافة فقط) يُوثّق كل حدث يطرأ على قرار تحليلي بعد إنشائه.

### المبادئ الأساسية

| المبدأ | التفصيل |
|---|---|
| **Append-only** | كل سجل يُضاف مرة واحدة فقط — لا تعديل، لا حذف |
| **توثيق الأحداث** | يُسجَّل ما حدث للقرار بعد إنشائه بشكل زمني تسلسلي |
| **لا تعديل مباشر** | أي تغيير في حالة القرار يُسجَّل كـ event ولا يُعدَّل `decisionRuns` مباشرة |
| **Immutable History** | التاريخ الكامل لكل قرار محفوظ ولا يُمكن طمسه |
| **Read-only فقط** | لا ينفذ تداول — لا يُصدر أوامر — لا يُرسل بيانات للـ broker |
| **للتحليل فقط** | سجل أحداث تحليلية بحتة — لأغراض مراجعة القرارات فقط |

### ما لا يفعله سجل التدقيق

- ❌ **لا ينفذ تداول** — لا `order_send` ولا ما يعادله
- ❌ **لا يغير القرار الأصلي** — `decisionRuns` يبقى كما هو
- ❌ **لا يحذف سجلات** — Append-only بدون استثناء
- ❌ **لا يُعدَّل بعد الإنشاء** — كل event ثابت بعد `insert`
- ❌ **لا يقبل userId من الواجهة** — يُستخرج دائماً من `ctx.auth`
- ❌ **لا يخزن أسرار** — لا API keys، لا passwords، لا tokens

---

## 2. أنواع الأحداث المقترحة

### قائمة eventType المعتمدة

| نوع الحدث | المعنى | من يُولّده |
|---|---|---|
| `CREATED` | تم إنشاء القرار للمرة الأولى | `system` |
| `STATUS_CHANGED` | تغيّرت حالة القرار من status إلى status آخر | `system` أو `agent` |
| `REVIEWED` | تمت مراجعة القرار من قبل وكيل أو محرك تحليل | `agent` |
| `EXPIRED` | انتهت صلاحية القرار (`expiresAt` تجاوز الوقت الحالي) | `system` |
| `BLOCKED` | تم تصنيف القرار كـ BLOCK بعد تقييم اللجان | `agent` |
| `HELD` | تم تعليق القرار في وضع HOLD | `agent` |
| `NOTE_ADDED` | تمت إضافة ملاحظة تحليلية نصية | `agent` |
| `SYSTEM_REVIEW` | مراجعة تلقائية أجراها النظام دورياً | `system` |
| `RISK_RECHECK` | أُعيد فحص المخاطرة بعد تغير أسعار السوق | `system` أو `agent` |
| `DATA_REFRESHED` | تم تحديث بيانات السوق المرتبطة بالقرار | `system` |

### قواعد eventType

- كل `eventType` يجب أن يكون من القائمة أعلاه فقط.
- لا تُضاف أنواع حدث جديدة بدون توثيق وموافقة.
- `CREATED` يُولَّد تلقائياً عند إنشاء القرار — لا يُرسَل من الواجهة.
- `STATUS_CHANGED` يتطلب وجود `fromStatus` و`toStatus` معاً.
- `NOTE_ADDED` يتطلب وجود `message` غير فارغ.

---

## 3. القواعد الأمنية

### قواعد البيانات (Immutability)

| القاعدة | التفصيل |
|---|---|
| **لا `delete` على audit event** | ممنوع وجود mutation يحذف أي event من `decisionAuditEvents` |
| **لا `update` على audit event** | ممنوع تعديل أي حقل في event بعد إنشائه |
| **كل حدث `insert-only`** | الوحيد المسموح هو إضافة event جديد — لا عملية أخرى |
| **لا `collect()` على الجدول** | استخدم `.take(limit)` بحد أقصى 100 — لا `.collect()` على الجداول الكبيرة |

### قواعد المصادقة (Authentication)

| القاعدة | التفصيل |
|---|---|
| **`userId` من `ctx.auth` فقط** | ممنوع قبول `userId` كـ argument من الواجهة |
| **`requireUserId(ctx)` إلزامي** | كل handler يبدأ باستخراج `userId` من `ctx.auth.getUserIdentity().subject` |
| **Multi-Tenant isolation** | كل event مربوط بـ `userId` — لا يرى مستخدم بيانات مستخدم آخر |

### قواعد التحقق من الملكية

| القاعدة | التفصيل |
|---|---|
| **تحقق من `decisionId`** | قبل إضافة أي event، يجب التحقق أن `decisionId` موجود في `decisionRuns` |
| **تحقق من الملكية** | القرار يجب أن يخص المستخدم الحالي (`row.userId === userId`) |
| **منع إضافة events على قرارات الآخرين** | إذا `row.userId !== userId` → رفض العملية |

### قواعد المحتوى

| القاعدة | التفصيل |
|---|---|
| **لا تنفيذ تداول** | ممنوع وجود أي منطق execution في `createDecisionAuditEvent` |
| **لا تخزين أسرار** | ممنوع تخزين API keys أو passwords في حقل `message` |
| **لا OKX API حقيقي** | `triggeredBy` لا يتضمن OKX credentials |
| **لا userId في `message`** | لا تُكتب قيمة `userId` في نص الـ `message` |

---

## 4. شكل mutation مستقبلية مقترحة — بدون تنفيذ الآن

> **تحذير:** هذا القسم للتوثيق فقط — لا يوجد كود تنفيذي.  
> لا تُنفَّذ هذه الـ mutation قبل A13 والموافقة الصريحة من أحمد.

### `createDecisionAuditEvent` — الـ mutation المقترحة

```typescript
// ⚠️ هذا الكود للتوثيق فقط — لا تُنفَّذه قبل A13
export const createDecisionAuditEvent = mutation({
  args: {
    decisionId:  v.string(),           // مرجع القرار — إلزامي
    eventType:   v.string(),           // من قائمة الأحداث المعتمدة
    fromStatus:  v.optional(v.string()), // الحالة قبل التغيير — اختياري
    toStatus:    v.optional(v.string()), // الحالة بعد التغيير — اختياري
    message:     v.string(),           // وصف الحدث — إلزامي
    triggeredBy: v.string(),           // "system" | "agent" | "lab-analysis"
    // ❌ لا userId في args — يُستخرج من ctx.auth
  },
  handler: async (ctx, args) => {
    // ── 1. استخراج userId من Clerk — ليس من args ──
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("يجب تسجيل الدخول");
    const userId = identity.subject;

    // ── 2. التحقق من وجود القرار وملكيته ──
    const decision = await ctx.db
      .query("decisionRuns")
      .withIndex("by_decisionId", (q) => q.eq("decisionId", args.decisionId))
      .first();
    if (!decision || decision.userId !== userId) {
      throw new ConvexError("القرار غير موجود أو لا تملك صلاحية الوصول إليه");
    }

    // ── 3. إضافة event فقط — Append-only ──
    await ctx.db.insert("decisionAuditEvents", {
      decisionId:  args.decisionId,
      userId,                          // من ctx.auth — ليس من args
      eventType:   args.eventType,
      fromStatus:  args.fromStatus,
      toStatus:    args.toStatus,
      message:     args.message,
      triggeredBy: args.triggeredBy,
      createdAt:   Date.now(),
      // ❌ لا delete — لا update — لا executeTrade — لا order_send
    });
  },
});
```

### ما يجب ألا تفعله هذه الـ mutation

- ❌ لا تقبل `userId` كـ argument
- ❌ لا تعدل `decisionRuns` مباشرة
- ❌ لا تحذف أي سجل
- ❌ لا تنفذ تداول
- ❌ لا تخزن أسرار
- ❌ لا تتصل بـ OKX API الحقيقي
- ❌ لا تقبل events بدون التحقق من ملكية `decisionId`

---

## 5. الـ Query الحالية — listAuditEventsByDecision

### الحالة الراهنة

`listAuditEventsByDecision` موجودة بالفعل في [convex/decisionJournal.ts](../../convex/decisionJournal.ts) (السطور 161–176).

### كيف تعمل الـ Query

```typescript
// موجودة بالفعل في convex/decisionJournal.ts — لا تعدّلها
export const listAuditEventsByDecision = query({
  args: {
    decisionId: v.string(),
    limit:      v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);   // userId من ctx.auth
    const limit = clampLimit(args.limit);      // max 100
    const rows = await ctx.db
      .query("decisionAuditEvents")
      .withIndex("by_decisionId", (q) => q.eq("decisionId", args.decisionId))
      .order("desc")
      .collect();
    return rows.filter((r) => r.userId === userId).slice(0, limit);
    // ↑ Multi-Tenant: يُرجع فقط events المستخدم الحالي
  },
});
```

### ضمانات الأمان في الـ Query الحالية

| الضمان | كيف يُطبَّق |
|---|---|
| **Read-only** | `query` — لا `mutation` |
| **userId من ctx.auth** | `requireUserId(ctx)` يستخرجه من Clerk server-side |
| **لا userId في args** | `args` لا يحتوي على `userId` |
| **Multi-Tenant** | `.filter((r) => r.userId === userId)` يُصفَّح فقط events المستخدم |
| **حد على النتائج** | `clampLimit` يمنع إرجاع أكثر من 100 سجل |
| **لا collect() غير مقيد** | `collect()` يتبعه `.filter().slice(limit)` — البيانات ليست هائلة في عداد الأحداث لقرار واحد |

---

## 6. العلاقة مع Decision Journal UI

### الوضع الحالي (A12)

صفحة [decision-journal/page.tsx](../../src/app/(dashboard)/decision-journal/page.tsx) هي:
- ✅ Client Component (`"use client"`)
- ✅ تستخدم `useQuery(api.decisionJournal.listMyDecisions)` فقط
- ✅ لا `useMutation` — لا API routes تنفيذية
- ✅ لا أزرار تنفيذ تداول
- ✅ بانر Read-only واضح بالعربية
- ✅ `userId` لا يُمرَّر من الواجهة

### ما لن يُضاف في هذه المرحلة

- ❌ لا زر "إضافة ملاحظة"
- ❌ لا زر "تغيير الحالة"
- ❌ لا زر "تنفيذ"
- ❌ لا زر "حذف"
- ❌ لا `useMutation` من هذه الصفحة

### ما يُمكن إضافته لاحقاً (بعد A14 وموافقة أحمد)

- ✅ Modal أو Drawer لعرض audit events لقرار محدد (قراءة فقط)
- ✅ Timeline مرئي يعرض تسلسل الأحداث
- ✅ `useQuery(api.decisionJournal.listAuditEventsByDecision, { decisionId })` من drawer
- ❌ لا يزال ممنوع أي mutation من الواجهة بدون مرحلة صريحة

---

## 7. خطة مستقبلية

> **ملاحظة:** كل مرحلة أدناه تحتاج موافقة صريحة مكتوبة من أحمد قبل التنفيذ.

### A13 — إنشاء mutation Append-only (بانتظار موافقة أحمد)

**الهدف:** إضافة `createDecisionAuditEvent` في `convex/decisionJournal.ts`

**المطلوب للموافقة:**
- تأكيد أن A12 مكتملة ومعتمدة
- تحديد: من يُولّد الأحداث؟ (system فقط أم يشمل agent؟)
- تحديد: هل يُسمح بـ NOTE_ADDED من الواجهة في هذه المرحلة؟

**القواعد الإلزامية في A13:**
- mutation تقبل فقط الـ args المحددة في القسم 4
- لا `userId` في args — من `ctx.auth` فقط
- التحقق من ملكية `decisionId` قبل الـ insert
- لا delete، لا update، لا تنفيذ تداول
- `pnpm exec tsc --noEmit` → EXIT:0
- `pnpm run build` → ناجح

---

### A14 — عرض Audit Events في UI (قراءة فقط) (بانتظار A13 + موافقة)

**الهدف:** إضافة Drawer أو Panel في صفحة Decision Journal لعرض أحداث قرار محدد

**الخطوات المقترحة:**
1. إضافة زر "عرض السجل" في كل صف من الجدول
2. فتح Drawer يعرض `listAuditEventsByDecision` بـ `decisionId` المحدد
3. عرض timeline الأحداث مع التوقيت والوصف
4. **لا mutation** في هذه الصفحة — قراءة فقط

**القواعد الإلزامية في A14:**
- لا `useMutation` في صفحة Decision Journal
- الـ drawer يستخدم `useQuery` فقط
- لا أزرار تنفيذ أو حذف
- Arabic RTL محفوظ

---

### A15 — توليد أحداث تلقائية عند حفظ قرارات التحليل (بانتظار A13 + A14 + موافقة)

**الهدف:** عند حفظ قرار جديد في `decisionRuns`، يُولَّد تلقائياً حدث `CREATED` في `decisionAuditEvents`

**الآلية المقترحة:**
- mutation `createDecisionRun` (مستقبلية) تستدعي `ctx.db.insert("decisionAuditEvents", ...)` في نفس الـ transaction
- أو: استخدام Convex Actions لتوليد الأحداث التلقائية بعد الـ insert

**القواعد الإلزامية في A15:**
- كل قرار جديد يُولّد event واحد من نوع `CREATED` تلقائياً
- لا تنفيذ تداول في أي مرحلة من هذا المسار
- `triggeredBy = "system"` للأحداث التلقائية
- لا OKX API حقيقي

---

### ما لن يُنفَّذ في هذه المراحل (A12 → A15)

- ❌ لا تنفيذ تداول في أي مرحلة
- ❌ لا `order_send` / `order_close` / `order_modify`
- ❌ لا OKX API حقيقي
- ❌ لا Futures / Leverage
- ❌ لا حذف audit events
- ❌ لا تعديل audit events

---

## 8. Definition of Done — A12

### ما يُشكّل اكتمال A12

| المعيار | الحالة المطلوبة |
|---|---|
| **ملف توثيق فقط** | ✅ `docs/decision-journal/AUDIT_EVENTS_PLAN.md` موجود |
| **لا code changes** | ✅ لا تعديل في أي ملف `.ts` أو `.tsx` |
| **لا schema changes** | ✅ `convex/schema.ts` لم يُعدَّل |
| **لا mutations** | ✅ لا mutation جديدة في `convex/decisionJournal.ts` |
| **لا API** | ✅ لا API route جديدة |
| **لا تعديل واجهة** | ✅ `decision-journal/page.tsx` لم يُعدَّل |
| **لا لمس Stage 5A** | ✅ `convex/technicalIndicators.ts`، `main.py`، `analyze-preview/route.ts` سليمة |
| **`tsc --noEmit` ناجح** | `pnpm exec tsc --noEmit` → EXIT:0 |
| **`build` ناجح** | `pnpm run build` → ناجح |
| **git status يعرض الملف فقط** | `?? docs/decision-journal/AUDIT_EVENTS_PLAN.md` فقط |

### ما لا يُعدّ جزءاً من A12

- ❌ تنفيذ `createDecisionAuditEvent` → يخص A13
- ❌ ربط UI بعرض audit events → يخص A14
- ❌ توليد أحداث تلقائية → يخص A15
- ❌ commit → ينتظر موافقة أحمد
- ❌ push → ينتظر موافقة أحمد

---

## مرجع سريع — الملفات المرتبطة

| الملف | الوصف | الحالة |
|---|---|---|
| `convex/schema.ts` | `decisionAuditEvents` مُعرَّف السطر ~180 | موجود — لا تعدّله |
| `convex/decisionJournal.ts` | `listAuditEventsByDecision` في السطر 161 | موجود — read-only |
| `src/app/(dashboard)/decision-journal/page.tsx` | الصفحة — لا mutation | موجود — لا تعدّله |
| `docs/decision-journal/DATA_CONTRACT.md` | عقد بيانات القرارات | مرجع |
| `docs/decision-journal/CONVEX_SCHEMA_PLAN.md` | خطة Schema التفصيلية | مرجع |

---

*هذا الملف توثيق خطة مستقبلية — لا يحتوي على كود تنفيذي.*  
*لا تعديل في `convex/decisionJournal.ts` أو `convex/schema.ts` قبل الموافقة على A13.*  
*المرحلة التالية المقترحة: A13 — إنشاء createDecisionAuditEvent Append-only.*
