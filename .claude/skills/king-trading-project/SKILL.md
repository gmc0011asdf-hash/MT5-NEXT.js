# King Trading Project Guard Skill

نظام الملك الهندسي للتداول العالمي — قواعد الوكيل الإلزامية لأي نموذج ذكاء اصطناعي

---

## When to use

استخدم هذا الـ Skill قبل **أي** تعديل على الكود، الوثائق، الـ schema، أو الإعدادات في هذا المستودع.

---

## القراءة الإلزامية قبل أي تنفيذ

1. `PROJECT_CONTEXT.md` — سياق المشروع وحالة المراحل
2. `AGENT_RULES.md` — 15 قاعدة إلزامية
3. `AGENTS.md` — قواعد Next.js/Convex العامة
4. **`docs/AI_MODEL_GUIDE.md`** — **المرجع التقني الشامل الوحيد**: البنية الفعلية الحالية
   (Local-First: FastAPI + SQLite + CouncilEngine)، جدول كل الـ API endpoints، الوكلاء
   الأربعة وثوابتهم، جداول قاعدة البيانات، حالة كل صفحة (مُرحَّلة أم Convex legacy)،
   أوامر التشغيل والفحص، ونقاط الفشل الشائعة. **اقرأه دائماً قبل لمس أي ملف تقني.**
5. `convex/_generated/ai/guidelines.md` — فقط عند لمس أي ملف Convex

---

## Hard rules — ممنوعات مطلقة

| الممنوع | التفصيل |
|---|---|
| ❌ لا تنفيذ تداول حقيقي | ممنوع `order_send` / `order_close` / `order_modify` / `order_check` / `OrderSend` في أي ملف |
| ❌ لا Stage 14 | أي كود تنفيذ تداول حقيقي محظور قبل موافقة كتابية صريحة من أحمد |
| ❌ لا `READ_ONLY_MODE = False` | في `mt5_readonly_service/main.py` — ثابت دائم |
| ❌ لا OKX حقيقي | بيانات عامة للقراءة فقط — ممنوع Futures/Leverage/Live Trading |
| ❌ لا أسرار في الكود | لا API keys / passwords / tokens — فقط `.env.local` أو جدول `system_config` |
| ❌ لا Box-drawing Unicode | (`─│┌┐└┘`) — تُسبّب Turbopack panic. استخدم `-`, `=`, `+`, `\|` |
| ❌ لا `userId` من الواجهة (Convex legacy) | يُستخرج دائماً من `ctx.auth.getUserIdentity()` server-side |
| ❌ لا Convex mutation/schema change إلا بمرحلة صريحة + codegen | |
| ❌ لا تعديل الملفات المحمية | انظر القائمة أدناه |
| ❌ لا commit قبل tsc/build/py_compile | |
| ❌ لا push بدون موافقة أحمد | |
| ❌ لا تعديلات واسعة (broad rewrites) | غيّر الحد الأدنى المطلوب فقط |

---

## Protected files — الملفات المحمية

```
mt5_readonly_service/main.py              ← Stage 5A — جسر MT5/CouncilEngine API
convex/technicalIndicators.ts             ← Stage 5A
convex/schema.ts                          ← يتطلب مرحلة صريحة + codegen
src/app/api/lab/analyze-preview/route.ts  ← Stage 5A
.env.local                                ← أسرار البيئة — لا تُلمس أبداً
```

---

## Stage protocol — بروتوكول المرحلة

```
1. اقرأ PROJECT_CONTEXT.md + docs/AI_MODEL_GUIDE.md
2. شغّل: git status --short
3. حدّد: الملفات المسموحة + الملفات المحمية
4. نفّذ: أدنى تغيير ممكن
5. شغّل: pnpm exec tsc --noEmit         (يجب EXIT:0)
6. شغّل: pnpm run build                  (يجب نجاح كل الصفحات)
7. إذا عُدِّل أي ملف Python:
   python -m py_compile mt5_readonly_service/<file>.py
8. إذا عُدِّل convex/schema.ts: pnpm exec convex codegen
9. قدّم: تقرير عربي كامل (الشكل أدناه)
10. انتظر: موافقة أحمد قبل commit أو push
```

---

## Required report format — شكل التقرير الإلزامي

- الملفات التي قرأتها
- الملفات التي عدّلتها / أنشأتها (مع أرقام الأسطر الجوهرية)
- هل عُدِّلت ملفات Stage 5A المحمية؟ (يجب: لا، إلا بموافقة صريحة)
- هل عُدِّل schema؟ (يجب: لا إلا بمرحلة صريحة)
- هل توجد أسرار في التعديلات؟ (يجب: لا)
- نتيجة `pnpm exec tsc --noEmit`
- نتيجة `pnpm run build` (أو سبب عدم تشغيله)
- نتيجة `python -m py_compile` (إن انطبق)
- نتيجة `git status --short`
- توصية commit message

---

## خريطة سريعة للنظام (تفصيل كامل في docs/AI_MODEL_GUIDE.md)

- **الخلفية الأساسية:** FastAPI على المنفذ 8010 (`mt5_readonly_service/main.py`) + SQLite
  (`database.py`) + محرك تحليل متعدد الوكلاء (`agents.py`: TrendAgent, VolatilityAgent,
  MomentumAgent, RiskAgent) + تنبيهات Telegram + إعدادات ديناميكية عبر `system_config`.
- **الواجهة الأمامية:** Next.js 16 + React Query — 6 صفحات مُرحَّلة بالكامل
  (`/dashboard`, `/lab/mt5`, `/lab/okx`, `/decision-journal`, `/reports`, `/settings`).
- **بقايا Convex:** صفحات `gold`, `gold/strategy-lab`, `strategy-library/*`, `monitoring`,
  `system-health` لا تزال تستخدم Convex وغير موجودة في Navigation — تُعتبر Legacy ولا
  تُرحَّل إلا بطلب صريح يحدد الصفحة.

---

## Current stage status

آخر مرحلة منجزة: **توحيد التوثيق التقني (AI_MODEL_GUIDE.md) + إصلاح CORS** (2026-06-10)
المرحلة التالية المقترحة: ترحيل صفحة Convex legacy واحدة (تحتاج تحديد من أحمد)

---

*هذا الـ Skill يُحدَّث في نهاية كل مجموعة مراحل رئيسية، ويجب أن يبقى متسقاً مع `docs/AI_MODEL_GUIDE.md`.*
