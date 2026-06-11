# News Radar — Phase 1 Design: تنظيم بيانات الأخبار + صفحة رادار الأخبار

> **الحالة:** تصميم معتمد للمراجعة — لا تنفيذ بعد.
> **المرحلة:** 1 من 2 (انظر "ما يبقى للمرحلة 2" في النهاية).
> **القيد الأهم:** هذه المرحلة لا تربط الأخبار بمنطق التحليل (Agent Council) ولا بتيليجرام — فقط تبني البيانات والواجهة بشكل يجعل المرحلة 2 (الربط الفعلي) سهلة وآمنة.

---

## 1. السياق الحالي (ما تم فحصه)

- صفحة `src/app/(dashboard)/reports/page.tsx` (462 سطر) موجودة وكاملة شكلياً تحت اسم "رادار الأخبار الاقتصادية"، لكنها تعرض مصفوفة `DEMO_EVENTS` ثابتة (10 أحداث) بدون أي API، مع شارة "تجريبي".
- لا يوجد أي endpoint أو جدول في `mt5_readonly_service` متعلق بالأخبار حالياً.
- `mt5_readonly_service/database.py` يحتوي 10 جداول حالياً (`strategy_signals`, `decision_journal`, `market_data`, `gold_pro_analyses`, `triple_firewall_signals`, `mt5_trade_history`, `mt5_open_positions`, `telegram_subscribers`, `telegram_recommendation_delivery`, `system_config`) — لا تعارض مع `economic_news_events`.
- `CouncilVerdict` (agents.py:426-448) لا يحتوي حالياً أي حقل متعلق بالأخبار. سيُضاف حقل `news: dict | None = None` في المرحلة 2 فقط (غير منفّذ الآن).
- نظام throttling تيليجرام الحالي (`_LAST_TELEGRAM_ALERTS`, `_tf_to_seconds` في agents.py:1126-1131) **غير معرَّف فعلياً في الكود** — مشكلة موجودة مسبقاً، خارج نطاق هذه المرحلة، ولن نعتمد عليها كنموذج.

---

## 2. الملفات المتأثرة

### إنشاء جديد
| الملف | الغرض |
|---|---|
| `mt5_readonly_service/economic_calendar.py` | قوالب الأحداث الاقتصادية شبه الديناميكية + توليد التكرارات + حساب الحالة/العد التنازلي/منطقة الخطر |
| `src/app/api/news-radar/events/route.ts` | Proxy: قائمة الأحداث |
| `src/app/api/news-radar/refresh-now/route.ts` | Proxy: تحديث يدوي |
| `src/app/api/news-radar/top-bar/route.ts` | Proxy: شريط "ساعات الأخبار المهمة" |

### تعديل
| الملف | التعديل |
|---|---|
| `mt5_readonly_service/database.py` | إضافة نموذج `EconomicNewsEvent` (`__tablename__ = "economic_news_events"`) |
| `mt5_readonly_service/main.py` | إضافة 3 endpoints + تسجيل `run_news_radar_sync()` في `_startup()` |
| `src/app/(dashboard)/reports/page.tsx` | إعادة بناء كاملة: شريط علوي + بانر خطر + زر تحديث + فلاتر + جدول مرتبط بالـ API |
| `src/lib/constants/navigation.ts` | لا تغيير في المسار (`/reports`)، فقط تحقق أن التسمية لا تزال "رادار الأخبار الاقتصادية" |

**لا تعديل على:** `convex/`, أي ملف Stage 5A محمي، أو أي منطق تنفيذ صفقات.

---

## 3. جدول SQLite: `economic_news_events`

نموذج SQLAlchemy جديد في `database.py`، بجوار `MT5TradeHistory`/`MT5OpenPosition`:

