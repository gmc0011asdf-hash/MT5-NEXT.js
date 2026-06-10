# AI_MODEL_GUIDE.md
# دليل الذكاء الاصطناعي الموحد — نظام الملك الهندسي للتداول العالمي

> **هذا هو الملف المرجعي الوحيد والشامل لأي وكيل أو نموذج ذكاء اصطناعي يعمل على هذا المشروع.**
> جميع وثائق `docs/` الفرعية القديمة تم حذفها ودمج محتواها الحالي هنا.
> الملفات `PROJECT_CONTEXT.md` و `AGENT_RULES.md` و `AGENTS.md` و `CLAUDE.md` تبقى كما هي
> (تُحمَّل تلقائياً في كل جلسة عبر نظام `@imports`) وهي **المرجع الحاكم للقواعد الصارمة**.
> هذا الملف يُكمِّلها بصورة تقنية كاملة عن الحالة الفعلية الحالية للنظام.
>
> آخر تحديث: 2026-06-10

---

## 1. هوية المشروع

**الاسم:** نظام الملك الهندسي للتداول العالمي
**الطبيعة:** نظام تحليل تداول مؤسسي — **معلوماتي فقط — لا تنفيذ تداول حقيقي**.
**الرمز الأساسي:** XAUUSD (الذهب) عبر MT5، إضافة BTC-USDT / ETH-USDT عبر OKX (بيانات عامة فقط).
**الحالة المعمارية:** **Local-First** — الواجهة الأمامية (Next.js) تتصل مباشرة بخدمة FastAPI محلية
على المنفذ 8010 + قاعدة بيانات SQLite، بدون الحاجة لـ Convex أو Clerk في المسار الأساسي.
بقايا Convex لا تزال موجودة في صفحات قديمة لم تُحذف بعد (انظر القسم 8).

---

## 2. القواعد الصارمة — ملخص سريع

> المرجع الكامل والملزم: `AGENT_RULES.md` + `PROJECT_CONTEXT.md`. هذا ملخص تذكيري فقط.

```
❌ ممنوع order_send / order_close / order_modify / order_check / OrderSend في أي ملف
❌ ممنوع READ_ONLY_MODE = False في mt5_readonly_service/main.py
❌ ممنوع Stage 14 (أي كود تنفيذ تداول حقيقي) قبل موافقة كتابية صريحة من أحمد
❌ ممنوع أسرار/مفاتيح API في الكود — كل شيء عبر .env.local أو SystemConfig (DB)
❌ ممنوع أحرف box-drawing Unicode (─│┌┐└┘) — تُسبّب Turbopack panic
❌ ممنوع OKX حقيقي/Futures/Leverage/Live Trading — بيانات عامة للقراءة فقط
❌ ممنوع رفع/خفض إصدار حزم أو تعديلات واسعة بدون طلب صريح
✅ كل تعديل يجب أن يمر: pnpm exec tsc --noEmit  ثم  pnpm run build
✅ إذا عُدِّل main.py أو agents.py أو database.py: python -m py_compile <file>
✅ commit صغير ومركّز لكل مرحلة، بدون push بدون موافقة أحمد
```

**الملفات المحمية (لا تُعدَّل إلا بموافقة كتابية صريحة):**
```
mt5_readonly_service/main.py
convex/technicalIndicators.ts
convex/schema.ts
src/app/api/lab/analyze-preview/route.ts
.env.local
```

---

## 3. Stack التقني الحالي

| المكوّن | التفصيل |
|---|---|
| **Next.js** | 16.2.4 (Turbopack) — `src/app/` App Router |
| **React** | 19.2.4 |
| **TypeScript** | ^5 (strict) |
| **Tailwind CSS** | ^4 |
| **Data fetching (frontend)** | `@tanstack/react-query` ^5.101 — المسار الأساسي الجديد |
| **Backend الأساسي** | FastAPI (Python) — `mt5_readonly_service/main.py` — المنفذ **8010** |
| **قاعدة البيانات الأساسية** | SQLite عبر SQLAlchemy — `mt5_readonly_service/database.py` |
| **محرك التحليل** | CouncilEngine متعدد الوكلاء — `mt5_readonly_service/agents.py` |
| **Convex** | ^1.36.1 — **متبقٍ فقط في صفحات لم تُرحَّل بعد** (انظر القسم 8.3) |
| **Clerk** | ^7.2.7 — موجود في package.json لكن **غير مفعّل في شجرة الـ Providers الحالية** |
| **pnpm** | مدير الحزم الوحيد |
| **Lucide React / Recharts** | أيقونات / رسوم بيانية |

---

