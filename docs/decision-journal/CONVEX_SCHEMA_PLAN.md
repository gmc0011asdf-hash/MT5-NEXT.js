# CONVEX_DECISION_JOURNAL_SCHEMA_PLAN.md
# خطة Convex Schema لـ Decision Journal

> **المرحلة:** A8 — توثيق الخطة فقط — لا تعديل في Convex  
> **الحالة:** Draft — قيد المراجعة  
> **آخر تحديث:** 2026-05-04  
> **ملف العقد:** `src/lib/trading/shared/decision-contract.ts`

---

## أ. الهدف من ربط Decision Journal مع Convex لاحقًا

الهدف من إضافة Decision Journal إلى Convex في مرحلة مستقبلية هو:

1. **استبدال بيانات Placeholder** الحالية ببيانات حقيقية ثابتة مخزّنة في قاعدة البيانات.
2. **توحيد مصدر الحقيقة:** كل قرار تحليلي صادر عن اللجان يُخزَّن مرة واحدة في Convex ويُقرأ من أي صفحة.
3. **المزامنة الفورية (Reactivity):** Convex يدعم real-time subscriptions، فتُحدَّث صفحة Decision Journal تلقائياً عند وصول قرار جديد.
4. **عزل المستخدمين (Multi-Tenant):** كل مستخدم يرى قراراته فقط عبر ربط `userId` بـ `identity.subject` من Clerk.
5. **سجل تدقيق دائم (Immutable Audit Log):** كل قرار يُسجَّل مرة ولا يُحذف ولا يُعدَّل — فقط تُضاف أحداث audit.
6. **الاستعلام والتصفية:** إمكانية تصفية القرارات حسب المنصة، الرمز، الإطار الزمني، والحالة عبر Indexes محسوبة.
7. **تطبيق قواعد الحوكمة:** Decision Journal يكون جزءاً من منظومة `governanceState` الموجودة في Convex — بدون تنفيذ تداول.

---

## ب. لماذا لا نعدل Schema الآن في A8؟

### الأسباب التقنية

| السبب | التفصيل |
|---|---|
| **استقرار العقد أولاً** | `DecisionJournalEntry` في `decision-contract.ts` مستقر منذ A6، لكن يجب التحقق من عدم وجود تعديلات قادمة قبل كتابة validators |
| **لا validators مكتوبة بعد** | كل حقل في الـ schema يحتاج `v.string()` أو `v.number()` دقيق — وهذا يتطلب مراجعة كل نوع في العقد |
| **نمط الـ `userId` الحالي** | الـ schema الحالي يستخدم `userId` (= `identity.subject`) وليس `clerkUserId` — يجب الاتساق مع هذا النمط |
| **لا queries أو mutations جاهزة** | الـ Schema وحده بدون queries لا معنى له — يجب تصميمهما معاً في A9/A10 |
| **خطر migration مبكر** | إضافة جداول ناقصة ثم تعديلها يُنشئ migrations غير ضرورية في Convex |

### الأسباب المعمارية

- مبدأ "Design First" — التوثيق الكامل قبل الكود يمنع الأخطاء.
- Stage 5A محمية ولا يجب أن يتداخل أي تعديل schema مع عمل `technicalIndicators.ts`.
- تغيير الـ schema في Convex يُحدِّث `_generated/dataModel.d.ts` تلقائياً — أي تغيير يجب أن يكون متعمداً ومختبراً.

---

## ج. الـ Collections المقترحة

يُقترح تقسيم `DecisionJournalEntry` الواحد إلى **خمسة جداول منفصلة** بدلاً من جدول واحد ضخم:

```
DecisionJournalEntry
    ├── الحقول الأساسية  ──→  decisionRuns          (الجدول الرئيسي)
    ├── committees[]     ──→  committeeResults       (سجل لكل لجنة)
    ├── risk             ──→  decisionRiskSnapshots  (لقطة المخاطرة)
    ├── review           ──→  decisionReviewSchedules (جدول المراجعة)
    └── audit trail      ──→  decisionAuditEvents    (سجل الأحداث)
```

### لماذا التقسيم؟

