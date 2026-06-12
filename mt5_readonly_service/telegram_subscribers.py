"""
telegram_subscribers.py -- Opt-in Telegram subscriber system.

Additive to the existing single-chat Telegram alert (agents.py:
_send_telegram_alert, configured via system_config.telegram_chat_id).
Anyone can send /start to the bot to subscribe; /stop unsubscribes;
/help lists commands. Approved recommendations are relayed to all active
subscribers using the SAME unified institutional message text built by
agents.CouncilEngine._send_telegram_alert -- there is no separate template
here, to avoid sending two different messages for the same opportunity.

Read-only contract: this module never executes trades. It only sends
Telegram messages and reads/writes subscriber + delivery-log rows.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

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


def block_subscriber(db: Session, chat_id: str) -> None:
    """Block a subscriber: stop broadcasts and reject future /start until unblocked."""
    row = db.query(TelegramSubscriber).filter(TelegramSubscriber.chat_id == chat_id).first()
    if row is None:
        return
    row.is_blocked = 1
    row.is_active = 0
    row.updated_at = datetime.now(timezone.utc)
    db.commit()


def unblock_subscriber(db: Session, chat_id: str) -> None:
    """Allow a previously blocked subscriber to /start again. Does not reactivate by itself."""
    row = db.query(TelegramSubscriber).filter(TelegramSubscriber.chat_id == chat_id).first()
    if row is None:
        return
    row.is_blocked = 0
    row.updated_at = datetime.now(timezone.utc)
    db.commit()


def get_active_subscribers(db: Session) -> list[TelegramSubscriber]:
    return db.query(TelegramSubscriber).filter(TelegramSubscriber.is_active == 1).all()


# ---------------------------------------------------------------------------
# Recommendation message formatting + broadcast
# ---------------------------------------------------------------------------

def _recommendation_id(verdict) -> str:
    """Deterministic id for one verdict — used for delivery dedup."""
    return f"{verdict.symbol}|{verdict.direction}|{verdict.timestamp.isoformat()}"


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


def broadcast_recommendation(verdict, text: str, db: Session) -> None:
    """Relay the unified institutional message (built by
    agents.CouncilEngine._send_telegram_alert) to every active subscriber.

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
    "/status — لعرض حالة اشتراكك\n"
    "/help — لعرض هذه التعليمات\n\n"
    "⏰ أوقات التداول (بتوقيت بغداد):\n"
    "• الجلسة الآسيوية (طوكيو): 03:00 ص - 12:00 م\n"
    "• جلسة لندن: 11:00 ص - 08:00 م\n"
    "• جلسة نيويورك: 04:00 م - 01:00 ص\n"
    "• تداخل لندن ونيويورك (أعلى سيولة): 04:00 م - 08:00 م\n\n"
    "سوق الفوركس والمعادن يفتح من الإثنين ويغلق الجمعة (بتوقيت المنصة).\n"
    "(يفتح الأحد 12:00 منتصف الليل ويغلق الجمعة 11:59 ليلاً بتوقيت بغداد).\n"
    "الكريبتو (Crypto): متاح 24/7 طوال أيام الأسبوع."
)

_START_TEXT = (
    "مرحبًا بك في نظام التوصيات والتحليل.\n"
    "تم تسجيلك بنجاح، وستصلك التوصيات المعتمدة من النظام عند صدورها.\n"
    "\n"
    "⏰ أوقات عمل النظام (بتوقيت بغداد):\n"
    "• الجلسة الآسيوية (طوكيو): 03:00 ص - 12:00 م\n"
    "• جلسة لندن: 11:00 ص - 08:00 م\n"
    "• جلسة نيويورك: 04:00 م - 01:00 ص\n"
    "• تداخل لندن ونيويورك (أعلى سيولة): 04:00 م - 08:00 م\n\n"
    "سوق الفوركس والمعادن يفتح من الإثنين ويغلق الجمعة (بتوقيت المنصة).\n"
    "(يفتح الأحد 12:00 منتصف الليل ويغلق الجمعة 11:59 ليلاً بتوقيت بغداد).\n"
    "أما الكريبتو فيستمر على مدار الساعة طيلة أيام الأسبوع.\n"
    "\n"
    "تنبيه مهم:\n"
    "هذه التوصيات للتحليل والمتابعة وليست أمرًا مباشرًا بالشراء أو البيع.\n"
    "قرار التداول وإدارة المخاطر مسؤوليتك الشخصية."
)

_STOP_TEXT = "تم إيقاف استقبال التوصيات. يمكنك الاشتراك مرة أخرى بإرسال /start"

_BLOCKED_TEXT = (
    "تم تقييد وصولك إلى هذا البوت من قبل الإدارة.\n"
    "لإعادة التفعيل يرجى التواصل مع المسؤول."
)


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
        existing = db.query(TelegramSubscriber).filter(TelegramSubscriber.chat_id == chat_id).first()
        if existing is not None and existing.is_blocked:
            _send_message(token, chat_id, _BLOCKED_TEXT, proxy_url)
            return
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
    elif command == "/status":
        row = db.query(TelegramSubscriber).filter(TelegramSubscriber.chat_id == chat_id).first()
        if row is None or not row.is_active:
            _send_message(token, chat_id, "أنت غير مشترك حاليًا. أرسل /start للاشتراك في التوصيات.", proxy_url)
        else:
            _send_message(token, chat_id, "أنت مشترك حاليًا وستصلك التوصيات المعتمدة عند صدورها.", proxy_url)
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
    /stop, /help, /status, /subscribers. Runs forever; never raises out of the loop."""

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