## 4. خدمة FastAPI — `mt5_readonly_service/main.py`

**التشغيل:**
```bash
cd mt5_readonly_service
uvicorn main:app --host 127.0.0.1 --port 8010 --reload
```
**المتطلب:** MetaTrader 5 مفتوح على نفس الجهاز (Windows) لبيانات XAUUSD الحقيقية.
**الأمان الثابت:** `READ_ONLY_MODE = True` — يُتحقق منه عبر `_enforce_read_only_policy()`
في بداية كل handler. لا توجد دالة `order_send` في الملف بأي شكل.

### 4.1 جدول الـ Endpoints الكامل

| Endpoint | Method | الوصف |
|---|---|---|
| `/health` | GET | فحص صحة الخدمة + read_only_mode |
| `/connect` | POST | اتصال/إعادة اتصال MT5 |
| `/connection-status` | GET | حالة الاتصال + بيانات الحساب |
| `/readonly/account` | GET | الرصيد/الهامش/العملة |
| `/readonly/ticks` | GET | bid/ask/spread للرموز المهيّأة |
| `/readonly/positions` | GET | المراكز المفتوحة |
| `/readonly/snapshot` | GET | لقطة شاملة (حساب + tick + مراكز) |
| `/readonly/symbols` | GET | كتالوج الرموز (Market Watch) |
| `/readonly/history-deals` | GET | سجل الصفقات المغلقة |
| `/readonly/candles` | GET | الشموع اليابانية (OHLCV) |
| `/readonly/okx/candles` | GET | شموع OKX العامة |
| `/readonly/okx/tickers` | GET | أسعار OKX اللحظية (افتراضي: BTC-USDT,ETH-USDT) |
| `/demo/order-send` | POST | تنفيذ Demo فقط — مقيّد بـ `MT5_DEMO_EXECUTION_ENABLED=1` + حساب Demo |
| `/api/signals` | GET | أحدث إشارات مجلس الوكلاء (`StrategySignal`) |
| `/api/journal` | GET | سجل قرارات مجلس الوكلاء (`DecisionJournal`) — APPROVED + REJECTED |
| `/api/config` | GET | إعدادات المحرك الحالية (مدمجة مع الافتراضيات، Telegram token مُموَّه) |
| `/api/config` | POST | حفظ إعداد واحد (يتحقق من `_ALLOWED_CONFIG_KEYS`) |
| `/api/config/batch` | POST | حفظ عدة إعدادات دفعة واحدة |
| `/api/config/{key}` | DELETE | حذف إعداد مخصص → الرجوع للقيمة الافتراضية |
| `/api/telegram/test` | POST | إرسال رسالة اختبار عبر Telegram (من DB ثم env كـ fallback) |
| `/ws/live-market` | WebSocket | بث مباشر لإشارات الوكلاء لكل رمز (MT5 + OKX) |

> **CORS:** `CORSMiddleware` مُفعَّل (`allow_origins=["*"]`) للسماح للواجهة الأمامية بالاتصال
> مباشرة من المتصفح بدون proxy.

### 4.2 الرموز المراقَبة
- **MT5:** افتراضياً `EURUSD, GBPUSD, XAUUSD` — قابل للتخصيص عبر متغير البيئة `SYMBOLS`
  (مثال: `SYMBOLS=XAUUSD`).
- **OKX:** `BTC-USDT, ETH-USDT` — `mt5_readonly_service/okx_bridge.py` (`DEFAULT_OKX_SYMBOLS`).

### 4.3 حلقة فحص الوكلاء (Background Scan Loop)
- تعمل كل `AGENT_SCAN_INTERVAL_SECONDS` (افتراضي **300 ثانية = 5 دقائق**).
- كل دورة: `_refresh_cfg_from_db()` ثم تشغيل `CouncilEngine` على رموز MT5 و OKX.
- تبث النتائج عبر `/ws/live-market` وتحفظها في `StrategySignal` + `DecisionJournal`.

---

## 5. CouncilEngine — `mt5_readonly_service/agents.py`

نظام تحليل بأربعة وكلاء، كل وكيل يصوّت BUY/SELL لكل رمز. القرار النهائي يُحفظ في
`DecisionJournal` دائماً (موافق أو مرفوض)، ويُحفظ في `StrategySignal` فقط عند الموافقة،
ويُرسَل تنبيه Telegram فقط عند الموافقة.