```python
class EconomicNewsEvent(Base):
    __tablename__ = "economic_news_events"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    source            = Column(String, nullable=False, default="organized_calendar")
    event_id          = Column(String, nullable=False, unique=True, index=True)
    title             = Column(String, nullable=False)
    currency          = Column(String, nullable=False, index=True)   # USD, EUR, GBP, ...
    impact            = Column(String, nullable=False)               # high | medium | low
    event_time_utc    = Column(DateTime(timezone=True), nullable=False, index=True)
    event_time_baghdad = Column(DateTime(timezone=True), nullable=False)
    forecast          = Column(String, nullable=True)
    previous          = Column(String, nullable=True)
    actual            = Column(String, nullable=True)                # يبقى None حتى ربط مصدر حي
    affected_symbols  = Column(String, nullable=False, default="[]") # JSON-encoded list[str]
    status            = Column(String, nullable=False, default="upcoming")
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    updated_at        = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def to_dict(self) -> dict:
        import json
        return {
            "id": self.id,
            "source": self.source,
            "eventId": self.event_id,
            "title": self.title,
            "currency": self.currency,
            "impact": self.impact,
            "eventTimeUtc": self.event_time_utc.isoformat() if self.event_time_utc else None,
            "eventTimeBaghdad": self.event_time_baghdad.isoformat() if self.event_time_baghdad else None,
            "forecast": self.forecast,
            "previous": self.previous,
            "actual": self.actual,
            "affectedSymbols": json.loads(self.affected_symbols or "[]"),
            "status": self.status,
        }
```

- `event_id` فريد = `f"{template_id}:{event_time_utc.date().isoformat()}"` — يضمن upsert صحيح عند إعادة التوليد لنفس اليوم.
- `status` يُعاد حسابه ديناميكياً عند كل قراءة (انظر §5) وليس فقط عند التخزين، لأن الوقت يتغير بين المزامنات.

---

## 4. خدمة `economic_calendar.py`

### 4.1 قوالب الأحداث (Event Templates)

قائمة ثابتة من ~14 قالباً، كل قالب:

```python
@dataclass
class NewsEventTemplate:
    template_id: str          # "us_cpi", "us_nfp", ...
    title: str                 # عربي
    currency: str              # "USD" | "EUR" | "GBP"
    impact: str                # "high" | "medium"
    affected_symbols: list[str]
    recurrence: str            # "weekly" | "monthly_first_friday" | "monthly_mid"
    weekday: int | None        # 0=Monday .. 6=Sunday (لـ weekly)
    utc_time: tuple[int, int]  # (hour, minute)
    previous: str              # قيمة "سابق" نموذجية ثابتة للعرض
    forecast: str              # قيمة "متوقع" نموذجية ثابتة للعرض
```

أمثلة (مختصرة):
- `us_nfp` — "تقرير التوظيف الأمريكي (NFP)"، USD، high، `["XAUUSD","DXY","EURUSD","BTC-USDT"]`، `monthly_first_friday`، 13:30 UTC
- `us_cpi` — "مؤشر أسعار المستهلك (CPI)"، USD، high، `["XAUUSD","DXY","EURUSD"]`، `monthly_mid` (يوم 13 من الشهر تقريباً)، 13:30 UTC
- `us_ppi`, `us_fomc` (Interest Rate Decision)، `us_unemployment_claims` (weekly، Thursday)، `us_gdp`, `us_retail_sales`, `us_pce`, `us_consumer_confidence`
- `eu_ecb_rate`, `eu_cpi`
- `uk_boe_rate`, `uk_cpi`

> **ملاحظة شفافية:** `previous`/`forecast` قيم نموذجية ثابتة لكل قالب (وليست بيانات سوق حية). `actual` يبقى `None` دائماً في هذه المرحلة. هذا موضّح بشكل صريح في الواجهة (§7.2).

### 4.2 توليد التكرارات

```python
def generate_occurrences(now_utc: datetime, days_ahead: int = 7) -> list[dict]:
    """Project each template onto its next occurrence(s) within the
    [now_utc, now_utc + days_ahead] window. Returns raw event dicts
    ready for upsert (event_id, event_time_utc, event_time_baghdad, ...)."""
```

