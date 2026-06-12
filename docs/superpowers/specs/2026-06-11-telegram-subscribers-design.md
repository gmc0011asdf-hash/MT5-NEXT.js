# تصميم: نظام اشتراك تلقائي في بوت تيليجرام (Telegram Subscribers)

تاريخ: 2026-06-11
الحالة: مقترح — بانتظار موافقة أحمد

## 1. الهدف

السماح لأي مستخدم بإرسال `/start` لبوت تيليجرام الخاص بالنظام كي يصبح
"مشتركاً" يستقبل تلقائياً التوصيات المعتمدة (نفس التوصيات التي يرسلها
النظام حالياً للمحادثة الواحدة المهيأة في `system_config.telegram_chat_id`)،
مع `/stop` لإلغاء الاشتراك و`/help` للتعليمات.

هذا **إضافي بالكامل** فوق النظام الحالي — التنبيه الحالي للمحادثة الواحدة
يبقى يعمل دون أي تغيير.

## 2. القيود المعمارية ذات الصلة

- الخدمة `mt5_readonly_service` تعمل محلياً فقط (`127.0.0.1:8010`) — **لا يوجد
  URL عام**، لذلك Webhook غير ممكن. الحل: **Polling** عبر
  `getUpdates` في مهمة خلفية (`asyncio.create_task`)، بنفس نمط
  `run_live_agent_council_scan` / `run_watchlist_multi_timeframe_scan`.
- المشروع يستخدم SQLite عبر SQLAlchemy (`database.py`) — **لا Prisma ولا
  Convex** لهذا الجزء. سنضيف جدولين جديدين بنفس النمط الموجود.
- التوكن (`TELEGRAM_BOT_TOKEN`) ومحادثة المالك (`telegram_chat_id`) تُقرأ
  حالياً من `system_config` (أولوية) ثم env (احتياط) عبر `_get_cred()`. نفس
  النمط يُستخدم لقراءة `telegram_proxy_url` عند الحاجة لـ proxy.
- **النطاق الزمني للبث**: بعد المرحلة C، حلقة `run_watchlist_multi_timeframe_scan`
  هي المصدر الوحيد الذي يستدعي `analyze_market(..., send_alert=True)`. سنُعلّق
  بث المشتركين على **نفس** الشرط — أي فقط عندما `send_alert=True` و
  `verdict.approved` و`verdict.direction is not None` (نفس شرط
  `_send_telegram_alert` الحالي بالضبط). لا بث من المسح الخلفي العام (H1).

## 3. قاعدة البيانات — جدولان جديدان في `database.py`

### `TelegramSubscriber` (`telegram_subscribers`)

| العمود | النوع | ملاحظات |
|---|---|---|
| id | Integer PK autoincrement | |
| telegram_user_id | String(32) | معرّف المستخدم في تيليجرام |
| chat_id | String(32) unique not null | معرّف المحادثة — مفتاح الإرسال |
| username | String(64) nullable | |
| first_name | String(128) nullable | |
| last_name | String(128) nullable | |
| is_active | Integer (0/1) default 1 | |
| created_at | DateTime(tz) default utcnow | |
| updated_at | DateTime(tz) default utcnow, onupdate utcnow | |
| last_start_at | DateTime(tz) nullable | آخر مرة أرسل فيها `/start` |

- Upsert بالمفتاح `chat_id`: إن وُجد → تحديث الحقول + `is_active=1` +
  `last_start_at=now`؛ إن لم يوجد → إدراج جديد.
- `/stop` → `is_active=0`, `updated_at=now` (لا حذف صفوف إطلاقاً).

### `TelegramRecommendationDelivery` (`telegram_recommendation_deliveries`)

| العمود | النوع | ملاحظات |
|---|---|---|
| id | Integer PK autoincrement | |
| recommendation_id | String(128) not null | `f"{symbol}|{direction}|{timestamp.isoformat()}"` |
| chat_id | String(32) not null | |
| sent_at | DateTime(tz) default utcnow | |
| status | String(16) not null | `"sent"` \| `"failed"` |
| error_message | Text nullable | |

- Index مركّب على `(recommendation_id, chat_id)` لمنع الإرسال المكرر لنفس
  المشترك لنفس التوصية (تحقق قبل الإرسال).

كلا الجدولين يُنشآن تلقائياً عبر `init_db()` (`Base.metadata.create_all`) —
لا حاجة لِmigration يدوي (SQLite + SQLAlchemy `create_all`).

## 4. وحدة جديدة: `mt5_readonly_service/telegram_subscribers.py`

ملف مستقل (لا تعديل كبير على `agents.py`/`main.py`)، يحتوي:

- `_get_telegram_credentials(db) -> tuple[token, proxy_url] | None` — نفس
  نمط `_get_cred` الموجود في `main.py` (يُعاد استخدامه محلياً).