| الوكيل | الدور | منطق القرار |
|---|---|---|
| **TrendAgent** (VETO) | فلتر الاتجاه عبر EMA(200) | BUY يوافق إذا `close > EMA200`، SELL إذا `close < EMA200`. الثقة تتدرج مع نسبة البُعد عن EMA200 |
| **VolatilityAgent** | فلتر تشبع التقلب عبر Bollinger Bands(20, 2) | BUY يوافق إذا `close <= lower_band`، SELL إذا `close >= upper_band` |
| **MomentumAgent** | فلتر الزخم عبر RSI(14) | BUY يوافق إذا `RSI < 30` (تشبع بيع)، SELL إذا `RSI > 70` (تشبع شراء) |
| **RiskAgent** (VETO) | بوابة المخاطرة/العائد عبر ATR(14) | يحسب SL/TP ويتحقق أن `RR >= MIN_RR` |

### 5.1 ثوابت المخاطرة الافتراضية
```
EMA_LENGTH  = 200      RSI_LENGTH = 14       ATR_LENGTH = 14
BB_LENGTH   = 20       BB_STD     = 2.0
ATR_SL_MULT = 1.5      → SL = entry -/+ ATR * 1.5
ATR_TP_MULT = 3.0      → TP = entry +/- ATR * 3.0
MIN_RR      = 2.0      → RR = ATR_TP_MULT / ATR_SL_MULT (= 2.0 افتراضياً)
```
هذه القيم **ديناميكية**: تُقرأ من جدول `system_config` عبر `_cfg(key, default)` و
`_refresh_cfg_from_db(db)` (تُستدعى في بداية كل `analyze_market()`)، فتتجاوز
الثوابت أعلاه دون الحاجة لإعادة تشغيل الخدمة.

### 5.2 تنبيهات Telegram
- `_send_telegram_alert(verdict)` — تُرسَل فقط عند موافقة المجلس (approved=True).
- الاعتمادات (`telegram_bot_token`, `telegram_chat_id`) تُقرأ من جدول `system_config`
  أولاً، ثم من متغيرات البيئة `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` كـ fallback.
- الرسالة بصيغة HTML (`parse_mode=HTML`) باللغة العربية.
- لا يوجد أي اتصال بهذه الخدمة الخارجية إلا لإرسال نص تنبيهي — لا أوامر تنفيذ.

---

## 6. قاعدة البيانات — `mt5_readonly_service/database.py` (SQLite)

| الجدول (Class) | __tablename__ | الوصف |
|---|---|---|
| `StrategySignal` | `strategy_signals` | إشارة تحليلية واحدة لكل حدث: symbol, signal (BUY/SELL/NEUTRAL/WAIT), confidence, status (PENDING/ACTIVE/EXPIRED), timestamp |
| `DecisionJournal` | `decision_journal` | سجل قرار كامل: trade_id, context (JSON), agents_votes (JSON), result (APPROVED/REJECTED), timestamp |
| `MarketData` | `market_data` | كاش شموع OHLCV: symbol, timeframe, timestamp (unique مركّب), open/high/low/close, tick_volume |
| `SystemConfig` | `system_config` | إعدادات key-value: المحرك (ema_length, rsi_length, atr_length, bb_length, bb_std, atr_sl_mult, atr_tp_mult, min_rr) + Telegram (telegram_bot_token, telegram_chat_id) |

### 6.1 مفاتيح `_ALLOWED_CONFIG_KEYS` و `_CONFIG_DEFAULTS` (في main.py)
```
ema_length  = "200"     rsi_length = "14"     atr_length = "14"
bb_length   = "20"      bb_std     = "2.0"
atr_sl_mult = "1.5"     atr_tp_mult = "3.0"   min_rr = "2.0"
telegram_bot_token  (لا قيمة افتراضية — يُموَّه في الاستجابة)
telegram_chat_id    (لا قيمة افتراضية)
```
`GET /api/config` يدمج `_CONFIG_DEFAULTS` مع القيم المخزَّنة في `system_config` ويموّه
`telegram_bot_token` (أول 10 أحرف + `...`).

---

## 7. الواجهة الأمامية — البنية الحالية

### 7.1 شجرة الـ Providers — `src/app/layout.tsx`
```tsx
<html lang="ar" dir="rtl" className="... dark ...">
  <body>
    <ApiProvider>            {/* QueryClientProvider لـ React Query */}
      <ConvexCompatProvider> {/* shim مؤقت — انظر 8.3 */}
        <TooltipProvider>
          {children}
        </TooltipProvider>
      </ConvexCompatProvider>
    </ApiProvider>
  </body>
</html>
```
- لا `ClerkProvider` في الشجرة الحالية رغم وجود `@clerk/nextjs` في `package.json`.
- `ApiProvider` (`src/components/providers/api-provider.tsx`): `QueryClient` بسيط
  (`staleTime: 5000`, `refetchOnWindowFocus: false`).