- لكل قالب `weekly`: أقرب `weekday` + `utc_time` ضمن النافذة.
- لكل قالب `monthly_first_friday`: أول جمعة من الشهر الحالي أو القادم (إن كانت الحالية قد مرّت).
- لكل قالب `monthly_mid`: اليوم 13 من الشهر الحالي/القادم (تقريب شائع لتوقيت CPI).
- يُحدَّد `event_time_baghdad = event_time_utc + timedelta(hours=3)`.

### 4.3 حساب الحالة (Status) و العد التنازلي

```python
def compute_status(event_time_utc: datetime, impact: str, now_utc: datetime) -> str:
    """
    delta = (event_time_utc - now_utc).total_seconds()
    - delta > 1800                          -> "upcoming"      (قادم)
    - 0 < delta <= 1800                     -> "imminent"      (قريب جدًا)
    - -900 <= delta <= 0                    -> "released"      (صدر — داخل نافذة +15 دقيقة)
    - delta < -900                          -> "risk_ended"    (انتهت فترة الخطر)
    """
```

- العد التنازلي (`minutes_to_event` / `seconds_to_event`) يُحسب من `event_time_utc - now`، ويُرجَع كرقم بالثواني ضمن استجابة `top-bar` و `events`. **العد التنازلي الحي على الواجهة** يُحدَّث كل ثانية محلياً عبر `setInterval` بدون أي استدعاء API إضافي (يُعاد المزامنة مع السيرفر فقط عند التحديث التلقائي/اليدوي).

### 4.4 منطقة الخطر الخبرية (Risk Window)

```python
def is_in_risk_window(event_time_utc: datetime, now_utc: datetime, impact: str) -> bool:
    """High-impact only: True if now is within
    [event_time_utc - 5min, event_time_utc + 15min]."""
    if impact != "high":
        return False
    delta = (event_time_utc - now_utc).total_seconds()
    return -900 <= delta <= 300   # -15min..+5min بالعكس: delta سالب = الحدث قد مرّ
```

(الصياغة الدقيقة: `now` بين `event_time - 5min` و `event_time + 15min` ⇔ `delta` بين `-15min` و `+5min`.)

### 4.5 المزامنة

```python
def sync_calendar_events(db: Session, now_utc: datetime | None = None) -> dict:
    """Generate occurrences, upsert into economic_news_events by event_id,
    recompute status for all rows within the active window, and return
    counters: {"generated": N, "upserted": N, "activeWindowCount": N}."""
```

- لا حذف لأي صف قديم — الصفوف التي انتهت (`risk_ended` منذ أكثر من يوم) تبقى للتاريخ، ويمكن لاحقاً (Cron منفصل، خارج هذه المرحلة) تنظيفها مثل باقي الجداول.

---

## 5. Endpoints (FastAPI، `main.py`)

### `GET /api/news-radar/events`
**Query params:** `impact` (`high|medium|low|None`), `currency` (`USD|EUR|GBP|None`), `symbol` (`XAUUSD|...|None`), `days_ahead` (افتراضي 7، 1-14).

**منطق:**
1. `sync_calendar_events(db)` لا يُستدعى هنا (فقط القراءة) — القراءة تعتمد على آخر مزامنة (يدوية أو من الحلقة الخلفية).
2. يقرأ من `economic_news_events` حيث `event_time_utc >= now - 1 day` و`<= now + days_ahead`.
3. يُعاد حساب `status` لكل صف عبر `compute_status()` (ديناميكي، لا يعتمد على القيمة المخزنة).
4. فلترة `impact`/`currency`/`symbol` (الأخير عبر `json.loads(affected_symbols)`).
5. ترتيب تصاعدي بـ `event_time_utc`.

**استجابة:**
```json
{
  "ok": true,
  "total": 8,
  "events": [ { ...EconomicNewsEvent.to_dict(), "status": "imminent", "secondsToEvent": 1340 } ]
}
```

