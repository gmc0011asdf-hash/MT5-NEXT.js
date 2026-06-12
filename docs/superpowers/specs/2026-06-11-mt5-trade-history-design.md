# التصميم — سجل الصفقات وربطها بإشارات النظام (Trade History & Signal Linking)

> **الحالة:** معتمد مبدئياً من أحمد — بانتظار خطة التنفيذ.
> **النطاق:** Approach A فقط — تخزين محلي بالكامل عبر SQLite، بدون أي لمسة لـ Convex.
> **الهدف:** سحب الصفقات المغلقة والمفتوحة من MT5، تخزينها محلياً، وربطها تلقائياً
> بإشارات `TripleFirewallSignal` لقياس دقة توصيات النظام — تحليل وتعلّم فقط، بدون أي تنفيذ تداول.

---

## 0. القيود الصارمة (غير قابلة للتفاوض)

- ❌ **لا Convex نهائياً** — لا تعديل على `convex/schema.ts`، لا أي جدول Convex جديد.
- ✅ كل التخزين داخل `mt5_readonly_service/local_quant.db` عبر SQLAlchemy/SQLite،
  بنفس نمط نظام مشتركي تيليجرام (Telegram Subscribers) المُنفَّذ سابقاً.
- ✅ **نسخة احتياطية إلزامية** قبل أي تنفيذ لاحق:
  `mt5_readonly_service/local_quant.db` → `mt5_readonly_service/local_quant_backup_before_trade_history.db`
- ❌ ممنوع أي `order_send` / `order_close` / `order_modify` / `order_check` / `OrderSend`
  في أي ملف جديد أو معدَّل ضمن هذه المرحلة.
- ❌ لا تعديل على ملفات Stage 5A المحمية
  (`convex/technicalIndicators.ts`, `mt5_readonly_service/main.py` الدوال/المسارات الحالية المحمية،
  `src/app/api/lab/analyze-preview/route.ts`) — أي إضافة في `main.py` تكون **إضافية فقط**
  (endpoints جديدة + تسجيل المهمة الخلفية)، دون تعديل الدوال أو المسارات الموجودة.

---

## 1. الجداول الجديدة في SQLite (`mt5_readonly_service/database.py`)

### 1.1 `mt5_trade_history` — صف واحد لكل صفقة مغلقة (مجمّعة حسب `position_id`)

| الحقل | النوع | الوصف |
|---|---|---|
| `id` | Integer PK | تلقائي |
| `position_id` | Integer, unique indexed | معرّف المركز في MT5 (يربط صفقات الفتح والإغلاق) |
| `symbol` | String(20) | الرمز |
| `direction` | String(10) | `BUY` \| `SELL` (مشتق من نوع صفقة الفتح) |
| `volume` | Float | حجم الفتح |
| `open_price` | Float | سعر الفتح |
| `open_time` | DateTime(tz) | وقت الفتح (UTC) |
| `open_deal_ticket` | Integer | تذكرة صفقة الفتح (`entry == 0`، الأقدم) |
| `close_price` | Float | سعر آخر إغلاق |
| `close_time` | DateTime(tz) | وقت آخر إغلاق |
| `close_deal_ticket` | Integer | تذكرة آخر صفقة إغلاق (`entry in (1,3)`، الأحدث) |
| `close_volume` | Float | مجموع حجم صفقات الإغلاق (يدعم الإغلاق الجزئي المتراكم) |
| `deals_count` | Integer | عدد كل الـ deals ضمن نفس `position_id` (فتح + إغلاقات) |
| `profit` | Float | مجموع الربح/الخسارة لكل صفقات الإغلاق |
| `commission` | Float | مجموع العمولات لكل الـ deals ضمن المجموعة |
| `swap` | Float | مجموع التبييت لكل الـ deals ضمن المجموعة |
| `comment` | String | تعليق صفقة الفتح |
| `magic` | Integer | magic number |
| `matched_signal_id` | Integer, nullable | `triple_firewall_signals.id` المطابقة |
| `matched_time_delta_seconds` | Integer, nullable | الفارق الزمني (ثوانٍ) بين وقت الإشارة ووقت فتح الصفقة |
| `created_at` | DateTime(tz) | وقت أول إدراج لهذا الصف |
| `updated_at` | DateTime(tz) | آخر تحديث (عند تحديث الإغلاق الجزئي) |

فهارس: `ix_mth_position_id` (unique)، `ix_mth_symbol_open_time` (symbol, open_time).

### 1.2 `mt5_open_positions` — لقطة حالية (تُستبدل/تُحدَّث كل دورة)