### 7.2 Navigation الحالي — `src/lib/constants/navigation.ts`
6 صفحات فقط ضمن 4 مجموعات، **بدون أي بوابات Auth أو فحوصات Convex**:

| المجموعة | الصفحة | المسار |
|---|---|---|
| الرئيسية | لوحة القيادة | `/dashboard` |
| غرف العمليات | طرفية الذهب | `/lab/mt5` |
| غرف العمليات | طرفية الكريبتو | `/lab/okx` |
| التحليل والاستخبارات | سجل القرارات | `/decision-journal` |
| التحليل والاستخبارات | رادار الأخبار الاقتصادية | `/reports` |
| النظام | الإعدادات المحلية | `/settings` |

---

## 8. حالة الصفحات — Local-First مقابل Convex

### 8.1 صفحات مُرحَّلة بالكامل (Zero Convex — React Query + FastAPI مباشرة)
```
src/app/(dashboard)/dashboard/page.tsx
src/app/(dashboard)/lab/mt5/page.tsx
src/app/(dashboard)/lab/okx/page.tsx
src/app/(dashboard)/decision-journal/page.tsx
src/app/(dashboard)/reports/page.tsx
src/app/(dashboard)/settings/page.tsx
```
- **decision-journal:** يجلب من `GET /api/journal?limit=200`، فلاتر بالنتيجة (APPROVED/REJECTED) والرمز، لوحة أصوات الوكلاء `AgentVotesPanel`.
- **settings:** بطاقات `Mt5ConnectionCard`, `AgentScanCard`, `TelegramCard`, `EngineSettingsCard`
  (EMA/RSI/ATR/BB/SL-TP/RR مع تلميحات + زر إعادة الضبط), `DemoSettingsCard`. تستخدم
  `GET/POST /api/config` و `POST /api/telegram/test`.
- **reports:** تقويم اقتصادي محلي بـ 10 أحداث `DEMO_EVENTS` ثابتة، مُعلَّمة بوضوح
  كـ `[تجريبي]` — لا اتصال خارجي.
- **lab/mt5 و lab/okx:** يعرضان "مجلس الوكلاء الكمي" (تم استبدال "أسعد حمزة" في كل الواجهات).

### 8.2 سكربت التشغيل الموحد
```
scripts/start_mt5_gold_system.ps1
```
يفتح نافذتين منفصلتين (FastAPI على 8010، Next.js على 3000)، يفحص `/health`،
ويطبع روابط كل الصفحات وواجهات الـ API. التشغيل:
```powershell
./scripts/start_mt5_gold_system.ps1
```

### 8.3 صفحات لا تزال على Convex (غير موجودة في Navigation الحالي — تعتبر Legacy)
```
src/app/(dashboard)/gold/page.tsx
src/app/(dashboard)/gold/strategy-lab/page.tsx
src/app/(dashboard)/strategy-library/page.tsx
src/app/(dashboard)/strategy-library/[id]/page.tsx
src/app/(dashboard)/strategy-library/compare/page.tsx
src/app/(dashboard)/monitoring/page.tsx
src/app/(dashboard)/system-health/page.tsx
src/app/(dashboard)/convex-core/page.tsx   (صفحة اختبار)
src/app/(dashboard)/convex-test/page.tsx   (صفحة اختبار)
```
هذه الصفحات تستدعي `useQuery(api.xxx)` من `convex/react`. بفضل
`ConvexCompatProvider` (عميل Convex anonymous بدون مصادقة) فإنها تُعرَض في حالة
تحميل (loading) بدلاً من تعطيل الـ build، لكنها **لا تعمل فعلياً** لأن لا أحد
يكتب بيانات Convex جديدة بعد الآن. ترحيلها يتطلب طلباً صريحاً يحدد الصفحة المستهدفة.

### 8.4 `ConvexCompatProvider` — `src/components/providers/convex-compat-provider.tsx`
shim مؤقت يوفر `ConvexProvider` بعميل anonymous (بدون Clerk) فقط حتى لا تنهار
صفحات القسم 8.3 أثناء build. **يُحذف هذا الملف وlayout.tsx import الخاص به فقط
بعد ترحيل كل الصفحات في 8.3.**

---

## 9. الإعداد والتشغيل

### 9.1 المتطلبات
```
mt5_readonly_service/requirements.txt:
  fastapi>=0.115.0,<1
  uvicorn[standard]>=0.32.0,<1
  MetaTrader5>=5.0.45     (Windows فقط)
  sqlalchemy>=2.0.0,<3
  websockets>=12.0
  pandas>=2.0.0,<3
  numpy>=1.24.0
  requests>=2.31.0
```

