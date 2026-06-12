# Telegram Subscribers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Telegram subscriber system (`/start`, `/stop`, `/help`) to `mt5_readonly_service` so any user can self-subscribe and automatically receive the same approved-signal recommendations the system already sends to the single configured `telegram_chat_id`, without changing any existing behavior.

**Architecture:** Two new SQLite tables (`TelegramSubscriber`, `TelegramRecommendationDelivery`) added to `database.py`. All new logic lives in a new module `mt5_readonly_service/telegram_subscribers.py` (subscriber CRUD, Arabic message formatting, broadcast with per-subscriber delivery logging, and a `getUpdates`-based polling loop). `agents.py` gets a 2-line additive hook inside the existing `if send_alert:` block. `main.py` gets 1 line in `_startup()` to launch the polling task.

**Tech Stack:** Python 3, FastAPI, SQLAlchemy (SQLite), `requests` (sync HTTP to Telegram Bot API), `asyncio.create_task` + `asyncio.to_thread` for the background polling loop (matches existing `run_live_agent_council_scan` pattern).

**Reference spec:** `docs/superpowers/specs/2026-06-11-telegram-subscribers-design.md`

---

## Important context for the engineer

- This project has **no pytest / test framework** installed. Verification is done via:
  - `python -m py_compile <file>.py` (must succeed for every changed `.py` file — AGENT_RULES Rule 6)
  - small one-off `python -c "..."` scripts run against the real `local_quant.db` (or a temp copy) to exercise DB functions directly — these are NOT permanent test files, just manual verification commands shown in each task
  - manual Telegram testing at the end (Task 7)
- **Never hardcode the bot token.** Credentials come from `system_config` (DB) first, then `os.environ` — exactly like the existing `_get_cred()` helper in `main.py:2030`.
- **Do not modify** `_send_telegram_alert` in `agents.py` (existing single-chat alert) — it must keep working unchanged.
- **Do not modify** `run_live_agent_council_scan` or its `send_alerts=False` calls (Stage C, already in place) — broadcasting only happens via the `send_alert=True` path (the watchlist scan).
- Follow the existing code style: 4-space indent, type hints, Arabic comments/strings for user-facing text, English for internal comments, `logger` from `logging.getLogger(__name__)`, never raise from Telegram I/O (always try/except + log).

---

### Task 1: Add `TelegramSubscriber` and `TelegramRecommendationDelivery` ORM models

**Files:**
- Modify: `mt5_readonly_service/database.py`

- [ ] **Step 1: Add the two new model classes**

Open `mt5_readonly_service/database.py`. Find the `SystemConfig` class (starts at line 320) and insert the two new classes **before** it (i.e. after `TripleFirewallSignal`, which ends at line 318, and before the `class SystemConfig(Base):` block). Insert this code:

```python
class TelegramSubscriber(Base):
    """
    A user who has sent /start to the analytical Telegram bot and opted in
    to receive approved-signal recommendations (additive to the legacy
    single-chat alert configured via system_config.telegram_chat_id).

    Rows are never deleted: /stop sets is_active=0 so history (and the
    ability to re-subscribe with /start) is preserved.
    """

    __tablename__ = "telegram_subscribers"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    telegram_user_id  = Column(String(32), nullable=False)
    chat_id           = Column(String(32), nullable=False, unique=True)
    username          = Column(String(64), nullable=True)
    first_name        = Column(String(128), nullable=True)
    last_name         = Column(String(128), nullable=True)
    is_active         = Column(Integer, nullable=False, default=1)  # 0/1 boolean
    created_at        = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at        = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
    last_start_at     = Column(DateTime(timezone=True), nullable=True)

    def to_dict(self) -> dict:
        return {
            "id":              self.id,
            "telegramUserId":  self.telegram_user_id,
            "chatId":          self.chat_id,
            "username":        self.username,
            "firstName":       self.first_name,
            "lastName":        self.last_name,
            "isActive":        bool(self.is_active),
            "createdAt":       self.created_at.isoformat() if self.created_at else None,
            "updatedAt":       self.updated_at.isoformat() if self.updated_at else None,
            "lastStartAt":     self.last_start_at.isoformat() if self.last_start_at else None,
        }


class TelegramRecommendationDelivery(Base):
    """
    Audit log of recommendation broadcasts to subscribers.

    One row per (recommendation_id, chat_id) attempt. Used to avoid sending
    the same recommendation twice to the same subscriber and to record
    per-subscriber failures without affecting other subscribers.
    """

    __tablename__ = "telegram_recommendation_deliveries"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    recommendation_id  = Column(String(128), nullable=False)
    chat_id            = Column(String(32), nullable=False)
    sent_at            = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    status             = Column(String(16), nullable=False)  # "sent" | "failed"
    error_message      = Column(Text, nullable=True)

    __table_args__ = (
        Index("ix_trd_recommendation_chat", "recommendation_id", "chat_id"),
    )

    def to_dict(self) -> dict:
        return {
            "id":               self.id,
            "recommendationId": self.recommendation_id,
            "chatId":           self.chat_id,
            "sentAt":           self.sent_at.isoformat() if self.sent_at else None,
            "status":           self.status,
            "errorMessage":     self.error_message,
        }
```

