# King Trading Project Guard Skill

نظام الملك الهندسي للتداول العالمي — قواعد الوكيل الإلزامية

---

## When to use

Use this skill before **any** code, documentation, schema, or configuration change in this repository.

---

## Required reading before any action

1. `PROJECT_CONTEXT.md` — سياق المشروع الكامل
2. `AGENTS.md` — قواعد Next.js و Convex AI
3. `AGENT_RULES.md` — 15 قاعدة إلزامية
4. `docs/README.md` — فهرس الوثائق
5. `convex/_generated/ai/guidelines.md` — عند لمس أي ملف Convex

---

## Hard rules — ممنوعات مطلقة

| الممنوع | التفصيل |
|---|---|
| ❌ لا تنفيذ تداول | ممنوع `order_send` / `order_close` / `order_modify` |
| ❌ لا OKX API حقيقي | OKX Placeholder فقط حتى إشعار آخر |
| ❌ لا Futures / Leverage | ممنوع في OKX |
| ❌ لا أسرار في الكود | لا API keys، لا passwords، لا tokens |
| ❌ لا userId من الواجهة | يُستخرج دائماً من `ctx.auth` server-side |
| ❌ لا Convex mutation إلا بمرحلة صريحة | |
| ❌ لا Schema change إلا بمرحلة صريحة + codegen | |
| ❌ لا تعديل Stage 5A | ملفات محمية — انظر أدناه |
| ❌ لا commit قبل tsc/build | |
| ❌ لا push بدون موافقة أحمد | |

---

## Protected files — الملفات المحمية

```
convex/technicalIndicators.ts        ← Stage 5A
mt5_readonly_service/main.py         ← Stage 5A
src/app/api/lab/analyze-preview/route.ts  ← Stage 5A
.env.local                           ← أسرار — لا تُلمس أبداً
```

---

## Stage protocol — بروتوكول المرحلة

```
1. اقرأ PROJECT_CONTEXT.md
2. شغّل: git status --short
3. حدّد: الملفات المسموحة + الملفات المحمية
4. نفّذ: أدنى تغيير ممكن
5. شغّل: pnpm exec tsc --noEmit
6. شغّل: pnpm run build
7. قدّم: تقرير عربي كامل
8. انتظر: موافقة أحمد قبل commit أو push
```

---

## Required report format — شكل التقرير الإلزامي

- الملفات التي قرأتها
- الملفات التي عدّلتها / أنشأتها
- هل عُدِّلت Stage 5A؟ (يجب: لا)
- هل عُدِّل schema؟ (يجب: لا إلا بمرحلة صريحة)
- هل توجد أسرار؟ (يجب: لا)
- نتيجة `pnpm exec tsc --noEmit`
- نتيجة `pnpm run build`
- نتيجة `git status`
- توصية commit message

---

## Current stage status

آخر مرحلة منجزة: **DOCS-2** (2026-05-04)  
المرحلة التالية المقترحة: **A12** (تحتاج موافقة)

---

*هذا الـ Skill يُحدَّث في نهاية كل مجموعة مراحل.*