### `POST /api/news-radar/refresh-now`
- يستدعي `sync_calendar_events(db, now_utc=datetime.now(timezone.utc))`.
- يُرجع نفس شكل `/events` (القائمة المحدّثة ضمن `days_ahead=7` الافتراضي) + `lastUpdated` (ISO UTC + بغداد).
```json
{ "ok": true, "lastUpdated": "...", "lastUpdatedBaghdad": "...", "total": 8, "events": [...] }
```

### `GET /api/news-radar/top-bar`
- يقرأ أقرب حدث (`event_time_utc >= now`) بأي تأثير → "الخبر القادم".
- يحدد إن كانت أي صفوف `impact="high"` ضمن `is_in_risk_window()` الآن → `riskWarning`.
```json
{
  "ok": true,
  "nextEvent": { ...EconomicNewsEvent.to_dict(), "secondsToEvent": 9340 },
  "inRiskWindow": false,
  "riskWarning": null,
  "riskEvents": []
}
```
عند وجود منطقة خطر:
```json
{
  "ok": true,
  "nextEvent": {...},
  "inRiskWindow": true,
  "riskWarning": "تحذير: يوجد خبر عالي التأثير قريب على الدولار (CPI الأمريكي). يفضل الحذر من فتح صفقات جديدة على الذهب أو أزواج الدولار حتى انتهاء فترة الخبر.",
  "riskEvents": [ {...} ]
}
```

---

## 6. المهمة الخلفية `run_news_radar_sync()`

في `main.py`، تُسجَّل في `_startup()` عبر `asyncio.create_task(run_news_radar_sync())`، على نمط `run_mt5_trade_sync()`:

```python
async def run_news_radar_sync() -> None:
    while True:
        try:
            db = SessionLocal()
            try:
                sync_calendar_events(db, now_utc=datetime.now(timezone.utc))
                db.commit()
                next_high_impact_seconds = _seconds_to_next_high_impact(db)
            finally:
                db.close()
        except Exception:
            logger.exception("news_radar_sync: cycle failed")
            next_high_impact_seconds = None

        # فاصل ديناميكي: 60 ثانية إذا خبر عالي التأثير ضمن 30 دقيقة، وإلا 300 ثانية
        if next_high_impact_seconds is not None and next_high_impact_seconds <= 1800:
            await asyncio.sleep(60)
        else:
            await asyncio.sleep(300)
```

- **هذه الحلقة لا ترسل أي تيليجرام** — فقط تُحدّث `economic_news_events`. الربط بتيليجرام/التحليل = المرحلة 2.

---

## 7. صفحة `/reports` بعد التعديل

### 7.1 البنية العامة (إعادة بناء `page.tsx`)

```
"use client"
├─ useState: events[], topBar, lastUpdated, loading, refreshing, error, filter
├─ useEffect (mount): loadAll()  → GET /api/news-radar/events + /api/news-radar/top-bar
├─ useEffect (auto-refresh): setInterval ديناميكي (60s أو 300s حسب topBar.inRiskWindow أو
│    أقرب خبر عالي التأثير ضمن 30 دقيقة) → يستدعي loadAll()
├─ useEffect (countdown tick): setInterval(1000) يُحدّث عرض العد التنازلي محلياً فقط
├─ syncNow()  → POST /api/news-radar/refresh-now → يحدّث events + lastUpdated (بدون reload)
```

### 7.2 الشريط العلوي "ساعات الأخبار المهمة"

بطاقة ثابتة أعلى الصفحة (قبل أي محتوى آخر) تعرض:
- "الخبر القادم: {title}"
- "الوقت: {event_time_baghdad} بتوقيت بغداد"
- "المتبقي: {HH:MM:SS}" (عد تنازلي حي client-side)
- "التأثير: {عالي|متوسط|منخفض}" (badge ملوّن، نفس `IMPACT_META` الحالي)
- "الأصول المتأثرة: {affected_symbols.join(' / ')}"
- "الحالة: {قادم|قريب جدًا|صدر|انتهت فترة الخطر}"