- [ ] **Step 2: Compile-check**

Run:
```bash
cd mt5_readonly_service
python -m py_compile database.py
```
Expected: no output (success).

- [ ] **Step 3: Verify tables are created by `init_db()`**

Run this from `mt5_readonly_service/`:
```bash
python -c "
from database import init_db, SessionLocal, TelegramSubscriber, TelegramRecommendationDelivery
init_db()
db = SessionLocal()
print('subscribers:', db.query(TelegramSubscriber).count())
print('deliveries:', db.query(TelegramRecommendationDelivery).count())
db.close()
"
```
Expected output:
```
subscribers: 0
deliveries: 0
```
(This confirms both tables now exist in `local_quant.db` with zero rows — no existing data touched.)

- [ ] **Step 4: Commit**

```bash
git add mt5_readonly_service/database.py
git commit -m "feat(telegram): add subscriber and delivery log tables"
```

---

### Task 2: Subscriber CRUD helpers

**Files:**
- Create: `mt5_readonly_service/telegram_subscribers.py`

- [ ] **Step 1: Create the module with imports, admin check, and CRUD functions**

Create `mt5_readonly_service/telegram_subscribers.py`:

```python
"""
telegram_subscribers.py -- Opt-in Telegram subscriber system.

Additive to the existing single-chat Telegram alert (agents.py:
_send_telegram_alert, configured via system_config.telegram_chat_id).
Anyone can send /start to the bot to subscribe; /stop unsubscribes;
/help lists commands. Approved recommendations from the watchlist
multi-timeframe scan (the sole send_alert=True path, per Stage C) are
broadcast to all active subscribers.

Read-only contract: this module never executes trades. It only sends
Telegram messages and reads/writes subscriber + delivery-log rows.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy.orm import Session

from database import (
    SessionLocal,
    SystemConfig,
    TelegramRecommendationDelivery,
    TelegramSubscriber,
)

logger = logging.getLogger(__name__)

_TELEGRAM_TIMEOUT: float = 8.0  # seconds


# ---------------------------------------------------------------------------
# Credentials + admin check
# ---------------------------------------------------------------------------

def _get_telegram_credentials(db: Session) -> tuple[str | None, str | None]:
    """Return (bot_token, proxy_url). system_config takes priority over env,
    matching the existing _get_cred() pattern in main.py."""

    def _get_cred(key: str, env_key: str) -> str | None:
        row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
        if row and row.value:
            return row.value
        return os.environ.get(env_key)

    token = _get_cred("telegram_bot_token", "TELEGRAM_BOT_TOKEN")
    proxy_url = _get_cred("telegram_proxy_url", "TELEGRAM_PROXY_URL")
    return token, proxy_url


def _is_admin(telegram_user_id: str | int | None) -> bool:
    """Check TELEGRAM_ADMIN_IDS env var (comma-separated user ids)."""
    if telegram_user_id is None:
        return False
    raw = os.environ.get("TELEGRAM_ADMIN_IDS", "")
    admin_ids = {part.strip() for part in raw.split(",") if part.strip()}
    return str(telegram_user_id) in admin_ids


# ---------------------------------------------------------------------------
# Subscriber CRUD
# ---------------------------------------------------------------------------

def upsert_subscriber(
    db: Session,
    *,
    telegram_user_id: str,
    chat_id: str,
    username: str | None,
    first_name: str | None,
    last_name: str | None,
) -> TelegramSubscriber:
    """Insert a new subscriber or reactivate/update an existing one (by chat_id)."""
    now = datetime.now(timezone.utc)
    row = db.query(TelegramSubscriber).filter(TelegramSubscriber.chat_id == chat_id).first()
    if row is None:
        row = TelegramSubscriber(
            telegram_user_id=telegram_user_id,
            chat_id=chat_id,
            username=username,
            first_name=first_name,
            last_name=last_name,
            is_active=1,
            created_at=now,
            updated_at=now,
            last_start_at=now,
        )
        db.add(row)
    else:
        row.telegram_user_id = telegram_user_id
        row.username = username
        row.first_name = first_name
        row.last_name = last_name
        row.is_active = 1
        row.updated_at = now
        row.last_start_at = now
    db.commit()
    db.refresh(row)
    return row


def deactivate_subscriber(db: Session, chat_id: str) -> None:
    """Set is_active=0 for a subscriber. Never deletes the row."""
    row = db.query(TelegramSubscriber).filter(TelegramSubscriber.chat_id == chat_id).first()
    if row is None:
        return
    row.is_active = 0
    row.updated_at = datetime.now(timezone.utc)
    db.commit()


def get_active_subscribers(db: Session) -> list[TelegramSubscriber]:
    return db.query(TelegramSubscriber).filter(TelegramSubscriber.is_active == 1).all()
```