| الحقل | النوع | الوصف |
|---|---|---|
| `id` | Integer PK | تلقائي |
| `ticket` | Integer, unique indexed | تذكرة المركز |
| `symbol` | String(20) | الرمز |
| `direction` | String(10) | `BUY` \| `SELL` |
| `volume` | Float | الحجم الحالي |
| `open_price` | Float | سعر الفتح |
| `open_time` | DateTime(tz) | وقت الفتح |
| `current_price` | Float | السعر الحالي |
| `sl`, `tp` | Float | وقف الخسارة / الهدف |
| `profit` | Float | الربح العائم الحالي |
| `comment` | String | تعليق |
| `matched_signal_id` | Integer, nullable | `triple_firewall_signals.id` المطابقة |
| `matched_time_delta_seconds` | Integer, nullable | الفارق الزمني |
| `updated_at` | DateTime(tz) | آخر تحديث |

فهرس: `ix_mop_symbol`.

كلا الجدولين يُنشآن تلقائياً عبر `Base.metadata.create_all()` عند تشغيل `init_db()` —
لا حاجة لمايجريشن لأنهما جديدان كلياً (لا أعمدة تُضاف لجداول قائمة).

---

## 2. سحب البيانات من MT5

وحدة جديدة: `mt5_readonly_service/mt5_trade_sync.py`.

لتفادي لمس `_positions_payload()` أو مسارات `/readonly/*` المحمية (Stage 5A)،
الوحدة الجديدة تستدعي MT5 مباشرة بنفسها عبر `_safe_mt5_init()` / `mt5.shutdown()`
بنفس نمط بقية الخدمة:

- **الصفقات المغلقة**: `mt5.history_deals_get(from_date, to_date)` حيث
  `from_date = now_utc - MT5_TRADE_SYNC_HISTORY_DAYS` (env var، افتراضي `30`)،
  `to_date = now_utc`.
- **الصفقات المفتوحة**: `mt5.positions_get()` مباشرة (لجلب `time` بالإضافة لباقي الحقول).

---

## 3. تجميع `deals` إلى صفقة واحدة حسب `position_id`

لكل دورة مزامنة:

1. تجميع كل الصفقات (`deals`) من `history_deals_get` حسب `position_id`.
2. لكل مجموعة (`deals_count = len(group)`):
   - **صفقات الفتح** = `entry == 0` (DEAL_ENTRY_IN) → أُولى (أقدم) صفقة فتح تحدد:
     `symbol`, `volume`, `open_price`, `open_time`, `open_deal_ticket`, `comment`, `magic`،
     و`direction` (`type==0` → `BUY`, `type==1` → `SELL`).
   - **صفقات الإغلاق** = `entry in (1, 3)` (OUT / OUT_BY):
     - `close_time` / `close_price` / `close_deal_ticket` = من **آخر** صفقة إغلاق (الأحدث زمنياً).
     - `close_volume` = **مجموع** أحجام كل صفقات الإغلاق (يدعم الإغلاق الجزئي المتراكم عبر عدة دورات).
     - `profit` = **مجموع** `profit` لكل صفقات الإغلاق فقط.
   - `commission` و `swap` = **مجموع** القيم من **كل** الـ deals ضمن المجموعة (فتح + إغلاق).
3. إذا لم توجد أي صفقة إغلاق بعد → المركز ما زال مفتوحاً بالكامل
   (يُعالَج عبر `mt5_open_positions` فقط)، تُتجاهل هذه المجموعة في `mt5_trade_history`.
4. **Upsert** بالـ `position_id`:
   - إن لم يوجد صف → إدراج جديد + تشغيل منطق المطابقة (القسم 4) + ضبط `created_at`/`updated_at`.
   - إن وُجد صف (مثلاً إغلاق جزئي إضافي في دورة لاحقة) → تحديث
     `close_price`, `close_time`, `close_deal_ticket`, `close_volume`,
     `deals_count`, `profit`, `commission`, `swap`, `updated_at` فقط
     — **بدون** إعادة تشغيل المطابقة (لأن `open_time`/`open_deal_ticket` لا يتغيران).

### الصفقات المفتوحة (`mt5_open_positions`)

لكل `position` من `positions_get()`:
- `ticket`, `symbol`, `volume`, `open_price = price_open`, `open_time = p.time`,
  `current_price = price_current`, `sl`, `tp`, `profit`, `comment`,
  `direction` (`type==0` → `BUY`, `type==1` → `SELL`).
- **Upsert** بالـ `ticket`:
  - عند الإدراج الأول فقط → تشغيل منطق المطابقة (القسم 4).
  - في كل دورة → تحديث `current_price`, `profit`, `sl`, `tp`, `updated_at`.
- حذف أي صف بتذكرة لم تعد ضمن نتيجة `positions_get()` الحالية (أُغلق المركز —
  سيظهر لاحقاً في `mt5_trade_history` عند ظهوره في `history_deals_get`).

---

## 4. ربط الصفقة بإشارة النظام