وتحتها مباشرة شريط توضيح ثابت (وفق طلب أحمد):
> ⚠️ تقويم أخبار منظم تجريبي/شبه ديناميكي، وليس مصدر أخبار اقتصادي مباشر. سيتم ربط مصدر أخبار حقيقي لاحقًا.

### 7.3 بانر "آخر تحديث" + زر "تحديث الأخبار الآن"

شريط أفقي:
- زر "🔄 تحديث الأخبار الآن" — `onClick={syncNow}`، يعرض "جاري التحديث..." أثناء `refreshing=true`، `disabled` أثناء التحميل.
- "آخر تحديث: {lastUpdated بتوقيت بغداد}" — يُحدَّث بعد كل `loadAll()`/`syncNow()`.
- عند فشل أي طلب: رسالة عربية حمراء "تعذّر تحديث الأخبار — تأكد من تشغيل خدمة MT5 المحلية" (نفس نمط `trade-history`).

### 7.4 بانر منطقة الخطر الخبرية

إذا `topBar.inRiskWindow === true`، بانر أحمر بارز أعلى الجدول (تحت الشريط العلوي):
```
⚠️ تحذير: يوجد خبر عالي التأثير قريب/جارٍ ({title}). يفضل الحذر من فتح صفقات جديدة على
{affected_symbols.join(' أو ')} حتى انتهاء فترة الخبر.
```
النص يأتي جاهزاً من `topBar.riskWarning` (مبني في الباكند).

### 7.5 الفلاتر

استبدال الفلاتر الحالية (impact + status + بحث نصي) بصف فلاتر واحد كما طُلب:
```
[ الكل ] [ أخبار عالية التأثير ] [ USD ] [ EUR ] [ GBP ] [ XAUUSD ] [ Crypto ]
```
- "الكل": بدون فلتر.
- "أخبار عالية التأثير": `impact=high`.
- "USD"/"EUR"/"GBP": `currency=<value>`.
- "XAUUSD": `symbol=XAUUSD`.
- "Crypto": فلتر محلي (client-side) على `affected_symbols` التي تحتوي رمزاً ينتهي بـ `-USDT` أو يبدأ بـ `BTC`/`ETH`.

كل تغيير فلتر يعيد طلب `/api/news-radar/events` بالـ query المناسب (أو فلترة محلية للقائمة المحمّلة — الأبسط: تحميل `days_ahead=7` كاملاً مرة واحدة وفلترة محلياً، لتقليل الطلبات؛ **القرار: فلترة محلية client-side** لأن العدد صغير ≤ ~20 حدث).

### 7.6 الجدول

نفس `EventRow` الحالي مع تعديلات:
- إعادة تسمية الأعمدة لتطابق البند 11: الوقت (ببغداد)، العملة، الخبر، التأثير، السابق، المتوقع، الفعلي، **الحالة** (عمود جديد بدل status badge ضمني)، الأصول المتأثرة.
- عمود "الفعلي" يبقى "—" دائماً مع tooltip/ملاحظة "غير متاح — يتطلب مصدر بيانات حي".
- "الحالة" تُعرض كـ badge: قادم (رمادي) / قريب جدًا (كهرماني) / صدر (أزرق) / انتهت فترة الخطر (أخضر خافت).

---

## 8. عقد المرحلة 2 — `getNewsRiskContext(symbol, timeframe)` (تصميم فقط، غير منفَّذ)

دالة بايثون مستقبلية في `mt5_readonly_service/news_risk.py` (لم تُنشأ في هذه المرحلة):

```python
def get_news_risk_context(symbol: str, timeframe: str, db: Session,
                           now_utc: datetime | None = None) -> dict:
    """
    Returns:
    {
        "symbol": str,
        "timeframe": str,
        "hasNearbyNews": bool,
        "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "EXTREME",
        "nextEvent": dict | None,          # EconomicNewsEvent.to_dict() أو None
        "minutesToEvent": float | None,
        "affectedSymbols": list[str],
        "shouldReduceConfidence": bool,
        "shouldForceWait": bool,
        "arabicExplanation": str,
    }
    """
```