- [ ] **Step 2: Compile-check**

```bash
cd mt5_readonly_service
python -m py_compile telegram_subscribers.py
```
Expected: no output.

- [ ] **Step 3: Manual verification of CRUD functions**

```bash
python -c "
from database import init_db, SessionLocal
import telegram_subscribers as ts

init_db()
db = SessionLocal()

# subscribe
row = ts.upsert_subscriber(db, telegram_user_id='999111', chat_id='999111', username='tester', first_name='Test', last_name=None)
print('after start:', row.to_dict())

active = ts.get_active_subscribers(db)
print('active count:', len(active))

# unsubscribe
ts.deactivate_subscriber(db, '999111')
active = ts.get_active_subscribers(db)
print('active count after stop:', len(active))

# resubscribe (must update, not duplicate)
row2 = ts.upsert_subscriber(db, telegram_user_id='999111', chat_id='999111', username='tester2', first_name='Test', last_name='User')
print('after restart:', row2.to_dict())
print('total subscriber rows (should be 1):', db.query(ts.TelegramSubscriber).count())

db.close()
"
```
Expected:
- `after start:` shows `isActive: True`, `username: 'tester'`
- `active count: 1`
- `active count after stop: 0`
- `after restart:` shows `isActive: True`, `username: 'tester2'`, `lastName: 'User'`
- `total subscriber rows (should be 1): 1`

- [ ] **Step 4: Clean up the test row**

```bash
python -c "
from database import SessionLocal
import telegram_subscribers as ts
db = SessionLocal()
db.query(ts.TelegramSubscriber).filter(ts.TelegramSubscriber.chat_id == '999111').delete()
db.commit()
db.close()
"
```

- [ ] **Step 5: Commit**

```bash
git add mt5_readonly_service/telegram_subscribers.py
git commit -m "feat(telegram): add subscriber CRUD helpers"
```

---

### Task 3: Recommendation message formatting + broadcast

**Files:**
- Modify: `mt5_readonly_service/telegram_subscribers.py`

- [ ] **Step 1: Append message formatting and broadcast functions**

Append to `mt5_readonly_service/telegram_subscribers.py` (after `get_active_subscribers`):

