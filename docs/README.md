# docs/ — فهرس وثائق نظام الملك الهندسي للتداول العالمي

> **مهم:** الملف الرئيسي للسياق هو `PROJECT_CONTEXT.md` في جذر المشروع.  
> أي وكيل أو مطور يبدأ العمل يجب أن يقرأ `PROJECT_CONTEXT.md` أولاً.

---

## هيكل المجلدات

```
docs/
├── README.md                    ← هذا الملف
├── architecture/                ← حدود المعمارية والبنية
├── decision-journal/            ← عقود بيانات Decision Journal وخطط Convex
├── roadmap/                     ← خارطة الطريق والمهام
├── reviews/                     ← مراجعات الكود والنظام
├── trading/                     ← خطط MT5 و OKX
├── security/                    ← مراجعات الأمان
├── agent/                       ← فريق الوكلاء وأدوارهم
└── archive/                     ← وثائق تاريخية — للمرجع فقط
```

---

## Architecture

| الملف | الوصف |
|---|---|
| [architecture/LAB_BOUNDARIES.md](architecture/LAB_BOUNDARIES.md) | الحدود المعمارية الصارمة بين MT5 و OKX — إلزامي القراءة |

---

## Decision Journal

| الملف | الوصف |
|---|---|
| [decision-journal/DATA_CONTRACT.md](decision-journal/DATA_CONTRACT.md) | عقد بيانات Decision Journal (A6) |
| [decision-journal/CONVEX_SCHEMA_PLAN.md](decision-journal/CONVEX_SCHEMA_PLAN.md) | خطة Convex Schema التفصيلية (A8) |

---

## Roadmap

| الملف | الوصف |
|---|---|
| [roadmap/ROADMAP.md](roadmap/ROADMAP.md) | خارطة طريق التطوير المرحلية الكاملة |
| [roadmap/TASKS.md](roadmap/TASKS.md) | قائمة المهام التفصيلية مع حالة كل مرحلة |

---

## Reviews

| الملف | الوصف |
|---|---|
| [reviews/BACKEND_REVIEW.md](reviews/BACKEND_REVIEW.md) | مراجعة Backend والبيانات |
| [reviews/FRONTEND_REVIEW.md](reviews/FRONTEND_REVIEW.md) | مراجعة واجهة المستخدم |
| [reviews/MT5_REVIEW.md](reviews/MT5_REVIEW.md) | مراجعة دومين MT5 |

---

## Trading

| الملف | الوصف |
|---|---|
| [trading/OKX_PLAN.md](trading/OKX_PLAN.md) | خطة OKX Read-only Foundation |

---

## Security

| الملف | الوصف |
|---|---|
| [security/SECURITY_REVIEW.md](security/SECURITY_REVIEW.md) | مراجعة الأمان الكاملة للنظام |

---

## Agent

| الملف | الوصف |
|---|---|
| [agent/AGENT_TEAM.md](agent/AGENT_TEAM.md) | فريق الوكلاء المعتمدين وأدوارهم وحدودهم |

---

## Archive — وثائق تاريخية

> ⚠️ الملفات هنا تاريخية فقط ولا تُستخدم كمصدر تنفيذ مباشر.  
> تعكس حالة المشروع في مراحل سابقة. قد لا تتطابق مع الوضع الحالي.

| الملف | الوصف | تاريخ الأرشفة |
|---|---|---|
| [archive/RESET_PLAN.md](archive/RESET_PLAN.md) | خطة إعادة الهيكلة (A1) — منجزة | 2026-05-04 |
| [archive/STRUCTURE_AUDIT.md](archive/STRUCTURE_AUDIT.md) | فحص هيكلي (2026-05-02) — قديم | 2026-05-04 |
| [archive/PROJECT_AUDIT.md](archive/PROJECT_AUDIT.md) | تقرير Audit كامل (2026-04-28) — قديم | 2026-05-04 |