**أساس البيانات:** هذه الدالة تستعلم مباشرة من جدول `economic_news_events` (المنشأ في هذه المرحلة)، وتطبّق قواعد الربط بالرمز:
- **XAUUSD**: أي خبر `currency=USD` و`impact=high` ضمن ±30 دقيقة → `HIGH`/`EXTREME` (EXTREME إذا داخل risk window ±5/+15).
- **أزواج الفوركس** (مثل EURUSD): خبر يطابق إما عملة الأساس أو عملة التسعير للزوج.
- **الكريبتو (OKX)**: فقط أخبار `currency=USD` `impact=high` من فئة معينة (Fed/CPI/إلخ) → تحذير `MEDIUM` كحد أقصى، لا `shouldForceWait`.

**مخرجات `riskLevel` → القرار:**
- `EXTREME`/`HIGH` → `shouldReduceConfidence=true`؛ و`shouldForceWait=true` فقط إذا كانت قوة التوصية الأصلية ضعيفة (دون عتبة تُحدَّد في المرحلة 2، مثلاً `signal_strength < 0.65`).
- `MEDIUM` → `shouldReduceConfidence=true`, `shouldForceWait=false`.
- `LOW` → كل الأعلام `false`.

هذا العقد **جاهز للاستهلاك** بمجرد توفر `economic_news_events` (مكتمل في هذه المرحلة)، مما يجعل تنفيذ المرحلة 2 مجرد: (أ) كتابة هذه الدالة، (ب) استدعاؤها من `CouncilEngine.analyze_market` وتخزين النتيجة في حقل `news` بـ `CouncilVerdict`، (ج) عرضها في كرت التوصية، (د) إضافتها لرسالة تيليجرام مع throttling مستقل.

---

## 9. خطة التحقق (المرحلة 1)

```bash
cd mt5_readonly_service
python -m py_compile main.py database.py economic_calendar.py agents.py
cd ..
pnpm exec tsc --noEmit     # EXIT:0
pnpm run build              # نجاح كامل + ظهور /api/news-radar/* و /reports
```
اختبار يدوي:
1. `economic_news_events` يُنشأ تلقائياً عبر `init_db()`.
2. `POST /api/news-radar/refresh-now` يُرجع `ok:true` وعدد أحداث > 0.
3. `GET /api/news-radar/events` يُرجع نفس البيانات مع `status` محسوب.
4. `GET /api/news-radar/top-bar` يُرجع `nextEvent` صالح.
5. فتح `/reports`: الشريط العلوي يعرض الخبر القادم + عد تنازلي يتحرك كل ثانية، زر التحديث يعمل بدون reload، الفلاتر تعمل، "آخر تحديث" يظهر بتوقيت بغداد.
6. (محاكاة) ضبط الوقت/البيانات يدوياً لإثبات ظهور بانر "منطقة خطر خبرية" عند الاقتراب من حدث عالي التأثير.
7. تأكيد عدم وجود `order_send|order_close|order_modify|order_check|OrderSend` في أي ملف جديد.
8. تأكيد `git status --short` لا يحتوي أي تغيير في `convex/`.

---

## 10. ما يبقى للمرحلة 2 (غير منفَّذ هنا)

- إنشاء `mt5_readonly_service/news_risk.py` وتنفيذ `get_news_risk_context()` فعلياً.
- إضافة حقل `news: dict | None = None` إلى `CouncilVerdict` واستدعاء الدالة من `analyze_market`.
- منطق "تخفيض الثقة" / "تحويل إلى WAIT" عند توصية ضعيفة + خبر عالي التأثير قريب.
- قسم "تأثير الأخبار" في كرت التوصية (الواجهة).
- فقرة "تأثير الأخبار" في رسالة تيليجرام + throttling مستقل لكل (رمز، event_id) لمنع التكرار.
- لا تغييرات على `convex/` في أي من المرحلتين.