```python
# ---------------------------------------------------------------------------
# Recommendation message formatting + broadcast
# ---------------------------------------------------------------------------

def _recommendation_id(verdict) -> str:
    """Deterministic id for one verdict — used for delivery dedup."""
    return f"{verdict.symbol}|{verdict.direction}|{verdict.timestamp.isoformat()}"


def format_recommendation_message(verdict) -> str:
    """Build the Arabic recommendation message sent to subscribers.

    Separate from agents._send_telegram_alert's message (which keeps its
    existing format for the legacy single-chat alert). This system only
    produces market-entry signals (no pending orders), so "نوع الدخول" is
    always "سعر السوق (MARKET)", and only one target (TP1) is shown --
    the engine does not compute a TP2.
    """
    digits = verdict.digits if verdict.digits is not None else 5
    entry_str = f"{verdict.entry:.{digits}f}" if verdict.entry is not None else "—"
    sl_str = f"{verdict.sl:.{digits}f}" if verdict.sl is not None else "—"
    tp_str = f"{verdict.tp:.{digits}f}" if verdict.tp is not None else "—"

    direction_label = "شراء" if verdict.direction == "BUY" else "بيع" if verdict.direction == "SELL" else "—"

    risk_percent = verdict.risk_percent if verdict.risk_percent is not None else None
    risk_str = f"{risk_percent:.1f}%" if risk_percent is not None else "—"

    confidence_str = f"{verdict.signal_strength * 100:.0f}%"
    duration_str = verdict.duration or "—"

    confluence = verdict.confluence or {}
    reason = confluence.get("level") or "—"
    aligned = confluence.get("aligned_count")
    if aligned is not None:
        reason = f"{reason} ({aligned}/3 جدران متوافقة)"

    baghdad_time = verdict.timestamp + timedelta(hours=3)
    time_str = baghdad_time.strftime("%I:%M %p").lstrip("0") + " بتوقيت بغداد"

    return (
        "📢 توصية جديدة من النظام\n"
        "━━━━━━━━━━━━━━━━━━━\n"
        f"🪙 الأصل: {verdict.symbol}\n"
        f"📈 الاتجاه: {direction_label}\n"
        "🎯 نوع الدخول: سعر السوق (MARKET)\n"
        "──────────────────\n"
        f"📥 الدخول: <code>{entry_str}</code>\n"
        f"🛑 وقف الخسارة: <code>{sl_str}</code>\n"
        "🏆 الأهداف:\n"
        f"   TP1: <code>{tp_str}</code>\n"
        "──────────────────\n"
        f"📊 نسبة المخاطرة: {risk_str}\n"
        f"⭐ درجة الثقة: {confidence_str}\n"
        f"⏳ مدة صلاحية التوصية: {duration_str}\n"
        f"📝 سبب التوصية: {reason}\n"
        "──────────────────\n"
        f"⏰ {time_str}\n"
        "\n"
        "⚠️ تنبيه: هذه توصية تحليلية وليست أمراً إلزامياً بالشراء أو البيع.\n"
        "قرار التداول وإدارة المخاطر مسؤوليتك الشخصية."
    )


def _send_message(token: str, chat_id: str, text: str, proxy_url: str | None = None) -> None:
    """Send one Telegram message. Raises on HTTP/network failure (caller logs)."""
    proxies = {"https": proxy_url, "http": proxy_url} if proxy_url else None
    resp = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
        timeout=_TELEGRAM_TIMEOUT,
        proxies=proxies,
    )
    if not resp.ok:
        raise RuntimeError(f"Telegram HTTP {resp.status_code}: {resp.text[:200]}")


def broadcast_recommendation(verdict, db: Session) -> None:
    """Send the recommendation to every active subscriber.

    Never raises. A failure for one subscriber does not stop the others.
    Each attempt is logged to telegram_recommendation_deliveries; a
    subscriber that already received this exact recommendation is skipped.
    """
    try:
        token, proxy_url = _get_telegram_credentials(db)
        if not token:
            logger.debug("broadcast_recommendation: Telegram not configured -- skipping")
            return

        subscribers = get_active_subscribers(db)
        if not subscribers:
            return

        rec_id = _recommendation_id(verdict)
        text = format_recommendation_message(verdict)

        for sub in subscribers:
            already_sent = (
                db.query(TelegramRecommendationDelivery)
                .filter(
                    TelegramRecommendationDelivery.recommendation_id == rec_id,
                    TelegramRecommendationDelivery.chat_id == sub.chat_id,
                    TelegramRecommendationDelivery.status == "sent",
                )
                .first()
            )
            if already_sent:
                continue

            try:
                _send_message(token, sub.chat_id, text, proxy_url)
                db.add(TelegramRecommendationDelivery(
                    recommendation_id=rec_id,
                    chat_id=sub.chat_id,
                    status="sent",
                ))
                logger.info("broadcast_recommendation: sent to chat_id=%s symbol=%s", sub.chat_id, verdict.symbol)
            except Exception as exc:
                db.add(TelegramRecommendationDelivery(
                    recommendation_id=rec_id,
                    chat_id=sub.chat_id,
                    status="failed",
                    error_message=str(exc)[:500],
                ))
                logger.warning("broadcast_recommendation: failed for chat_id=%s -- %s", sub.chat_id, exc)

        db.commit()
    except Exception as exc:
        logger.error("broadcast_recommendation: unexpected error -- %s", exc)
        db.rollback()
```

- [ ] **Step 2: Compile-check**

```bash
cd mt5_readonly_service
python -m py_compile telegram_subscribers.py
```
Expected: no output.

- [ ] **Step 3: Manual verification (formatting + dedup, no real Telegram call)**

```bash
python -c "
from datetime import datetime, timezone
from database import init_db, SessionLocal, TelegramRecommendationDelivery
import telegram_subscribers as ts

init_db()

class FakeVerdict:
    symbol = 'XAUUSD'
    direction = 'BUY'
    approved = True
    signal_strength = 0.85
    entry = 2375.123
    sl = 2370.456
    tp = 2390.789
    atr = 4.5
    risk_amount = 50.0
    risk_percent = 1.5
    profit_amount = 100.0
    lot_size = 0.5
    digits = 3
    duration = '4 إلى 12 ساعة'
    timeframe = 'H1'
    confluence = {'level': 'STRONG', 'aligned_count': 3}
    timestamp = datetime.now(timezone.utc)

msg = ts.format_recommendation_message(FakeVerdict())
print(msg)
print('---')
print('rec id:', ts._recommendation_id(FakeVerdict()))
"
```
Expected: prints a fully-formatted Arabic message containing 'XAUUSD', 'شراء', '2375.123', 'STRONG', and ends with the disclaimer paragraph; then prints a `rec id:` line like `XAUUSD|BUY|2026-...`.

- [ ] **Step 4: Commit**

```bash
git add mt5_readonly_service/telegram_subscribers.py
git commit -m "feat(telegram): add recommendation formatting and broadcast"
```