عند **الإدراج الأول فقط** لأي صف جديد (في أي من الجدولين)، إن كان `matched_signal_id IS NULL`:

```sql
SELECT * FROM triple_firewall_signals
WHERE symbol = :symbol
  AND direction = :direction
  AND approved = 1
  AND timestamp <= :open_time
  AND timestamp >= :open_time - INTERVAL 24 HOUR  -- نافذة 24 ساعة قبل وقت الفتح
ORDER BY timestamp DESC
LIMIT 1
```

- إن وُجدت نتيجة → `matched_signal_id = signal.id`،
  `matched_time_delta_seconds = (open_time - signal.timestamp).total_seconds()`.
- إن لم توجد → تبقى `NULL` (صفقة غير مرتبطة بإشارة معتمدة من النظام — على الأرجح صفقة يدوية).

---

## 5. المهمة الخلفية الدورية

`run_mt5_trade_sync()` في `mt5_trade_sync.py` — نفس نمط `run_telegram_bot_polling()`:

- حلقة `async` لا نهائية، `await asyncio.sleep(60)` (60 ثانية حسب طلب أحمد).
- `SessionLocal()` جديدة في كل دورة.
- كل الأخطاء تُسجَّل عبر `logger` وتُبتلع (لا تُسقط الحلقة، تماماً كما في `run_telegram_bot_polling`).
- تُسجَّل في `_startup()` عبر `asyncio.create_task()` في `main.py` — إضافة سطر واحد فقط بجانب
  تسجيل مهمة تيليجرام، دون تعديل الدوال المحمية.

دالة منطق المزامنة الأساسية (`sync_mt5_trades_once(db)`) تُستخرج كدالة مستقلة قابلة للاستدعاء
من الحلقة الخلفية **و** من endpoint التشخيص اليدوي (القسم 6.4).

---

## 6. API Endpoints الجديدة (إضافية في `main.py`، بنفس نمط مشتركي تيليجرام)

### 6.1 `GET /api/trade-history/closed?days=30&symbol=XAUUSD&limit=50&offset=0`

`{ ok, total, trades: [...] }` — كل صفقة من `mt5_trade_history` مع بيانات الإشارة المطابقة
المضمومة (إن وُجدت): `confluenceLevel`, `signalStrength`, `sl/tp/rr`, `matchedTimeDeltaSeconds`.

### 6.2 `GET /api/trade-history/open`

`{ ok, total, positions: [...] }` — كل مركز من `mt5_open_positions` مع نفس منطق ضم
بيانات الإشارة المطابقة.

### 6.3 `GET /api/trade-history/summary?days=30`

إحصاءات معلوماتية فقط:
- عدد الصفقات الكلي المغلقة ضمن الفترة.
- عدد الصفقات المرتبطة بإشارة (`matched_signal_id IS NOT NULL`) مقابل غير المرتبطة.
- نسبة الصفقات الرابحة (`profit > 0`) إجمالاً.
- نسبة الصفقات الرابحة ضمن المرتبطة بإشارة، مقابل نسبتها ضمن غير المرتبطة.
- إجمالي الربح/الخسارة (`profit` net).

### 6.4 `POST /api/trade-history/sync-now` (اختياري — للتشخيص والتجربة)

- يستدعي `sync_mt5_trades_once(db)` مرة واحدة فوراً (دون انتظار الـ 60 ثانية).
- لا ينفذ أي صفقة — فقط سحب + تخزين + مطابقة، بنفس منطق الحلقة الخلفية تماماً.
- الاستجابة: `{ ok, closedUpserted, openUpserted, openRemoved }` (عدادات بسيطة للتشخيص).

---

## 7. واجهة `/trade-history` (صفحة مستقلة جديدة)

صفحة RTL جديدة (`src/app/(dashboard)/trade-history/page.tsx`)، بنفس نمط صفحة
مشتركي تيليجرام (تحميل عبر `fetch` + حالات تحميل/خطأ + زر تحديث):

- **عنوان** + **تنويه ثابت أعلى الصفحة**:
  > "هذه البيانات لأغراض التحليل والتعلم من النتائج فقط، وليست توصية مالية أو أمر تداول."
- **بطاقات ملخص دقة التوصيات** (من `/api/trade-history/summary`):
  إجمالي الصفقات، المرتبط بإشارة مقابل غير المرتبط، نسبة الربح الإجمالية،
  نسبة الربح ضمن المرتبط بإشارة مقابل غير المرتبط، صافي الربح/الخسارة.
- **قسم "الصفقات المفتوحة"**: جدول من `/api/trade-history/open` — الرمز، الاتجاه،
  الحجم، سعر الفتح/الحالي، الربح العائم، وعمود "إشارة النظام".
