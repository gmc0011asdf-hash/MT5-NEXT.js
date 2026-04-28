# نظام الملك الهندسي للتداول العالمي

نظام تحليل معلوماتي مؤسسي مبني على MT5 (قراءة فقط).  
**ليس توصية مالية. لا يحتوي على أي أوامر تنفيذ.**

---

## المتطلبات

| المكوّن | الإصدار |
|---|---|
| Node.js | 20+ |
| pnpm | 10+ |
| Python | 3.10+ (Windows فقط) |
| MetaTrader 5 | مثبّت على Windows |

---

## 1. إعداد المشروع

### أ. نسخ متغيرات البيئة

```bash
cp .env.local.example .env.local
```

افتح `.env.local` وأدخل قيمك:

- `NEXT_PUBLIC_CONVEX_URL` — رابط نشر Convex (من لوحة تحكم Convex)
- `CONVEX_DEPLOYMENT` — اسم نشر Convex
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — مفتاح Clerk العام
- `CLERK_SECRET_KEY` — مفتاح Clerk السري
- `MT5_SERVICE_URL` — عنوان خدمة Python (الافتراضي: `http://127.0.0.1:8010`)

### ب. تثبيت التبعيات (Node.js)

```bash
pnpm install
```

### ج. توليد أنواع Convex

```bash
pnpm exec convex codegen
```

يجب تشغيله بعد أي تغيير في `convex/schema.ts`.

---

## 2. تشغيل خدمة Python للقراءة من MT5

> مطلوب: Windows + MetaTrader 5 مثبّت ومفتوح

```bash
cd mt5_readonly_service

# تثبيت التبعيات (مرة واحدة)
pip install -r requirements.txt

# تشغيل الخدمة
uvicorn main:app --host 127.0.0.1 --port 8010
```

**التحقق من تشغيل الخدمة:**

```bash
curl http://127.0.0.1:8010/health
# النتيجة المتوقعة:
# {"status":"ok","read_only_mode":true,"mt5_connected":true/false}
```

**متغيرات بيئة الخدمة (اختيارية):**

```bash
# تخصيص الرموز المراقبة (افتراضي: EURUSD,GBPUSD,XAUUSD)
SYMBOLS=EURUSD,GBPUSD,XAUUSD uvicorn main:app --host 127.0.0.1 --port 8010
```

---

## 3. تشغيل تطبيق Next.js

### وضع التطوير

```bash
pnpm dev
```

افتح [http://localhost:3000](http://localhost:3000).

### بناء الإنتاج

```bash
pnpm build
pnpm start
```

---

## 4. ترتيب التشغيل الكامل

```
1. افتح MetaTrader 5
2. شغّل خدمة Python:
   cd mt5_readonly_service && uvicorn main:app --host 127.0.0.1 --port 8010
3. شغّل Next.js:
   pnpm dev
4. افتح: http://localhost:3000/dashboard
```

---

## 5. التحقق من الصحة

```bash
# TypeScript
pnpm exec tsc --noEmit

# بناء كامل
pnpm build

# Python
python -m py_compile mt5_readonly_service/main.py

# Convex codegen
pnpm exec convex codegen
```

---

## 6. الصفحات المتاحة

| الصفحة | الوصف |
|---|---|
| `/dashboard` | لوحة التحكم الرئيسية |
| `/lab` | مختبر الإشارات والمؤشرات التقنية |
| `/monitoring` | صحة النظام والخدمات |
| `/replay` | إعادة تشغيل البيانات التاريخية |
| `/reports` | تقارير سجل الصفقات |
| `/settings` | إعدادات الاتصال بـ MT5 والرموز |

> صفحات التطوير فقط (`/convex-core`، `/convex-test`) تظهر في وضع التطوير فقط.

---

## 7. البنية العامة

```
MT5 Terminal (Windows)
      ↓
Python FastAPI (127.0.0.1:8010) — قراءة فقط
      ↓
Next.js API Routes (/api/mt5-readonly/*)
      ↓
Convex (backend + DB)
      ↓
React UI (dashboard, lab, reports…)
```

---

## 8. قواعد الأمان

- **لا يوجد order_send** — ممنوع في كل طبقات النظام
- **READ_ONLY_MODE = true** — ثابت في خدمة Python وفي Convex
- **governance.readOnly = true** — مفعّل افتراضياً لكل مستخدم
- **لا تُخزَّن كلمة مرور MT5** — تُرسَل فقط إلى الخدمة المحلية ولا تُحفظ

---

## مستندات المشروع

| الملف | الوصف |
|---|---|
| `PROJECT_AUDIT.md` | تقرير مراجعة كامل للمشروع |
| `DEVELOPMENT_ROADMAP.md` | خارطة طريق التطوير المرحلية |
| `TASKS.md` | قائمة المهام التفصيلية |
| `AGENT_RULES.md` | قواعد الوكلاء والمطورين |