---

### Task 4: Polling loop + `/start`, `/stop`, `/help`, `/subscribers` commands

**Files:**
- Modify: `mt5_readonly_service/telegram_subscribers.py`

- [ ] **Step 1: Append update-offset helpers, command handler, and polling loop**

Append to `mt5_readonly_service/telegram_subscribers.py`:

```python
# ---------------------------------------------------------------------------
# Polling loop (getUpdates) -- no public URL available, so webhook is not
# possible. Mirrors the resilience pattern of run_live_agent_council_scan:
# infinite loop, all exceptions logged and swallowed, never crashes the service.
# ---------------------------------------------------------------------------

_UPDATE_OFFSET_KEY = "telegram_update_offset"

_HELP_TEXT = (
    "الأوامر المتاحة:\n"
    "/start — للاشتراك في التوصيات\n"
    "/stop — لإيقاف الاشتراك\n"
    "/help — لعرض هذه التعليمات"
)

_START_TEXT = (
    "مرحبًا بك في نظام التوصيات والتحليل.\n"
    "تم تسجيلك بنجاح، وستصلك التوصيات المعتمدة من النظام عند صدورها.\n"
    "\n"
    "تنبيه مهم:\n"
    "هذه التوصيات للتحليل والمتابعة وليست أمرًا مباشرًا بالشراء أو البيع.\n"
    "قرار التداول وإدارة المخاطر مسؤوليتك الشخصية."
)

_STOP_TEXT = "تم إيقاف استقبال التوصيات. يمكنك الاشتراك مرة أخرى بإرسال /start"


def _get_update_offset(db: Session) -> int:
    row = db.query(SystemConfig).filter(SystemConfig.key == _UPDATE_OFFSET_KEY).first()
    if row and row.value:
        try:
            return int(row.value)
        except ValueError:
            return 0
    return 0


def _set_update_offset(db: Session, offset: int) -> None:
    row = db.query(SystemConfig).filter(SystemConfig.key == _UPDATE_OFFSET_KEY).first()
    if row is None:
        row = SystemConfig(key=_UPDATE_OFFSET_KEY, value=str(offset))
        db.add(row)
    else:
        row.value = str(offset)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()


def _strip_command(text: str) -> str:
    """Normalize '/start@MyBot arg' -> '/start'."""
    cmd = text.strip().split()[0]
    return cmd.split("@")[0].lower()


def _handle_update(db: Session, update: dict, token: str, proxy_url: str | None) -> None:
    message = update.get("message") or update.get("edited_message")
    if not message:
        return

    text = message.get("text")
    if not text or not text.startswith("/"):
        return

    chat = message.get("chat") or {}
    from_user = message.get("from") or {}
    chat_id = str(chat.get("id"))
    user_id = str(from_user.get("id"))
    command = _strip_command(text)

    if command == "/start":
        upsert_subscriber(
            db,
            telegram_user_id=user_id,
            chat_id=chat_id,
            username=from_user.get("username"),
            first_name=from_user.get("first_name"),
            last_name=from_user.get("last_name"),
        )
        _send_message(token, chat_id, _START_TEXT, proxy_url)
    elif command == "/stop":
        deactivate_subscriber(db, chat_id)
        _send_message(token, chat_id, _STOP_TEXT, proxy_url)
    elif command == "/help":
        _send_message(token, chat_id, _HELP_TEXT, proxy_url)
    elif command == "/subscribers":
        if not _is_admin(user_id):
            return
        active = len(get_active_subscribers(db))
        total = db.query(TelegramSubscriber).count()
        _send_message(token, chat_id, f"المشتركون النشطون: {active} / الإجمالي: {total}", proxy_url)


def _poll_once(db: Session, token: str, proxy_url: str | None) -> None:
    offset = _get_update_offset(db)
    proxies = {"https": proxy_url, "http": proxy_url} if proxy_url else None
    resp = requests.get(
        f"https://api.telegram.org/bot{token}/getUpdates",
        params={"offset": offset, "timeout": 25},
        timeout=30,
        proxies=proxies,
    )
    resp.raise_for_status()
    body = resp.json()
    if not body.get("ok"):
        logger.warning("telegram_bot: getUpdates not ok -- %s", body)
        return

    updates = body.get("result", [])
    for update in updates:
        try:
            _handle_update(db, update, token, proxy_url)
        except Exception as exc:
            logger.warning("telegram_bot: failed to handle update %s -- %s", update.get("update_id"), exc)
        finally:
            offset = max(offset, update.get("update_id", 0) + 1)

    if updates:
        _set_update_offset(db, offset)


async def run_telegram_bot_polling() -> None:
    """Background task: long-poll Telegram getUpdates and dispatch /start,
    /stop, /help, /subscribers. Runs forever; never raises out of the loop."""
    import asyncio

    while True:
        db = SessionLocal()
        try:
            token, proxy_url = _get_telegram_credentials(db)
            if not token:
                logger.debug("telegram_bot: TELEGRAM_BOT_TOKEN not configured -- sleeping")
                await asyncio.sleep(60)
                continue

            await asyncio.to_thread(_poll_once, db, token, proxy_url)
        except Exception as exc:
            logger.warning("telegram_bot: poll cycle failed -- %s", exc)
            await asyncio.sleep(5)
        finally:
            db.close()
```