- **قسم "الصفقات المغلقة"**: جدول مُرقّم من `/api/trade-history/closed` — الرمز،
  الاتجاه، الحجم، سعر/وقت الفتح، سعر/وقت الإغلاق، الربح/الخسارة، عدد الـ deals،
  وعمود "إشارة النظام".
- **عمود "إشارة النظام"** (في كلا الجدولين): إما badge "✅ مرتبطة بإشارة" مع
  مستوى التوافق (`confluenceLevel`) وقوة الإشارة والفارق الزمني (مثلاً "قبل 2.5 ساعة")،
  أو badge "— لا توجد إشارة مطابقة" (صفقة يدوية).
- إضافة رابط "سجل الصفقات" في `src/lib/constants/navigation.ts` ضمن مجموعة
  "التحليل والاستخبارات" (`intel`).

---

## 8. معنى "تعليم النظام" في هذه المرحلة

### ما يتم في هذه المرحلة:
- **قياس دقة التوصيات**: عبر مطابقة الصفقات الفعلية بإشارات `TripleFirewallSignal` المعتمدة.
- **مقارنة الأداء**: الصفقات المرتبطة بإشارات النظام مقابل الصفقات غير المرتبطة (اليدوية).
- **معرفة أي الإشارات نجحت وأيها فشلت**: عبر ربط `profit` الصفقة بخصائص الإشارة المطابقة
  (مستوى التوافق، قوة الإشارة، الاتجاه، الجلسة).
- **بناء قاعدة بيانات تاريخية** (`mt5_trade_history` + `matched_signal_id`) تصلح كأساس
  لأي تحليل أو تعلّم لاحق (يتطلب مرحلة منفصلة بموافقة صريحة).

### ما لا يتم في هذه المرحلة (صراحةً):
- ❌ لا تعديل تلقائي على الاستراتيجية بناءً على النتائج.
- ❌ لا تنفيذ صفقات (لا `order_send` ولا أي شكل تنفيذ).
- ❌ لا تغيير تلقائي في إعدادات المخاطر (`sl`/`tp`/lot sizing) بناءً على هذه البيانات.
- ❌ لا اعتماد توصيات جديدة أو تعديل عتبات `approved`/`confluence_level` بدون حوكمة
  ومراجعة صريحة من أحمد.

---

## 9. الملفات المتأثرة

| الملف | نوع التغيير |
|---|---|
| `mt5_readonly_service/database.py` | إضافة `MT5TradeHistory`, `MT5OpenPosition` (جدولان جديدان فقط) |
| `mt5_readonly_service/mt5_trade_sync.py` | جديد — السحب + التجميع + المطابقة + `sync_mt5_trades_once()` + `run_mt5_trade_sync()` |
| `mt5_readonly_service/main.py` | إضافي فقط: تسجيل المهمة في `_startup()` + 4 endpoints جديدة (closed/open/summary/sync-now) |
| `src/app/api/trade-history/closed/route.ts` | جديد (proxy، Clerk auth) |
| `src/app/api/trade-history/open/route.ts` | جديد (proxy، Clerk auth) |
| `src/app/api/trade-history/summary/route.ts` | جديد (proxy، Clerk auth) |
| `src/app/api/trade-history/sync-now/route.ts` | جديد (proxy، POST، Clerk auth) |
| `src/app/(dashboard)/trade-history/page.tsx` | جديد — الصفحة الكاملة |
| `src/lib/constants/navigation.ts` | إضافة رابط "سجل الصفقات" |
| `mt5_readonly_service/local_quant_backup_before_trade_history.db` | نسخة احتياطية إلزامية قبل أي تنفيذ |

**لا تعديل على Convex أو `convex/schema.ts`. لا أي `order_send`/`order_close`/`order_modify`/`order_check`/`OrderSend`.**

---

## 10. خطة التحقق

```bash
python -m py_compile mt5_readonly_service/main.py mt5_readonly_service/database.py mt5_readonly_service/mt5_trade_sync.py
pnpm exec tsc --noEmit   # يجب EXIT:0
pnpm run build           # يجب أن ينجح
```

- اختبار منطق التجميع/المطابقة مباشرة (in-process، بدون httpx) ببيانات `deals` تجريبية
  تغطي: صفقة بإغلاق كامل دفعة واحدة، صفقة بإغلاق جزئي عبر دورتين، صفقة بدون إشارة مطابقة.
- اختبار يدوي: تشغيل الخدمة، استدعاء `POST /api/trade-history/sync-now`، التحقق من
  امتلاء `mt5_trade_history`/`mt5_open_positions`، ثم فتح `/trade-history` والتأكد من
  RTL، التنويه، البطاقات، الجداول، وبادجات المطابقة.
- فحص نصي على الملفات الجديدة/المعدَّلة للتأكد من خلوّها من `order_send` وما شابه.
- `git status --short` للتأكد من عدم وجود تغييرات غير متوقعة على ملفات Convex أو الملفات المحمية.