- `_is_admin(telegram_user_id: str) -> bool` — يقارن مع
  `TELEGRAM_ADMIN_IDS` (env, قائمة مفصولة بفواصل). يُستخدم لاحقاً لأي أمر
  إداري (حالياً: أمر `/subscribers` فقط — انظر §6).
- `upsert_subscriber(db, *, telegram_user_id, chat_id, username, first_name, last_name)`
- `deactivate_subscriber(db, chat_id)`
- `get_active_subscribers(db) -> list[TelegramSubscriber]`
- `format_recommendation_message(verdict: CouncilVerdict) -> str` — قالب
  عربي جديد مطابق لما طلبه أحمد (راجع §7)، منفصل عن قالب
  `_send_telegram_alert` الحالي (الذي يبقى كما هو دون تغيير لأي مستخدم).
- `broadcast_recommendation(verdict: CouncilVerdict, db: Session) -> None`:
  - يبني `recommendation_id`.
  - يجلب `get_active_subscribers(db)`.
  - لكل مشترك: يتحقق من عدم وجود صف `sent` سابق لنفس
    `(recommendation_id, chat_id)`، ثم يرسل عبر `requests.post sendMessage`،
    ويسجّل صف `TelegramRecommendationDelivery` بالنتيجة (`sent`/`failed` +
    `error_message`).
  - فشل إرسال لمشترك واحد **لا يوقف** الباقين (try/except لكل مشترك على حدة).
  - لا يرفع استثناءً أبداً للمستدعي (نفس فلسفة `_send_telegram_alert`).

## 5. الـ Polling Loop — دالة جديدة `run_telegram_bot_polling()`

تُضاف في `telegram_subscribers.py` وتُسجَّل في `main.py: _startup()` عبر
`asyncio.create_task(run_telegram_bot_polling())` (سطر إضافي واحد، بجانب
المهمتين الحاليتين).

- حلقة `while True` غير منتهية، تعمل عبر `asyncio.to_thread` لاستدعاء
  `requests.get(.../getUpdates, params={"offset": ..., "timeout": 25})`
  (long polling).
- الإزاحة (`offset`) تُحفظ بعد كل دفعة في `system_config` تحت مفتاح
  `telegram_update_offset` (نفس آلية `SystemConfig` الموجودة) — تستمر بعد
  إعادة التشغيل دون تكرار معالجة رسائل قديمة.
- إن لم يكن `TELEGRAM_BOT_TOKEN` مهيأً، الحلقة تكتفي بتسجيل `logger.debug`
  مرة وتنام دقيقة ثم تعيد المحاولة (بدون توقف الخدمة — يطابق
  "النظام مستمر بالعمل").
- أي استثناء داخل الحلقة يُسجَّل ويُكمل (نفس نمط معالجة الأخطاء في
  `run_live_agent_council_scan`).
- معالجة الرسائل الواردة (نص فقط، خاص أو مجموعات):
  - `/start` أو `/start@<botname>` → `upsert_subscriber(...)` + رد ترحيبي
    (§8).
  - `/stop` → `deactivate_subscriber(...)` + رد تأكيد (§8).
  - `/help` → رد بقائمة الأوامر (§8).
  - `/subscribers` (أمر إداري) → إن `_is_admin(from.id)` يرد بعدد المشتركين
    النشطين/الإجمالي؛ غير ذلك يُتجاهل بصمت (لا كشف معلومات لغير المدير).
  - أي رسالة أخرى → تُتجاهل (لا رد) — تبسيطاً، غير مطلوب أكثر من ذلك حالياً.

## 6. الربط مع `agents.py`

في `analyze_market()`، داخل الكتلة الحالية:

```python
if send_alert:
    self._send_telegram_alert(winner)
```

تصبح:

```python
if send_alert:
    self._send_telegram_alert(winner)
    if db is not None:
        from telegram_subscribers import broadcast_recommendation
        broadcast_recommendation(winner, db)
```

(import محلي لتفادي أي اعتماد دائري عند تحميل الوحدة — نفس أسلوب
`_refresh_cfg_from_db`). `db` متوفر دائماً عند `send_alert=True` (يأتي فقط
من `run_watchlist_multi_timeframe_scan` التي تمرر `db`).

## 7. صيغة رسالة التوصية للمشتركين

دالة جديدة منفصلة عن `_send_telegram_alert` الحالية (التي تبقى كما هي):

```
📢 توصية جديدة من النظام
━━━━━━━━━━━━━━━━━━━
🪙 الأصل: {symbol}
📈 الاتجاه: {شراء | بيع}
🎯 نوع الدخول: سعر السوق (MARKET)
──────────────────
📥 الدخول: {entry}
🛑 وقف الخسارة: {sl}
🏆 الأهداف:
   TP1: {tp}
──────────────────
📊 نسبة المخاطرة: {risk_percent}%
⭐ درجة الثقة: {signal_strength * 100}%
⏳ مدة صلاحية التوصية: {duration}
📝 سبب التوصية: {confluence level / aligned firewalls}
──────────────────
⏰ {وقت الإصدار بتوقيت بغداد}

⚠️ تنبيه: هذه توصية تحليلية وليست أمراً إلزامياً بالشراء أو البيع.
قرار التداول وإدارة المخاطر مسؤوليتك الشخصية.
```