- [ ] **Step 2: Compile-check**

```bash
cd mt5_readonly_service
python -m py_compile telegram_subscribers.py
```
Expected: no output.

- [ ] **Step 3: Manual verification of `_handle_update` (no real Telegram call — `_send_message` is monkeypatched)**

```bash
python -c "
from database import init_db, SessionLocal
import telegram_subscribers as ts

init_db()
db = SessionLocal()

sent = []
ts._send_message = lambda token, chat_id, text, proxy_url=None: sent.append((chat_id, text))

fake_update_start = {
    'update_id': 1,
    'message': {
        'text': '/start',
        'chat': {'id': 888222},
        'from': {'id': 888222, 'username': 'tester3', 'first_name': 'Ahmed'},
    },
}
ts._handle_update(db, fake_update_start, token='FAKE', proxy_url=None)
print('after /start, active subscribers:', len(ts.get_active_subscribers(db)))
print('reply:', sent[-1][1][:30], '...')

fake_update_stop = {
    'update_id': 2,
    'message': {
        'text': '/stop',
        'chat': {'id': 888222},
        'from': {'id': 888222, 'username': 'tester3', 'first_name': 'Ahmed'},
    },
}
ts._handle_update(db, fake_update_stop, token='FAKE', proxy_url=None)
print('after /stop, active subscribers:', len(ts.get_active_subscribers(db)))
print('reply:', sent[-1][1])

# cleanup
db.query(ts.TelegramSubscriber).filter(ts.TelegramSubscriber.chat_id == '888222').delete()
db.commit()
db.close()
"
```
Expected:
```
after /start, active subscribers: 1
reply: مرحبًا بك في نظام التوصيات والتحليل ...
after /stop, active subscribers: 0
reply: تم إيقاف استقبال التوصيات. يمكنك الاشتراك مرة أخرى بإرسال /start
```

- [ ] **Step 4: Commit**

```bash
git add mt5_readonly_service/telegram_subscribers.py
git commit -m "feat(telegram): add polling loop and /start /stop /help /subscribers commands"
```

---

### Task 5: Hook broadcast into `agents.py` analyze_market

**Files:**
- Modify: `mt5_readonly_service/agents.py:1178-1179`

- [ ] **Step 1: Add the broadcast call inside the existing `if send_alert:` block**

In `mt5_readonly_service/agents.py`, find (around line 1178):

```python
            if send_alert:
                self._send_telegram_alert(winner)
```

Replace with:

```python
            if send_alert:
                self._send_telegram_alert(winner)
                if db is not None:
                    from telegram_subscribers import broadcast_recommendation
                    broadcast_recommendation(winner, db)
```

The local import (inside the `if`) avoids any module-load-order dependency between `agents.py` and the new `telegram_subscribers.py`, matching the existing local-import style used by `_refresh_cfg_from_db` (line 95: `from database import SystemConfig`).

- [ ] **Step 2: Compile-check**

```bash
cd mt5_readonly_service
python -m py_compile agents.py telegram_subscribers.py main.py
```
Expected: no output.

- [ ] **Step 3: Manual verification — approved verdict triggers broadcast**

This simulates one `analyze_market` call's alert block in isolation, confirming the import and call wiring works end-to-end against the real DB (with one fake active subscriber and a stubbed `_send_message` so no real Telegram call is made).