- يُخفف حجم document الرئيسي في `decisionRuns`.
- يُسهل الاستعلام عن لجنة بعينها أو مراجعة بعينها.
- يُطبّق مبدأ immutability بشكل منفصل على كل collection.
- يتوافق مع نمط `committeeReports` و`auditEvents` الموجودَين في الـ schema الحالي.

---

## د. الحقول المقترحة لكل Collection

---

### 1. `decisionRuns` — الجدول الرئيسي

يُخزَّن فيه كل القرار التحليلي الأساسي:

```typescript
defineTable({
  // ─── هوية القرار ───────────────────────────────────────
  decisionId:          v.string(),          // UUID فريد — مرجع مشترك لكل الجداول
  platform:            v.string(),          // "MT5" | "OKX"
  symbol:              v.string(),          // "XAUUSD"
  timeframe:           v.string(),          // "H1" | "M15" | "H4" | "D1"

  // ─── حالة الإشارة والقرار ──────────────────────────────
  status:              v.string(),          // SignalStatus
  finalDecision:       v.string(),          // "BUY" | "SELL" | "HOLD" | "BLOCK"
  grade:               v.string(),          // "A+" | "A" | "B" | "C" | "D"
  probability:         v.number(),          // 0–100

  // ─── أسعار التحليل ─────────────────────────────────────
  entryPrice:          v.number(),
  invalidationPrice:   v.number(),
  reason:              v.string(),          // ملخص القرار

  // ─── Multi-Tenant ───────────────────────────────────────
  userId:              v.string(),          // = identity.subject من Clerk
                                            // (نفس نمط باقي جداول الـ schema)

  // ─── توقيت ─────────────────────────────────────────────
  createdAt:           v.number(),          // Unix ms
  updatedAt:           v.number(),          // Unix ms

  // ─── أمان ──────────────────────────────────────────────
  readOnly:            v.boolean(),         // دائماً true — يُحقق من server-side
  source:              v.string(),          // "decision-journal-v1"
})
```

---

### 2. `committeeResults` — نتائج اللجان

سجل منفصل لكل لجنة في كل قرار:

```typescript
defineTable({
  // ─── الربط ──────────────────────────────────────────────
  decisionId:     v.string(),    // مرجع إلى decisionRuns.decisionId
  userId:         v.string(),    // للـ Multi-tenant isolation

  // ─── بيانات اللجنة ──────────────────────────────────────
  committeeId:    v.string(),    // "trend-committee" | "risk-committee" | ...
  committeeName:  v.string(),    // "لجنة الاتجاه" | "لجنة المخاطرة"
  verdict:        v.string(),    // "PASS" | "WARN" | "BLOCK" | "INFO"
  score:          v.number(),    // 0–100
  summary:        v.string(),
  reasons:        v.array(v.string()),

  // ─── توقيت ──────────────────────────────────────────────
  createdAt:      v.number(),
})
```

> **ملاحظة:** يتوافق مع `committeeReports` الموجود — لكنه مخصص لـ Decision Journal
> وليس لـ Lab Signal Snapshots.

---

### 3. `decisionRiskSnapshots` — لقطة المخاطرة

لقطة ثابتة تُنشأ مرة واحدة ولا تُعدَّل:

```typescript
defineTable({
  // ─── الربط ──────────────────────────────────────────────
  decisionId:       v.string(),
  userId:           v.string(),

  // ─── بيانات المخاطرة ────────────────────────────────────
  riskUsd:          v.number(),
  riskPercent:      v.number(),
  estimatedLot:     v.number(),
  stopLoss:         v.number(),
  takeProfit1:      v.number(),
  takeProfit2:      v.optional(v.number()),
  takeProfit3:      v.optional(v.number()),
  rewardRiskRatio:  v.number(),
  marginSafe:       v.boolean(),

  // ─── توقيت ──────────────────────────────────────────────
  createdAt:        v.number(),
})
```

> **قاعدة:** لا يوجد `updateRiskSnapshot` — هذه لقطة تاريخية ثابتة.

---

### 4. `decisionReviewSchedules` — جدول المراجعة

يخزّن جدول المتابعة الزمنية ويدعم الاستعلام بـ timestamp:

```typescript
defineTable({
  // ─── الربط ──────────────────────────────────────────────
  decisionId:         v.string(),
  userId:             v.string(),

  // ─── بيانات المراجعة ────────────────────────────────────
  criticalTimeframe:  v.string(),
  nextReviewAt:       v.number(),    // Unix ms — مُفهرَس للاستعلام الزمني
  expiresAt:          v.number(),    // Unix ms — مُفهرَس للاستعلام الزمني
  reviewReason:       v.string(),
  monitoringMode:     v.string(),    // "active" | "passive" | "paused"

  // ─── توقيت ──────────────────────────────────────────────
  createdAt:          v.number(),
  updatedAt:          v.number(),
})
```

> **ملاحظة:** `nextReviewAt` و`expiresAt` يُخزَّنان كـ `number` (Unix ms) بدلاً من ISO string
> لأن Convex indexes لا تدعم الاستعلام الزمني على strings.

---

### 5. `decisionAuditEvents` — سجل التدقيق

سجل Append-only لكل حدث يطرأ على القرار:

```typescript
defineTable({
  // ─── الربط ──────────────────────────────────────────────
  decisionId:   v.string(),
  userId:       v.string(),

  // ─── الحدث ──────────────────────────────────────────────
  eventType:    v.string(),          // "CREATED" | "STATUS_CHANGED" | "EXPIRED"
                                     // | "REVIEWED" | "BLOCKED" | "HELD"
  fromStatus:   v.optional(v.string()),   // الحالة قبل التغيير
  toStatus:     v.optional(v.string()),   // الحالة بعد التغيير
  message:      v.string(),
  triggeredBy:  v.string(),          // "system" | "agent" | "lab-analysis"

  // ─── توقيت ──────────────────────────────────────────────
  createdAt:    v.number(),
})
```

> **قاعدة صارمة:** هذا الجدول للكتابة فقط في اتجاه واحد — لا `delete`، لا `update`.

---

## هـ. ربط كل سجل بالحقول الإلزامية

كل collection يجب أن يحتوي على الحقول التالية كحدٍّ أدنى:

| الحقل | النوع في Convex | الوصف |
|---|---|---|
| `userId` | `v.string()` | = `identity.subject` من Clerk — إلزامي في كل record |
| `platform` | `v.string()` | "MT5" \| "OKX" — لا خلط |
| `symbol` | `v.string()` | رمز الأداة المالية |
| `timeframe` | `v.string()` | الإطار الزمني |
| `createdAt` | `v.number()` | Unix ms — للفرز والفهرسة |
| `updatedAt` | `v.number()` | Unix ms — للتتبع الزمني |

> **سبب استخدام `userId` بدلاً من `clerkUserId`:**
> الـ schema الحالي يستخدم `userId` بشكل موحّد في جميع الجداول (انظر `mt5AccountSnapshots`,
> `mt5Candles`, `committeeReports`, ...). القيمة نفسها = `identity.subject` من Clerk.
> الاتساق مع النمط القائم أهم من الاسم المختلف.

---

## و. الفهارس Indexes المقترحة

### جدول `decisionRuns`

```typescript
.index("by_userId_createdAt",  ["userId", "createdAt"])
.index("by_userId_platform",   ["userId", "platform"])
.index("by_userId_symbol",     ["userId", "symbol"])
.index("by_userId_status",     ["userId", "status"])
.index("by_decisionId",        ["decisionId"])
```

### جدول `decisionReviewSchedules`

```typescript
.index("by_userId_nextReviewAt", ["userId", "nextReviewAt"])
.index("by_userId_expiresAt",    ["userId", "expiresAt"])
.index("by_decisionId",          ["decisionId"])
```

### جدول `committeeResults`

```typescript
.index("by_decisionId",        ["decisionId"])
.index("by_userId_createdAt",  ["userId", "createdAt"])
```

### جدول `decisionRiskSnapshots`

```typescript
.index("by_decisionId",        ["decisionId"])
.index("by_userId_createdAt",  ["userId", "createdAt"])
```

### جدول `decisionAuditEvents`

```typescript
.index("by_decisionId",        ["decisionId"])
.index("by_userId_createdAt",  ["userId", "createdAt"])
```