ملاحظة: النظام الحالي يولّد هدفاً واحداً فقط (`tp`) — سيُعرض كـ `TP1`،
ولا يوجد `TP2` (تجنباً لعرض بيانات وهمية، Rule 5).
"نوع الدخول" يكون دائماً "سعر السوق (MARKET)" لأن النظام لا يولّد أوامر
معلّقة (Pending/Limit/Stop) في هذه المرحلة.

## 8. رسائل البوت (عربية بالكامل)

**`/start`**
```
مرحبًا بك في نظام التوصيات والتحليل.
تم تسجيلك بنجاح، وستصلك التوصيات المعتمدة من النظام عند صدورها.

تنبيه مهم:
هذه التوصيات للتحليل والمتابعة وليست أمرًا مباشرًا بالشراء أو البيع.
قرار التداول وإدارة المخاطر مسؤوليتك الشخصية.
```

**`/stop`**
```
تم إيقاف استقبال التوصيات. يمكنك الاشتراك مرة أخرى بإرسال /start
```

**`/help`**
```
الأوامر المتاحة:
/start — للاشتراك في التوصيات
/stop — لإيقاف الاشتراك
/help — لعرض هذه التعليمات
```

## 9. متغيرات البيئة

- `TELEGRAM_BOT_TOKEN` — موجود مسبقاً (env احتياطي، الأولوية لـ
  `system_config.telegram_bot_token`). لا تغيير.
- `TELEGRAM_ADMIN_IDS` — **جديد**. قائمة `telegram_user_id` مفصولة بفواصل،
  تُقرأ من `os.environ` فقط (قرار نشر، لا حاجة لتخزينه في DB). تُستخدم حصراً
  للسماح بأمر `/subscribers` للقراءة فقط.
- لا تخزين لأي توكن داخل الكود — كل شيء عبر `system_config` أو env كما هو
  معمول به.

## 10. الاختبار

1. تشغيل الخدمة (`uvicorn main:app --port 8010`) بعد ضبط
   `telegram_bot_token` عبر `/api/config` (كما هو معمول به).
2. إرسال `/start` من حساب تيليجرام → التحقق من صف جديد في
   `telegram_subscribers` (`is_active=1`) عبر فحص `local_quant.db`.
3. تشغيل دورة `run_watchlist_multi_timeframe_scan` (أو محاكاتها) بحيث تُنتج
   `verdict.approved=True` لرمز ضمن قائمة المتابعة → التحقق من وصول رسالة
   التوصية الجديدة (القالب في §7) إلى نفس المحادثة، ومن وجود صف
   `sent` في `telegram_recommendation_deliveries`.
4. إرسال `/stop` → التحقق من `is_active=0` وعدم وصول أي توصية تالية لنفس
   المحادثة، مع استمرار وصولها للمحادثة المهيأة في `telegram_chat_id`
   (التنبيه القديم) كما كان.
5. (اختياري) إرسال `/subscribers` من حساب مدرج في `TELEGRAM_ADMIN_IDS` →
   التحقق من الرد بالعدد، وتجاهله من حساب آخر.

## 11. الملفات المتأثرة (متوقع)

- `mt5_readonly_service/database.py` — جدولان جديدان (إضافة فقط).
- `mt5_readonly_service/telegram_subscribers.py` — **جديد** (المنطق
  بالكامل: subscribers CRUD + polling + broadcast + formatting).
- `mt5_readonly_service/agents.py` — سطرا استدعاء إضافيان داخل
  `if send_alert:` (لا تعديل على `_send_telegram_alert` ولا التوقيعات).
- `mt5_readonly_service/main.py` — سطر واحد في `_startup()` لتسجيل المهمة
  الخلفية الجديدة.
- توثيق `TELEGRAM_ADMIN_IDS` في أي ملف بيئة موجود (لا يوجد
  `.env.local.example` حالياً — سنذكره في `PROJECT_CONTEXT.md`/تقرير
  المرحلة فقط، دون إنشاء ملفات جديدة غير ضرورية).

## 12. خارج النطاق (غير مطلوب الآن)

- لا أوامر إدارية خطيرة (لا حذف، لا إرسال يدوي لتوصية، لا تنفيذ صفقات) —
  يتوافق مع Stage 14 المقفلة و`AGENT_RULES`.
- لا Webhook، لا Prisma، لا Convex لهذا الجزء.
- لا تعديل على رسالة `_send_telegram_alert` الحالية أو على نطاق التنبيهات
  الذي حددته المرحلة C.