```bash
python -c "
from datetime import datetime, timezone
from database import init_db, SessionLocal, TelegramRecommendationDelivery
import telegram_subscribers as ts

init_db()
db = SessionLocal()

# add a temporary active subscriber
sub = ts.upsert_subscriber(db, telegram_user_id='777333', chat_id='777333', username='t4', first_name='T', last_name=None)

sent = []
ts._send_message = lambda token, chat_id, text, proxy_url=None: sent.append((chat_id, text))
ts._get_telegram_credentials = lambda db: ('FAKE_TOKEN', None)

class FakeVerdict:
    symbol = 'XAUUSD'
    direction = 'BUY'
    approved = True
    signal_strength = 0.75
    entry = 2375.0
    sl = 2370.0
    tp = 2390.0
    atr = 4.5
    risk_amount = 50.0
    risk_percent = 1.5
    profit_amount = 100.0
    lot_size = 0.5
    digits = 2
    duration = '4 إلى 12 ساعة'
    timeframe = 'H1'
    confluence = {'level': 'STRONG', 'aligned_count': 3}
    timestamp = datetime.now(timezone.utc)

ts.broadcast_recommendation(FakeVerdict(), db)
print('messages sent:', len(sent))
print('delivery rows:', db.query(TelegramRecommendationDelivery).filter(TelegramRecommendationDelivery.chat_id == '777333').count())

# second call must be a no-op (dedup)
ts.broadcast_recommendation(FakeVerdict(), db)
print('messages sent after retry (should still be 1):', len(sent))

# cleanup
db.query(ts.TelegramSubscriber).filter(ts.TelegramSubscriber.chat_id == '777333').delete()
db.query(TelegramRecommendationDelivery).filter(TelegramRecommendationDelivery.chat_id == '777333').delete()
db.commit()
db.close()
"
```
Expected:
```
messages sent: 1
delivery rows: 1
messages sent after retry (should still be 1): 1
```

- [ ] **Step 4: Commit**

```bash
git add mt5_readonly_service/agents.py
git commit -m "feat(telegram): broadcast approved recommendations to subscribers"
```

---

### Task 6: Register the polling task in `main.py`

**Files:**
- Modify: `mt5_readonly_service/main.py:770-778`

- [ ] **Step 1: Add one line to `_startup()`**

In `mt5_readonly_service/main.py`, find:

```python
@app.on_event("startup")
async def _startup() -> None:
    """
    Initialise the local SQLite database and start the background agent scan loop.
    Tables are created if they do not exist; existing data is never dropped.
    """
    init_db()
    asyncio.create_task(run_live_agent_council_scan())
    asyncio.create_task(run_watchlist_multi_timeframe_scan())
```

Replace with:

```python
@app.on_event("startup")
async def _startup() -> None:
    """
    Initialise the local SQLite database and start the background agent scan loop.
    Tables are created if they do not exist; existing data is never dropped.
    """
    init_db()
    asyncio.create_task(run_live_agent_council_scan())
    asyncio.create_task(run_watchlist_multi_timeframe_scan())
    asyncio.create_task(run_telegram_bot_polling())
```

- [ ] **Step 2: Add the import**

In `mt5_readonly_service/main.py`, find the existing import (around line 30):

```python
from agents import CouncilEngine, CouncilVerdict, calculate_position_size, candles_to_dataframe, get_market_session
```

Add a new import line directly below it:

```python
from telegram_subscribers import run_telegram_bot_polling
```

- [ ] **Step 3: Compile-check**

```bash
cd mt5_readonly_service
python -m py_compile main.py agents.py telegram_subscribers.py database.py
```
Expected: no output.

- [ ] **Step 4: Smoke-test the service starts and the task is scheduled**

```bash
cd mt5_readonly_service
python -c "
import main
print('app routes ok, run_telegram_bot_polling imported:', main.run_telegram_bot_polling.__name__)
"
```
Expected:
```
app routes ok, run_telegram_bot_polling imported: run_telegram_bot_polling
```