> **مبدأ التسمية:** جميع الفهارس تبدأ بـ `userId` في المجموعات المركّبة لضمان
> أن كل استعلام مقيّد بمستخدم محدد — يتوافق مع النمط في `by_userId_createdAt`
> الموجود في `labSignalSnapshots` و`technicalIndicatorSnapshots`.

---

## ز. قواعد العزل Multi-Tenant

### القاعدة الأساسية

```
كل مستخدم يرى بياناته فقط.
لا استعلام بدون userId.
لا mutation يقبل userId من الواجهة مباشرة.
```

### التطبيق في الكود

**الصحيح — استخراج userId من ctx.auth:**
```typescript
// في كل query و mutation
async function requireUserId(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("يجب تسجيل الدخول");
  return identity.subject; // هذا هو userId = clerkUserId
}

export const listMyDecisions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return ctx.db
      .query("decisionRuns")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});
```

**الممنوع — تمرير userId من الواجهة:**
```typescript
// ❌ ممنوع منعاً باتاً
export const listDecisions = query({
  args: { userId: v.string() }, // المستخدم يتحكم بـ userId = ثغرة أمنية
  handler: async (ctx, { userId }) => { ... },
});
```

**الممنوع — query بدون فلتر userId:**
```typescript
// ❌ ممنوع — يُرجع بيانات كل المستخدمين
const all = await ctx.db.query("decisionRuns").collect();
```

### الدالة `requireUserId` المقترحة

تتطابق مع النمط الموجود في `convex/coreQueries.ts`:

```typescript
async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("يجب تسجيل الدخول");
  return identity.subject;
}
```

---

## ح. قواعد الأمان

| القاعدة | التفصيل | كيف تُطبَّق |
|---|---|---|
| لا حذف قرارات | `decisionRuns` لا يُحذف منها أبداً | لا `deleteDecision` mutation |
| لا تعديل قرارات بعد الإنشاء | القرارات Immutable | `readOnly: true` في كل document |
| التعديل فقط عبر audit events | أي تغيير في الحالة يُسجَّل كـ event | Append-only في `decisionAuditEvents` |
| لا تنفيذ تداول | Decision Journal للتوثيق فقط | لا `executeTrade` function في هذه الملفات |
| لا تخزين أسرار | ممنوع تخزين API keys أو passwords | Convex للبيانات التحليلية فقط |
| لا تخزين API keys | OKX API key لا تُخزَّن في Convex | إذا احتجت OKX لاحقاً — environment variables فقط |
| لا خلط MT5 و OKX | كل قرار له `platform` واحدة | validator يتحقق من `platform` عند الإدراج |
| OKX read-only حاليًا | OKX Placeholder — لا بيانات حقيقية | لا mutation يقبل `platform: "OKX"` في المرحلة الحالية |
| Clerk auth server-side | `userId` يُستخرج من `ctx.auth` فقط | `requireUserId(ctx)` في كل handler |

---

## ط. علاقة العقد الحالي بالـ Schema المستقبلي

### خريطة التحويل