### 9.2 متغيرات البيئة (اختيارية — `mt5_readonly_service`)
```
SYMBOLS=XAUUSD                    # رموز MT5 المراقَبة (افتراضي: EURUSD,GBPUSD,XAUUSD)
AGENT_SCAN_INTERVAL_SECONDS=300   # دورة فحص الوكلاء بالثواني
TELEGRAM_BOT_TOKEN=...            # fallback إن لم تُحفظ في system_config
TELEGRAM_CHAT_ID=...              # fallback إن لم تُحفظ في system_config
MT5_DEMO_EXECUTION_ENABLED=1      # تفعيل /demo/order-send (Demo accounts فقط)
```

### 9.3 ترتيب التشغيل اليدوي
```bash
# 1. افتح MetaTrader 5 (لبيانات XAUUSD حقيقية)

# 2. الخلفية FastAPI
cd mt5_readonly_service
uvicorn main:app --host 127.0.0.1 --port 8010 --reload

# 3. الواجهة الأمامية
pnpm dev
# افتح http://localhost:3000/dashboard
```
أو ببساطة: `./scripts/start_mt5_gold_system.ps1` (يفتح كلا الخدمتين تلقائياً).

---

## 10. أوامر الفحص الإلزامية بعد أي تعديل

```bash
pnpm exec tsc --noEmit                              # يجب EXIT:0
pnpm run build                                      # يجب نجاح كل الصفحات
python -m py_compile mt5_readonly_service/main.py   # عند تعديل main.py
python -m py_compile mt5_readonly_service/agents.py     # عند تعديل agents.py
python -m py_compile mt5_readonly_service/database.py   # عند تعديل database.py
git status --short
```

---

## 11. نقاط الفشل الشائعة وكيفية تجنبها

| المشكلة | السبب | الحل |
|---|---|---|
| Turbopack panic عند `pnpm dev` | أحرف box-drawing Unicode (─│┌) في الكود | استخدم `-`, `=`, `+`, `\|` فقط |
| صفحة تظهر فارغة/loading دائماً | الصفحة من القسم 8.3 (Convex legacy) ولا توجد بيانات Convex جديدة | متوقع — تحتاج ترحيل صريح إلى FastAPI |
| فشل اتصال المتصفح بـ `127.0.0.1:8010` | الخدمة Python غير مُشغَّلة، أو CORS غير مفعّل | تأكد أن `CORSMiddleware` مُضاف بعد `app = FastAPI(...)` في main.py |
| الواجهة الأمامية تفتح في `system32` عند تشغيل السكربت | `$FRONTEND_DIR` غير معرَّف | يجب أن يكون `$FRONTEND_DIR = $PROJECT_ROOT` معرَّفاً في قسم المسارات |
| إعدادات المحرك لا تتغير رغم الحفظ | الخدمة لم تستدعِ `_refresh_cfg_from_db()` | يحدث تلقائياً في بداية كل `analyze_market()` — تأكد أن حلقة الفحص تعمل |
| تنبيه Telegram لا يصل | لا توجد قيم في `system_config` ولا env vars، أو القرار رُفض | تحقق عبر `/api/telegram/test`؛ التنبيهات تُرسَل فقط عند `approved=True` |

---

## 12. حالة المراحل (ملخص)

| المرحلة | الحالة |
|---|---|
| A1 – DOCS-2 (الفصل + التوثيق الأولي) | ✅ منجزة (تاريخية — تم استبدالها بهذا الملف) |
| Fix-0 – Fix-3 (أمان Convex + Cron + واجهات) | ✅ منجزة (تاريخية — معظمها استُبدل بـ Local-First) |
| Local-First Migration (FastAPI + SQLite + CouncilEngine + Telegram + SystemConfig) | ✅ منجزة لـ 6 صفحات أساسية |
| ترحيل صفحات Convex المتبقية (القسم 8.3) | ⏳ معلّق — يتطلب طلباً صريحاً لكل صفحة |
| إزالة `ConvexCompatProvider` و Convex من package.json | ⏳ معلّق — بعد اكتمال الترحيل |
| **Stage 14 (تنفيذ تداول حقيقي)** | 🔒 محظور — يتطلب موافقة كتابية صريحة من أحمد |

---

*هذا الملف هو المصدر التقني الوحيد لفهم النظام لأي وكيل ذكاء اصطناعي.*
*القواعد الحاكمة الملزمة دائماً: `AGENT_RULES.md` + `PROJECT_CONTEXT.md`.*