(Full live startup with `uvicorn` is covered by Task 7's manual test, since it requires `TELEGRAM_BOT_TOKEN` to be configured to be meaningful.)

- [ ] **Step 5: Commit**

```bash
git add mt5_readonly_service/main.py
git commit -m "feat(telegram): start subscriber bot polling loop on startup"
```

---

### Task 7: Document `TELEGRAM_ADMIN_IDS` and run full project verification

**Files:**
- Modify: `PROJECT_CONTEXT.md` (one short addition under an appropriate existing section — env var documentation)

- [ ] **Step 1: Document the new env var**

In `PROJECT_CONTEXT.md`, the project does not have a dedicated "environment variables" table for the Python service beyond what's described inline. Add a short note near the MT5 Bridge row in the Stack table (section 3) or as a new line in section 5 ("Python Service") — keep it to 1-2 lines, e.g.:

```markdown
> ملاحظة: `TELEGRAM_ADMIN_IDS` (متغير بيئة، قائمة معرّفات تيليجرام مفصولة
> بفواصل) يحدد من يمكنه استخدام أمر `/subscribers` الإداري للقراءة فقط في
> بوت الاشتراكات (`mt5_readonly_service/telegram_subscribers.py`).
```

Place it directly after the "Python Service" table in section 5.

- [ ] **Step 2: Run full Python compile check**

```bash
cd mt5_readonly_service
python -m py_compile main.py agents.py database.py telegram_subscribers.py
```
Expected: no output (all OK).

- [ ] **Step 3: Run TypeScript and build checks (no frontend files changed, but required by AGENT_RULES Rule 6 before reporting done)**

```bash
cd e:/PROJACT-AHMED/MT5-gold-clone
pnpm exec tsc --noEmit
pnpm run build
```
Expected: `tsc` exits 0 with no output; `pnpm run build` completes successfully (same as Stage C).

- [ ] **Step 4: Manual end-to-end test (requires `TELEGRAM_BOT_TOKEN` already configured via `/api/config`, per existing setup)**

1. Start the service:
   ```bash
   cd mt5_readonly_service
   uvicorn main:app --host 127.0.0.1 --port 8010 --reload
   ```
2. From a real Telegram account, open a chat with the configured bot and send `/start`.
   - Expect to receive the welcome message (Task 4's `_START_TEXT`).
   - Verify a row was created:
     ```bash
     python -c "
     from database import SessionLocal, TelegramSubscriber
     db = SessionLocal()
     for row in db.query(TelegramSubscriber).all():
         print(row.to_dict())
     db.close()
     "
     ```
     Expect `isActive: True` for your chat.
3. Send `/help` — expect the commands list (Task 4's `_HELP_TEXT`).
4. Trigger a real or near-real approved signal through `run_watchlist_multi_timeframe_scan` (add a symbol to the watchlist via the existing `/api/lab/watchlist` endpoint and wait for its next scheduled scan, or temporarily lower `_AGENT_SCAN_INTERVAL`/run the scan manually in a Python shell calling `_sync_scan_cycle(engine, [symbol], 'H1', 250, send_alerts=True)` with a fresh `SessionLocal()`).
   - If `verdict.approved` is True, expect:
     - The legacy single-chat alert (`telegram_chat_id`) still receives its existing-format message (unchanged).
     - Your subscribed chat receives the new-format message from Task 3 (`format_recommendation_message`).
     - A `telegram_recommendation_deliveries` row with `status='sent'` for your `chat_id`:
       ```bash
       python -c "
       from database import SessionLocal, TelegramRecommendationDelivery
       db = SessionLocal()
       for row in db.query(TelegramRecommendationDelivery).order_by(TelegramRecommendationDelivery.id.desc()).limit(5).all():
           print(row.to_dict())
       db.close()
       "
       ```
5. Send `/stop` — expect the stop confirmation message.
   - Verify `isActive: False` for your chat (re-run the query from step 2).
   - Trigger another approved signal (or wait for the next one) and confirm:
     - Your chat does **not** receive a new recommendation.
     - The legacy single-chat alert still works as before.
6. (Optional) If you set `TELEGRAM_ADMIN_IDS` to your Telegram user id and restart the service, send `/subscribers` — expect a reply with active/total counts. From a non-admin account, `/subscribers` should produce no reply.

- [ ] **Step 5: Final report (per AGENT_RULES Rule 7)**

Prepare the Arabic stage report covering:
- الملفات المعدَّلة/المُنشأة (database.py, telegram_subscribers.py [new], agents.py, main.py, PROJECT_CONTEXT.md)
- نتائج `python -m py_compile`
- نتائج `pnpm exec tsc --noEmit` و `pnpm run build`
- نتائج الاختبار اليدوي (الخطوة 4)
- `git status --short`
- توصية رسائل commit (واحدة لكل Task أعلاه — تم بالفعل أثناء التنفيذ)
- التذكير: لا push بدون موافقة أحمد.

- [ ] **Step 6: Commit the documentation change**

```bash
git add PROJECT_CONTEXT.md
git commit -m "docs: document TELEGRAM_ADMIN_IDS env var for subscriber bot"
```

---

## Spec coverage check

- Subscriber storage with all required fields + upsert-not-duplicate semantics → Task 1, Task 2.
- `/start` welcome message (exact Arabic text) → Task 4 (`_START_TEXT`).
- `/stop` sets `is_active=false` + confirmation message → Task 4 (`_STOP_TEXT`, `deactivate_subscriber`).
- `/help` → Task 4 (`_HELP_TEXT`).
- Central `broadcast_recommendation` function, per-subscriber failure isolation, error logging → Task 3.
- Linked to existing recommendation system, only `approved` signals from the watchlist scan (sole `send_alert=True` source per Stage C) → Task 5.
- Arabic recommendation message format → Task 3 (`format_recommendation_message`).
- Admin protection via `TELEGRAM_ADMIN_IDS` → Task 2 (`_is_admin`), Task 4 (`/subscribers`), Task 7 (env doc).
- SQLite (no Prisma/Convex) tables + CRUD → Task 1, Task 2.
- Polling-based command handling → Task 4, Task 6.
- Dedup via `TelegramRecommendationDelivery` → Task 3, verified in Task 5.
- No hardcoded tokens; `.env`/`system_config` only → Task 2 (`_get_telegram_credentials`), Task 7 (env doc).
- Final tsc/build/py_compile checks → Task 7.