```
decision-contract.ts                    convex/schema.ts (مستقبلاً)
─────────────────────────────────────────────────────────────────
DecisionJournalEntry
  ├── id                      ──→   decisionRuns.decisionId
  ├── platform                ──→   decisionRuns.platform
  ├── symbol                  ──→   decisionRuns.symbol
  ├── timeframe               ──→   decisionRuns.timeframe
  ├── status                  ──→   decisionRuns.status
  ├── finalDecision           ──→   decisionRuns.finalDecision
  ├── grade                   ──→   decisionRuns.grade
  ├── probability             ──→   decisionRuns.probability
  ├── entryPrice              ──→   decisionRuns.entryPrice
  ├── invalidationPrice       ──→   decisionRuns.invalidationPrice
  ├── reason                  ──→   decisionRuns.reason
  ├── createdAt (ISO string)  ──→   decisionRuns.createdAt (number/Unix ms)
  ├── updatedAt (ISO string)  ──→   decisionRuns.updatedAt (number/Unix ms)
  ├── readOnly: true          ──→   decisionRuns.readOnly: v.boolean() = true
  │
  ├── committees: CommitteeResult[]
  │     ├── committeeId       ──→   committeeResults.committeeId
  │     ├── committeeName     ──→   committeeResults.committeeName
  │     ├── verdict           ──→   committeeResults.verdict
  │     ├── score             ──→   committeeResults.score
  │     ├── summary           ──→   committeeResults.summary
  │     └── reasons: string[] ──→   committeeResults.reasons: v.array(v.string())
  │
  ├── risk: DecisionRiskSnapshot
  │     ├── riskUsd           ──→   decisionRiskSnapshots.riskUsd
  │     ├── riskPercent       ──→   decisionRiskSnapshots.riskPercent
  │     ├── estimatedLot      ──→   decisionRiskSnapshots.estimatedLot
  │     ├── stopLoss          ──→   decisionRiskSnapshots.stopLoss
  │     ├── takeProfit1       ──→   decisionRiskSnapshots.takeProfit1
  │     ├── takeProfit2       ──→   decisionRiskSnapshots.takeProfit2 (optional)
  │     ├── takeProfit3       ──→   decisionRiskSnapshots.takeProfit3 (optional)
  │     ├── rewardRiskRatio   ──→   decisionRiskSnapshots.rewardRiskRatio
  │     └── marginSafe        ──→   decisionRiskSnapshots.marginSafe
  │
  └── review: ReviewSchedule
        ├── criticalTimeframe ──→   decisionReviewSchedules.criticalTimeframe
        ├── nextReviewAt      ──→   decisionReviewSchedules.nextReviewAt (number)
        ├── expiresAt         ──→   decisionReviewSchedules.expiresAt (number)
        ├── reviewReason      ──→   decisionReviewSchedules.reviewReason
        └── monitoringMode    ──→   decisionReviewSchedules.monitoringMode
```

### الحقول التي تحتاج Normalization

| الحقل في العقد | النوع الحالي | النوع في Convex | السبب |
|---|---|---|---|
| `createdAt` | `string` (ISO 8601) | `number` (Unix ms) | Convex indexes تعمل مع number فقط |
| `updatedAt` | `string` (ISO 8601) | `number` (Unix ms) | نفس السبب |
| `review.nextReviewAt` | `string` (ISO 8601) | `number` (Unix ms) | فهرسة `by_userId_nextReviewAt` |
| `review.expiresAt` | `string` (ISO 8601) | `number` (Unix ms) | فهرسة `by_userId_expiresAt` |
| `committees[]` | embedded array | جدول منفصل | الاستعلام المستقل عن كل لجنة |
| `risk` | embedded object | جدول منفصل | immutability مضمونة |
| `review` | embedded object | جدول منفصل | فهرسة الحقول الزمنية |

### كيف نحافظ على `readOnly: true` في Convex

```typescript
// في mutation الإضافة — server-side فقط
export const createDecisionRun = mutation({
  args: {
    // لا يوجد readOnly في args — يُضبَط دائماً على true في الـ handler
    decisionId: v.string(),
    platform: v.string(),
    // ...
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await ctx.db.insert("decisionRuns", {
      ...args,
      userId,
      readOnly: true,     // ← مُجبَر server-side — المستخدم لا يتحكم فيه
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
```

---

## ي. خطة التنفيذ المستقبلية المقترحة

### A9 — إنشاء Convex Schema فقط

**الهدف:** إضافة الجداول الخمسة إلى `convex/schema.ts`.

**الخطوات:**
1. إضافة `decisionRuns` إلى `defineSchema(...)`.
2. إضافة `committeeResults`.
3. إضافة `decisionRiskSnapshots`.
4. إضافة `decisionReviewSchedules`.
5. إضافة `decisionAuditEvents`.
6. تشغيل `pnpm exec tsc --noEmit` و`pnpm run build`.

**الممنوعات في A9:**
- لا queries.
- لا mutations.
- لا ربط بالواجهة.
- لا تعديل على الجداول الموجودة.

---

### A10 — إنشاء Read-only Queries فقط

**الهدف:** كتابة queries للقراءة — لا كتابة، لا تعديل.

**الملف المقترح:** `convex/decisionJournal.ts`

**Queries المقترحة:**
- `listMyDecisions` — قائمة القرارات مع فلتر `userId`.
- `getDecisionById` — قرار واحد بـ `decisionId`.
- `listCommitteesByDecision` — نتائج لجان قرار محدد.
- `getReviewSchedule` — جدول مراجعة قرار محدد.

**الممنوعات في A10:**
- لا mutations.
- لا ربط بالواجهة بعد.

---

### A11 — ربط صفحة Decision Journal بالقراءة فقط

**الهدف:** استبدال `PLACEHOLDER_ENTRIES` بـ Convex query حقيقية.

**الخطوات:**
1. تحويل `decision-journal/page.tsx` إلى Client Component.
2. استخدام `useQuery(api.decisionJournal.listMyDecisions)`.
3. الاحتفاظ بـ Empty State الحالي عند عدم وجود بيانات.
4. لا mutation، لا زر تنفيذ.

---

### A12 — إنشاء Audit Events

**الهدف:** mutation واحد لتسجيل أحداث القرار — Append-only.

**الـ Mutation المقترح:** `createDecisionAuditEvent`

**قواعد A12:**
- لا `deleteDecision`.
- لا `updateDecision` حر.
- لا تنفيذ تداول.
- فقط `insertAuditEvent` بـ userId من `ctx.auth`.

---

## ممنوعات التنفيذ

> هذا القسم إلزامي — يُراجَع قبل بدء أي مرحلة من A9 إلى A12.

| الممنوع | السبب |
|---|---|
| **ممنوع تنفيذ صفقات** | النظام بأكمله في وضع Read-only — لا `order_send` ولا ما يعادله |
| **ممنوع إضافة زر تنفيذ** | Decision Journal للتوثيق والمراقبة فقط — لا action buttons |
| **ممنوع إضافة `deleteDecision` mutation** | القرارات Immutable Log — لا حذف أبداً |
| **ممنوع إضافة `update` حر للقرارات** | فقط append audit events — لا تعديل مباشر |
| **ممنوع تخزين API keys** | Convex للبيانات التحليلية فقط — لا credentials |
| **ممنوع ربط OKX الحقيقي الآن** | OKX Placeholder — انتظر حتى مرحلة OKX المخصصة |
| **ممنوع تعديل Stage 5A** | الملفات التالية محمية بالكامل: |
| | • `convex/technicalIndicators.ts` |
| | • `mt5_readonly_service/main.py` |
| | • `src/app/api/lab/analyze-preview/route.ts` |
| **ممنوع تعديل Convex schema في A8** | A8 للتوثيق فقط — Schema يُعدَّل في A9 فقط |
| **ممنوع تمرير `userId` من الواجهة** | يُستخرج دائماً من `ctx.auth.getUserIdentity().subject` |
| **ممنوع query بدون userId filter** | كل query يبدأ بـ `requireUserId(ctx)` |

---

## ملاحظات معمارية إضافية

### الفرق بين `committeeReports` الحالي و `committeeResults` المقترح

| الجانب | `committeeReports` (موجود) | `committeeResults` (مقترح) |
|---|---|---|
| المرتبط بـ | `labSignalSnapshots` (Lab analysis) | `decisionRuns` (Decision Journal) |
| الهدف | تقييم Lab Preview | تقييم قرارات اللجان الرسمي |
| الفصل | منصة MT5 فقط | MT5 و OKX (مستقبلاً) |
| الحقول | `marketMindScore`, `protectionMindScore`, `executionMindScore` | `verdict`, `score`, `reasons[]` |

### التوافق مع نمط `auditEvents` الحالي

`decisionAuditEvents` المقترح يتبع نفس نمط `auditEvents` الموجود:
- نفس الحقول الأساسية (`userId`, `message`, `createdAt`).
- Append-only.
- مُفهرَس بـ `userId` و`createdAt`.
- لا `delete` ولا `update`.

---

*هذا الملف توثيق خطة مستقبلية — لا يحتوي على كود تنفيذي.*  
*لا تعديل في `convex/schema.ts` قبل انتهاء A8 والموافقة على هذه الخطة.*  
*المرحلة التالية: A9 — إنشاء Convex Schema فقط.*
