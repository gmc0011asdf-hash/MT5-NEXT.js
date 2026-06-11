"""
Local MT5 Read-only Connector — FastAPI service.

================================================================================
READ-ONLY CONTRACT — يُمنع أي تنفيذ أو أوامر من هذه الخدمة:
- لا توجد نقاط نهاية للبيع أو الشراء أو الإغلاق أو التعديل أو الأوامر المعلقة.
- يُسمح فقط بقراءة الحساب والتيكات والمراكز المفتوحة والترميزات وسجل الصفقات عبر واجهات MetaTrader5
  الموثقة للقراءة (initialize / account_info / symbol_info_tick / positions_get / symbols_get / history_deals_get).
- لا يُستورد أو يُستدعى صراحةً أي من دوال التداول المحظورة أدناه.
================================================================================
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from agents import CouncilEngine, CouncilVerdict, calculate_position_size, candles_to_dataframe, get_market_session
from database import DecisionJournal, GoldProAnalysis, MT5OpenPosition, MT5TradeHistory, SessionLocal, StrategySignal, SystemConfig, TelegramSubscriber, TripleFirewallSignal, get_db, init_db
from telegram_subscribers import block_subscriber, run_telegram_bot_polling, unblock_subscriber
from mt5_trade_sync import run_mt5_trade_sync, sync_mt5_trades_once
from okx_bridge import (
    DEFAULT_OKX_SYMBOLS,
    OKX_BAR_DISPLAY,
    fetch_okx_candles,
    fetch_okx_tickers,
    okx_candles_to_dataframe,
)


class Utf8JsonResponse(JSONResponse):
    """
    JSONResponse subclass that serialises with ensure_ascii=False and sets
    Content-Type: application/json; charset=utf-8.

    FastAPI's default JSONResponse uses ensure_ascii=True, which escapes every
    non-ASCII character to \\uXXXX sequences.  Those sequences are valid JSON but
    PowerShell 5.1's Invoke-RestMethod re-encodes them through the system
    codepage instead of treating them as literal Unicode, producing mojibake for
    Arabic text.  Emitting real UTF-8 bytes with an explicit charset header fixes
    both PowerShell and all standards-compliant clients.
    """

    media_type = "application/json; charset=utf-8"

    def render(self, content: Any) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
        ).encode("utf-8")

# -----------------------------------------------------------------------------
# Safety switches — never flip READ_ONLY_MODE without a separate security review.
# -----------------------------------------------------------------------------
READ_ONLY_MODE: bool = True

# MT5_DEMO_EXECUTION_ENABLED — authorises the /demo/order-send endpoint (A26.2).
# Defaults to False.  Set MT5_DEMO_EXECUTION_ENABLED=1 in the process environment
# to enable Demo execution.  This flag does NOT affect READ_ONLY_MODE.
MT5_DEMO_EXECUTION_ENABLED: bool = os.environ.get(
    "MT5_DEMO_EXECUTION_ENABLED", ""
).lower() in ("1", "true", "yes")

# Names forbidden in ALL read-only endpoints above this marker.
# The ONLY authorised use of order_send in this file is inside
# /demo/order-send (A26.2, Demo accounts only, gated by MT5_DEMO_EXECUTION_ENABLED).
FORBIDDEN_MT5_FUNCTION_NAMES: tuple[str, ...] = (
    "order_send",   # forbidden in read-only paths; ONLY /demo/order-send may use it
    "order_close",
    "order_modify",
    "order_check",
)

# Service identity — increment build_version on every release.
_BUILD_VERSION: str = "0.2.0"
_SERVICE_START_TIME: float = time.monotonic()

logger = logging.getLogger(__name__)

# Active WebSocket connections -- used to broadcast agent council signals.
_ws_clients: set[WebSocket] = set()

# Tracks the wall-clock time of the last call that returned real MT5 data.
_last_successful_mt5_call_at: datetime | None = None

# How many seconds a tick timestamp can be old before we consider the market closed.
# Forex closes ~Friday 22:00 UTC; a tick older than 4 hours during session is suspicious.
_STALE_TICK_THRESHOLD_SECONDS: int = 4 * 3600  # 4 hours

# Import MetaTrader5 only for documented read paths.
# The underlying DLL exposes trading APIs; we deliberately never call them here.
import MetaTrader5 as mt5

_DEFAULT_SYMBOLS: tuple[str, ...] = ("EURUSD", "GBPUSD", "XAUUSD")
_DEFAULT_CANDLE_TIMEFRAMES: tuple[str, ...] = ("M15", "H1", "H4", "D1")
_MAX_CANDLE_COUNT: int = 1000

# ── Broker clock offset ────────────────────────────────────────────────────────
# MT5 copy_rates_from_pos returns candle timestamps in the broker's server
# timezone, NOT in UTC.  Subtracting this offset converts broker-local seconds
# to true UTC seconds before building time / time_iso.
#
# Default: 3  (UTC+3 — typical Iraqi / Gulf broker servers).
# Override: set environment variable MT5_BROKER_TIME_OFFSET_HOURS=<n>
#   0  → broker already reports UTC (rare)
#   2  → UTC+2 broker (e.g. some European brokers during winter)
#   3  → UTC+3 broker (default — Iraqi / Gulf / Exness EET)
_BROKER_TIME_OFFSET_HOURS: int = int(os.environ.get("MT5_BROKER_TIME_OFFSET_HOURS", "3"))
_BROKER_TIME_OFFSET_SECS: int = _BROKER_TIME_OFFSET_HOURS * 3600

_TIMEFRAME_MAP: dict[str, int] = {
    "M1": mt5.TIMEFRAME_M1,
    "M5": mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30,
    "H1": mt5.TIMEFRAME_H1,
    "H4": mt5.TIMEFRAME_H4,
    "D1": mt5.TIMEFRAME_D1,
}


class ConnectRequest(BaseModel):
    login: int
    server: str
    password: str
    terminal_path: str


# -----------------------------------------------------------------------------
# Internal helpers
# -----------------------------------------------------------------------------

def _enforce_read_only_policy() -> None:
    """Fail fast if someone disables read-only mode by mistake."""
    if READ_ONLY_MODE is not True:
        raise RuntimeError("READ_ONLY_MODE must remain True for this service.")


def _record_successful_mt5_call() -> None:
    """Update the global last-success timestamp after a real MT5 data response."""
    global _last_successful_mt5_call_at
    _last_successful_mt5_call_at = datetime.now(timezone.utc)


def _service_uptime_seconds() -> float:
    return round(time.monotonic() - _SERVICE_START_TIME, 1)


def _symbols_from_env() -> list[str]:
    raw = os.environ.get("SYMBOLS", "").strip()
    if not raw:
        return list(_DEFAULT_SYMBOLS)
    parts = [s.strip().upper() for s in raw.split(",") if s.strip()]
    return parts or list(_DEFAULT_SYMBOLS)


def _get_visible_mt5_symbols(limit: int = 200) -> list[str]:
    """
    Returns the symbol names currently visible in the connected terminal's
    Market Watch (any account type — demo or real). Caller must already
    have a successful _safe_mt5_init() for this terminal session.
    Returns [] if MT5 has no visible symbols or the call fails.
    """
    try:
        rows = mt5.symbols_get()
    except Exception:
        return []
    if not rows:
        return []
    names = [s.name for s in rows if getattr(s, "visible", False) and getattr(s, "name", None)]
    return names[:limit]


def _parse_csv_param(raw: str | None) -> list[str]:
    if raw is None:
        return []
    return [p.strip().upper() for p in raw.split(",") if p.strip()]


def _parse_symbols_param(raw: str | None) -> list[str]:
    """
    Like _parse_csv_param but preserves the original casing of symbol names.
    Broker symbol names are case-sensitive (e.g. "XAUUSDm", "EURUSD.r"),
    so uppercasing them breaks mt5.symbol_select().
    """
    if raw is None:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


def _iso_from_mt5_time(ts: int | float | None) -> str | None:
    if ts is None:
        return None
    try:
        sec = float(ts) / (1000.0 if ts > 10_000_000_000 else 1.0)
        return datetime.fromtimestamp(sec, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _deal_time_to_ms(ts: Any) -> int | None:
    """MT5 Deal time: usually seconds (int) — return epoch ms for clients."""
    if ts is None:
        return None
    try:
        if isinstance(ts, datetime):
            return int(ts.replace(tzinfo=timezone.utc).timestamp() * 1000)
        sec = float(ts)
        if sec > 10_000_000_000:  # already ms
            return int(sec)
        return int(sec * 1000)
    except (OverflowError, OSError, ValueError, TypeError):
        return None


def _safe_mt5_init() -> tuple[bool, str | None]:
    """Initialize terminal connection; no credentials stored or requested."""
    _enforce_read_only_policy()
    if not mt5.initialize():
        err = mt5.last_error()
        return False, f"تعذّر تهيئة MT5 (هل المنصة مفتوحة؟): {err}"
    return True, None


def _validate_terminal_path(terminal_path: str) -> str | None:
    """
    Return an Arabic error string if terminal_path is unusable, else None.
    Accepts either the exact terminal64.exe path or the terminal directory.
    """
    path = terminal_path.strip()
    if not path:
        return "مسار المنصة مطلوب"
    if os.path.isdir(path):
        return (
            "المسار المُدخَل هو مجلد وليس ملف تنفيذي — "
            "أدخل المسار الكامل لـ terminal64.exe"
        )
    if not os.path.isfile(path):
        return (
            f"ملف terminal64.exe غير موجود في المسار: {path} — "
            "تحقق من مسار تثبيت MetaTrader 5"
        )
    if not path.lower().endswith(".exe"):
        return "المسار يجب أن يشير إلى ملف .exe — مثال: C:\\Program Files\\MetaTrader 5\\terminal64.exe"
    return None


def _is_tick_stale(tick_time_iso: str | None) -> bool:
    """Return True when the tick timestamp is older than _STALE_TICK_THRESHOLD_SECONDS."""
    if tick_time_iso is None:
        return True
    try:
        tick_dt = datetime.fromisoformat(tick_time_iso)
        if tick_dt.tzinfo is None:
            tick_dt = tick_dt.replace(tzinfo=timezone.utc)
        age_seconds = (datetime.now(timezone.utc) - tick_dt).total_seconds()
        return age_seconds > _STALE_TICK_THRESHOLD_SECONDS
    except (ValueError, TypeError):
        return True


def _empty_connection_status() -> dict[str, Any]:
    return {
        "connected": False,
        "account_login": None,
        "server": None,
        "company": None,
        "name": None,
        "balance": None,
        "equity": None,
        "free_margin": None,
        "currency": None,
        "leverage": None,
        "read_only": True,
    }


def _account_payload() -> dict[str, Any]:
    info = mt5.account_info()
    if info is None:
        return {"connected": False, "error": "تعذّر جلب account_info من MT5"}
    return {
        "connected": True,
        "login": info.login,
        "balance": float(info.balance),
        "equity": float(info.equity),
        "margin": float(info.margin),
        "freeMargin": float(info.margin_free),
        "currency": info.currency,
        "server": info.server,
        "trade_allowed": bool(info.trade_allowed),
        "company": info.company,
    }


def _connection_status_payload() -> dict[str, Any]:
    _enforce_read_only_policy()
    now_iso = datetime.now(timezone.utc).isoformat()
    ok, err = _safe_mt5_init()
    if not ok:
        body = _empty_connection_status()
        body["error"] = err or "MT5 غير متاح"
        body["last_check_at"] = now_iso
        return body
    try:
        info = mt5.account_info()
        if info is None:
            body = _empty_connection_status()
            body["error"] = "تعذّر جلب account_info من MT5"
            body["last_check_at"] = now_iso
            return body
        _record_successful_mt5_call()
        return {
            "connected": True,
            "account_login": int(getattr(info, "login", 0) or 0),
            "server": getattr(info, "server", None),
            "company": getattr(info, "company", None),
            "name": getattr(info, "name", None),
            "balance": float(getattr(info, "balance", 0.0) or 0.0),
            "equity": float(getattr(info, "equity", 0.0) or 0.0),
            "free_margin": float(getattr(info, "margin_free", 0.0) or 0.0),
            "currency": getattr(info, "currency", None),
            "leverage": int(getattr(info, "leverage", 0) or 0),
            "read_only": True,
            "last_check_at": now_iso,
        }
    finally:
        mt5.shutdown()


def _ticks_payload(symbols: list[str]) -> dict[str, Any]:
    ticks_out: list[dict[str, Any]] = []
    any_fresh_tick = False

    for sym in symbols:
        if not mt5.symbol_select(sym, True):
            # Per-symbol error — does not fail the whole request.
            ticks_out.append(
                {
                    "symbol": sym,
                    "error": f"الرمز '{sym}' غير موجود في Market Watch أو تعذّر تفعيله",
                    "market_closed": None,
                }
            )
            continue

        tick = mt5.symbol_info_tick(sym)
        info = mt5.symbol_info(sym)
        spread_pts = int(info.spread) if info is not None else None

        if tick is None:
            ticks_out.append(
                {
                    "symbol": sym,
                    "error": f"لا يوجد تيك للرمز '{sym}' — قد يكون السوق مغلقاً",
                    "market_closed": True,
                }
            )
            continue

        bid_f = float(tick.bid)
        ask_f = float(tick.ask)
        raw_ts = getattr(tick, "time_msc", None) or getattr(tick, "time", None)
        time_iso = _iso_from_mt5_time(raw_ts)
        stale = _is_tick_stale(time_iso)

        if not stale:
            any_fresh_tick = True

        ticks_out.append(
            {
                "symbol": sym,
                "bid": bid_f,
                "ask": ask_f,
                "spread": round(ask_f - bid_f, 10),
                "spread_points": spread_pts,
                "time": time_iso,
                "market_closed": stale,
            }
        )

    return {"ticks": ticks_out, "market_closed": not any_fresh_tick}


def _positions_payload() -> dict[str, Any]:
    """Read-only open positions via positions_get only."""
    rows = mt5.positions_get()
    if rows is None:
        err = mt5.last_error()
        return {"positions": [], "error": f"تعذّر جلب المراكز المفتوحة: {err}"}
    out: list[dict[str, Any]] = []
    for p in rows:
        out.append(
            {
                "ticket": int(p.ticket),
                "symbol": p.symbol,
                "type": str(p.type),
                "volume": float(p.volume),
                "price_open": float(p.price_open),
                "price_current": float(p.price_current),
                "sl": float(p.sl),
                "tp": float(p.tp),
                "profit": float(p.profit),
                "comment": p.comment or "",
            }
        )
    return {"positions": out, "count": len(out)}


# -----------------------------------------------------------------------------
# Agent Council -- background scan helpers
# -----------------------------------------------------------------------------

_AGENT_SCAN_INTERVAL: int = int(os.environ.get("AGENT_SCAN_INTERVAL_SECONDS", "300"))
_AGENT_SCAN_TIMEFRAME: str = os.environ.get("AGENT_SCAN_TIMEFRAME", "H1")
_AGENT_SCAN_CANDLE_COUNT: int = 250  # EMA(200) requires at least 210

# OKX public market data scan settings (no auth required).
_OKX_SCAN_SYMBOLS: list[str] = DEFAULT_OKX_SYMBOLS
_OKX_SCAN_BAR:     str       = os.environ.get("OKX_SCAN_BAR", "1H")


def _fetch_candles_for_agent(symbol: str, timeframe: str, count: int) -> list[dict]:
    """
    Fetch OHLCV candles directly from MT5 for agent council analysis.
    Must be called after a successful _safe_mt5_init().
    Returns an empty list on any per-symbol error -- never raises.
    """
    try:
        tf_const = _TIMEFRAME_MAP.get(timeframe)
        if tf_const is None:
            return []
        if not mt5.symbol_select(symbol, True):
            return []
        rates = mt5.copy_rates_from_pos(symbol, tf_const, 0, count)
        if rates is None:
            return []
        result: list[dict] = []
        for rate in rates:
            broker_ts = int(rate["time"])
            utc_ts    = broker_ts - _BROKER_TIME_OFFSET_SECS
            result.append({
                "symbol":      symbol,
                "timeframe":   timeframe,
                "time":        utc_ts * 1000,
                "open":        float(rate["open"]),
                "high":        float(rate["high"]),
                "low":         float(rate["low"]),
                "close":       float(rate["close"]),
                "tick_volume": int(rate["tick_volume"]),
            })
        return result
    except Exception as exc:
        logger.warning("_fetch_candles_for_agent: %s/%s -- %s", symbol, timeframe, exc)
        return []


async def _broadcast_signal(payload: dict) -> None:
    """
    Broadcast a JSON payload to all connected WebSocket clients.
    Dead connections are silently removed from _ws_clients.
    """
    dead: set[WebSocket] = set()
    for ws in list(_ws_clients):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.add(ws)
    _ws_clients.difference_update(dead)


def _sync_scan_cycle(
    engine: CouncilEngine,
    symbols: list[str],
    timeframe: str,
    candle_count: int,
    send_alerts: bool = True,
) -> list[CouncilVerdict]:
    """
    Synchronous scan cycle: MT5 candle fetch + agent analysis + SQLite save.
    Returns the list of approved CouncilVerdict objects for broadcast.
    Runs in a thread pool (via asyncio.to_thread) so MT5 blocking calls
    do not stall the asyncio event loop.
    """
    approved: list[CouncilVerdict] = []

    ok, err = _safe_mt5_init()
    if not ok:
        logger.warning("agent_scan: MT5 unavailable -- %s", err)
        return approved

    try:
        # رصيد الحساب الحي يُستخدم لحساب اللوت/المخاطرة/الربح المتوقع
        account_balance: float | None = None
        try:
            account_info = _account_payload()
            if account_info.get("connected"):
                account_balance = account_info.get("balance")
        except Exception as acc_exc:
            logger.warning("agent_scan: failed to read account balance -- %s", acc_exc)

        scan_symbols = symbols
        for symbol in scan_symbols:
            try:
                raw = _fetch_candles_for_agent(symbol, timeframe, candle_count)
                if not raw:
                    logger.debug("agent_scan: no candles for %s", symbol)
                    continue

                df = candles_to_dataframe(raw)
                if df.empty:
                    continue

                # خصائص الرمز من MT5 لحساب لوت قياسي صحيح (يأخذ حجم العقد بعين الاعتبار)
                symbol_info: dict | None = None
                try:
                    info = mt5.symbol_info(symbol)
                    if info is not None:
                        symbol_info = {
                            "trade_tick_value": float(info.trade_tick_value),
                            "trade_tick_size": float(info.trade_tick_size),
                            "point":           float(info.point),
                            "volume_min":      float(info.volume_min),
                            "volume_max":      float(info.volume_max),
                            "volume_step":     float(info.volume_step),
                            "digits":          int(info.digits),
                        }
                except Exception as info_exc:
                    logger.warning("agent_scan: failed to read symbol_info for %s -- %s", symbol, info_exc)

                db = SessionLocal()
                try:
                    verdict = engine.analyze_market(symbol, df, db, account_balance, symbol_info, send_alert=send_alerts)
                    db.commit()
                except Exception as db_exc:
                    db.rollback()
                    logger.error("agent_scan: DB error for %s -- %s", symbol, db_exc)
                    continue
                finally:
                    db.close()

                if verdict.direction is not None or not verdict.approved:
                    approved.append(verdict)

            except Exception as sym_exc:
                logger.warning("agent_scan: error on %s -- %s", symbol, sym_exc)

    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass

    return approved


def _sync_scan_okx_cycle(
    engine:          CouncilEngine,
    symbols:         list[str],
    bar:             str,
    limit:           int,
    account_balance: float | None = None,
    send_alerts:     bool = True,
) -> list[CouncilVerdict]:
    """
    OKX scan cycle: fetch public candles -> agent council analysis -> SQLite save.

    Runs in a thread pool (via asyncio.to_thread) -- no event loop needed.
    No MT5 connection required; uses OKX public REST API only.
    No trading execution -- informational analysis and storage only.

    account_balance : رأس مال OKX المُدخل يدوياً من المستخدم (system_config:
    okx_account_balance_usd) — يُستخدم لحساب اللوت/المخاطرة/الربح المتوقع
    بدلاً من القيمة الافتراضية $10,000.
    """
    approved: list[CouncilVerdict] = []

    for inst_id in symbols:
        try:
            raw = fetch_okx_candles(inst_id, bar, limit)
            if not raw:
                logger.debug("okx_scan: no candles for %s", inst_id)
                continue

            df = okx_candles_to_dataframe(raw)
            if df.empty:
                continue

            db = SessionLocal()
            try:
                verdict = engine.analyze_market(inst_id, df, db, account_balance, send_alert=send_alerts)
                db.commit()
            except Exception as db_exc:
                db.rollback()
                logger.error("okx_scan: DB error for %s -- %s", inst_id, db_exc)
                continue
            finally:
                db.close()

            if verdict.direction is not None or not verdict.approved:
                approved.append(verdict)

        except Exception as exc:
            logger.warning("okx_scan: error on %s -- %s", inst_id, exc)

    return approved


async def run_live_agent_council_scan() -> None:
    """
    Background asyncio loop: runs the agent council on MT5 and OKX symbols.

    Cycle (every AGENT_SCAN_INTERVAL_SECONDS, default 300 = 5 minutes):
        1. Run MT5 scan + OKX scan concurrently in separate thread-pool workers.
        2. Broadcast all approved signals to connected WebSocket clients.

    READ_ONLY_MODE is preserved -- analysis and storage only, no execution.
    Errors are caught per-cycle; the loop never crashes the service.
    """
    engine      = CouncilEngine()
    mt5_symbols = _symbols_from_env()
    okx_symbols = _OKX_SCAN_SYMBOLS

    # Mapping timeframe strings to seconds
    tf_mapping = {"M1": 60, "M5": 300, "M15": 900, "M30": 1800, "H1": 3600, "H4": 14400, "D1": 86400}
    tf_sec = tf_mapping.get(_AGENT_SCAN_TIMEFRAME.upper(), _AGENT_SCAN_INTERVAL)

    logger.info(
        "agent_scan: loop started -- synced to %s (%ds) mt5=%s okx=%s",
        _AGENT_SCAN_TIMEFRAME, tf_sec, mt5_symbols, okx_symbols,
    )

    import time
    while True:
        now = time.time()
        # Sleep until the exact next boundary of the timeframe + 2 seconds to ensure exchange candle is fully closed
        sleep_sec = tf_sec - (now % tf_sec) + 2
        
        # If the sleep is unusually large (e.g. D1 is 24 hours), we could cap it or just sleep.
        # It's better to just sleep the correct exact time.
        logger.debug(f"agent_scan: sleeping for {sleep_sec:.1f}s until next candle close")
        await asyncio.sleep(sleep_sec)

        mt5_symbols_to_scan = mt5_symbols
        init_ok, _init_err = _safe_mt5_init()
        if init_ok:
            try:
                mt5_symbols_to_scan = _get_visible_mt5_symbols() or mt5_symbols
            finally:
                mt5.shutdown()

        # رأس مال OKX المُدخل يدوياً من الإعدادات (افتراضي $10,000)
        okx_balance_db = SessionLocal()
        try:
            row = okx_balance_db.query(SystemConfig).filter(
                SystemConfig.key == "okx_account_balance_usd"
            ).first()
            okx_account_balance = float(row.value) if row and row.value else float(_CONFIG_DEFAULTS["okx_account_balance_usd"])
        except Exception:
            okx_account_balance = float(_CONFIG_DEFAULTS["okx_account_balance_usd"])
        finally:
            okx_balance_db.close()

        # Run MT5 and OKX scans concurrently in separate thread-pool workers.
        # send_alerts=False: this broad scan only feeds the ranked-candidates
        # screener (triple_firewall_signals); Telegram alerts are sent only
        # by run_watchlist_multi_timeframe_scan for user-selected symbols.
        results = await asyncio.gather(
            asyncio.to_thread(
                _sync_scan_cycle,
                engine,
                mt5_symbols_to_scan,
                _AGENT_SCAN_TIMEFRAME,
                _AGENT_SCAN_CANDLE_COUNT,
                False,
            ),
            asyncio.to_thread(
                _sync_scan_okx_cycle,
                engine,
                okx_symbols,
                _OKX_SCAN_BAR,
                _AGENT_SCAN_CANDLE_COUNT,
                okx_account_balance,
                False,
            ),
            return_exceptions=True,
        )

        # Collect approved verdicts from both scans; log any exceptions.
        approved: list[CouncilVerdict] = []
        scan_names = ("mt5", "okx")
        for name, result in zip(scan_names, results):
            if isinstance(result, list):
                approved.extend(result)
            elif isinstance(result, Exception):
                logger.error("agent_scan: %s cycle failed -- %s", name, result)

        # Broadcast each approved signal; tag with data_source for the UI.
        for verdict in approved:
            data_source = "okx" if "-" in verdict.symbol else "mt5"
            await _broadcast_signal({
                "type":            "agent_signal",
                "symbol":          verdict.symbol,
                "direction":       verdict.direction,
                "signal_strength": round(verdict.signal_strength, 4),
                "entry":           verdict.entry,
                "sl":              verdict.sl,
                "tp":              verdict.tp,
                "atr":             round(verdict.atr, 5) if verdict.atr else None,
                "risk_amount":     verdict.risk_amount,
                "profit_amount":   verdict.profit_amount,
                "lot_size":        verdict.lot_size,
                "duration":        verdict.duration,
                "votes": [
                    {
                        "agent":      v.agent,
                        "approved":   v.approved,
                        "confidence": round(v.confidence, 4),
                        "reason":     v.reason,
                    }
                    for v in verdict.votes
                ],
                "ts":          verdict.timestamp.isoformat(),
                "read_only":   True,
                "data_source": data_source,
            })
            logger.info(
                "agent_scan: broadcast -- %s %s strength=%.0f%% source=%s",
                verdict.symbol, verdict.direction,
                verdict.signal_strength * 100, data_source,
            )


# -----------------------------------------------------------------------------
# FastAPI application
# -----------------------------------------------------------------------------

app = FastAPI(
    title="MT5 Read-only Local Connector",
    description="Read-only REST facade beside MetaTrader 5 terminal (Windows). No trading endpoints.",
    version=_BUILD_VERSION,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Startup lifecycle
# ---------------------------------------------------------------------------

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
    asyncio.create_task(run_mt5_trade_sync())


@app.post("/connect")
def connect_mt5(payload: ConnectRequest) -> JSONResponse:
    _enforce_read_only_policy()
    login = int(payload.login)
    server = payload.server.strip()
    password = payload.password
    terminal_path = payload.terminal_path.strip()

    # Basic field validation
    if login <= 0:
        return Utf8JsonResponse(
            status_code=400,
            content={"connected": False, "error": "رقم الحساب غير صالح — يجب أن يكون رقماً موجباً"},
        )
    if not server:
        return Utf8JsonResponse(
            status_code=400,
            content={"connected": False, "error": "اسم السيرفر مطلوب"},
        )
    if not password:
        return Utf8JsonResponse(
            status_code=400,
            content={"connected": False, "error": "كلمة المرور مطلوبة"},
        )

    # Terminal path validation — checks directory vs file vs missing
    path_error = _validate_terminal_path(terminal_path)
    if path_error:
        return Utf8JsonResponse(
            status_code=400,
            content={"connected": False, "error": path_error},
        )

    ok = mt5.initialize(
        path=terminal_path,
        login=login,
        password=password,
        server=server,
    )
    if not ok:
        err = mt5.last_error()
        return Utf8JsonResponse(
            status_code=503,
            content={
                "connected": False,
                "error": f"فشل الاتصال بـ MT5: {err} — تحقق من بيانات الدخول والسيرفر",
            },
        )
    try:
        info = mt5.account_info()
        if info is None:
            return Utf8JsonResponse(
                status_code=503,
                content={
                    "connected": False,
                    "error": "تم فتح MT5 لكن تعذّر جلب بيانات الحساب — تحقق من رقم الحساب",
                },
            )
        _record_successful_mt5_call()
        return Utf8JsonResponse(
            content={
                "connected": True,
                "read_only": True,
                "account": {
                    "login": int(getattr(info, "login", 0) or 0),
                    "name": getattr(info, "name", None),
                    "company": getattr(info, "company", None),
                    "server": getattr(info, "server", None),
                    "balance": float(getattr(info, "balance", 0.0) or 0.0),
                    "equity": float(getattr(info, "equity", 0.0) or 0.0),
                    "free_margin": float(getattr(info, "margin_free", 0.0) or 0.0),
                    "currency": getattr(info, "currency", None),
                    "leverage": int(getattr(info, "leverage", 0) or 0),
                },
            }
        )
    finally:
        mt5.shutdown()


@app.get("/connection-status")
def connection_status() -> JSONResponse:
    body = _connection_status_payload()
    return Utf8JsonResponse(content=body, status_code=200 if body.get("connected") else 503)


@app.get("/health")
def health() -> JSONResponse:
    """
    Service health — includes uptime, build version, last successful MT5 call,
    and configured symbols. All fields are backward-compatible additions.
    """
    _enforce_read_only_policy()
    symbols_configured = _symbols_from_env()
    ok, err = _safe_mt5_init()
    try:
        if ok:
            _record_successful_mt5_call()
        return Utf8JsonResponse(
            content={
                "status": "ok",
                "read_only_mode": READ_ONLY_MODE,
                "build_version": _BUILD_VERSION,
                "uptime_seconds": _service_uptime_seconds(),
                "mt5_connected": ok,
                "last_successful_mt5_call_at": (
                    _last_successful_mt5_call_at.isoformat()
                    if _last_successful_mt5_call_at is not None
                    else None
                ),
                "symbols_configured": symbols_configured,
                "detail": None if ok else err,
            }
        )
    finally:
        if ok:
            mt5.shutdown()


@app.get("/readonly/account")
def readonly_account() -> JSONResponse:
    _enforce_read_only_policy()
    ok, err = _safe_mt5_init()
    if not ok:
        return Utf8JsonResponse(
            status_code=503,
            content={"connected": False, "error": err or "MT5 غير متاح"},
        )
    try:
        body = _account_payload()
        if not body.get("connected"):
            return Utf8JsonResponse(status_code=503, content=body)
        _record_successful_mt5_call()
        return Utf8JsonResponse(content=body)
    finally:
        mt5.shutdown()


@app.get("/readonly/ticks")
def readonly_ticks() -> JSONResponse:
    _enforce_read_only_policy()
    ok, err = _safe_mt5_init()
    if not ok:
        return Utf8JsonResponse(
            status_code=503,
            content={
                "connected": False,
                "error": err or "MT5 غير متاح",
                "ticks": [],
                "market_closed": None,
            },
        )
    try:
        symbols = _symbols_from_env()
        payload = _ticks_payload(symbols)
        payload["connected"] = True
        payload["symbols_configured"] = symbols
        _record_successful_mt5_call()
        return Utf8JsonResponse(content=payload)
    finally:
        mt5.shutdown()


@app.get("/readonly/positions")
def readonly_positions() -> JSONResponse:
    _enforce_read_only_policy()
    ok, err = _safe_mt5_init()
    if not ok:
        return Utf8JsonResponse(
            status_code=503,
            content={"connected": False, "error": err or "MT5 غير متاح", "positions": []},
        )
    try:
        payload = _positions_payload()
        payload["connected"] = True
        _record_successful_mt5_call()
        return Utf8JsonResponse(content=payload)
    finally:
        mt5.shutdown()


@app.get("/readonly/snapshot")
def readonly_snapshot() -> JSONResponse:
    _enforce_read_only_policy()
    ok, err = _safe_mt5_init()
    if not ok:
        return Utf8JsonResponse(
            status_code=503,
            content={
                "connected": False,
                "error": err or "MT5 غير متاح",
                "account": None,
                "ticks": [],
                "positions": [],
                "market_closed": None,
            },
        )
    try:
        symbols = _get_visible_mt5_symbols() or _symbols_from_env()
        account = _account_payload()
        ticks_block = _ticks_payload(symbols)
        pos_block = _positions_payload()
        if account.get("connected"):
            _record_successful_mt5_call()
        combined = {
            "connected": account.get("connected", False),
            "read_only_mode": READ_ONLY_MODE,
            "account": account if account.get("connected") else None,
            **ticks_block,
            **pos_block,
            "symbols_configured": symbols,
        }
        if not account.get("connected"):
            combined["connected"] = False
            combined.setdefault("error", account.get("error", "تعذّر جلب بيانات الحساب"))
        return Utf8JsonResponse(content=combined)
    finally:
        mt5.shutdown()


def _serialize_symbol_meta(si: Any) -> dict[str, Any]:
    """
    Read-only SymbolInfo subset — no trading.
    Stage 5A: includes lot/tick/stops properties needed for client-side lot calculation.
    All fields are read from MT5 SymbolInfo; no order_send or trading calls.
    """
    def _f(attr: str, fallback: float = 0.0) -> float:
        return float(getattr(si, attr, fallback) or fallback)

    def _i(attr: str, fallback: int = 0) -> int:
        return int(getattr(si, attr, fallback) or fallback)

    def _fn(attr: str) -> float | None:
        v = getattr(si, attr, None)
        return float(v) if v is not None else None

    return {
        # ── identity ─────────────────────────────────────────────────────────
        "name": getattr(si, "name", "") or "",
        "path": getattr(si, "path", "") or "",
        "description": getattr(si, "description", "") or "",
        "currency_base": getattr(si, "currency_base", "") or "",
        "currency_profit": getattr(si, "currency_profit", "") or "",
        "currency_margin": getattr(si, "currency_margin", "") or "",
        # ── price precision ──────────────────────────────────────────────────
        "digits": _i("digits"),
        "point": _f("point"),
        "spread": _i("spread"),
        # ── tick value / size — used in lot calculation ──────────────────────
        # pointValuePerLot = trade_tick_value * (point / trade_tick_size)
        # riskPerLot       = stopPoints * pointValuePerLot
        # estimatedLot     = riskUsd / riskPerLot
        "trade_tick_value": _f("trade_tick_value"),
        "trade_tick_size": _f("trade_tick_size"),
        # ── contract ─────────────────────────────────────────────────────────
        "contract_size": _fn("trade_contract_size"),
        # ── volume limits — for lot normalisation ───────────────────────────
        "volume_min": _f("volume_min"),
        "volume_max": _f("volume_max"),
        "volume_step": _f("volume_step"),
        # ── order distance safety — stops_level * point = minimum stop distance
        "stops_level": _i("trade_stops_level"),
        "freeze_level": _i("trade_freeze_level"),
        # ── visibility / trade mode ──────────────────────────────────────────
        "visible": bool(getattr(si, "visible", False)),
        "trade_mode": _i("trade_mode"),
    }


@app.get("/readonly/symbols")
def readonly_symbols(
    visible_only: bool = Query(default=True, alias="visibleOnly"),
    limit: int | None = Query(default=None, ge=1, le=10_000),
    search: str | None = Query(default=None, max_length=128),
) -> JSONResponse:
    """Catalog via symbols_get — read-only. Defaults to Market Watch visible symbols only."""
    _enforce_read_only_policy()
    ok, err = _safe_mt5_init()
    if not ok:
        return Utf8JsonResponse(
            status_code=503,
            content={
                "connected": False,
                "read_only_mode": READ_ONLY_MODE,
                "source": "mt5-market-watch-visible",
                "visible_only": bool(visible_only),
                "count": 0,
                "symbols": [],
                "error": err or "MT5 غير متاح",
            },
        )
    try:
        raw = mt5.symbols_get()
        rows = raw if raw is not None else ()
        symbols_out = [_serialize_symbol_meta(si) for si in rows]
        if visible_only:
            symbols_out = [s for s in symbols_out if s.get("visible")]
        if search and search.strip():
            q = search.strip().lower()
            symbols_out = [
                s
                for s in symbols_out
                if q in (s.get("name") or "").lower()
                or q in (s.get("path") or "").lower()
                or q in (s.get("description") or "").lower()
            ]
        if limit is not None:
            symbols_out = symbols_out[: int(limit)]
        _record_successful_mt5_call()
        return Utf8JsonResponse(
            content={
                "connected": True,
                "read_only_mode": READ_ONLY_MODE,
                "source": "mt5-market-watch-visible" if visible_only else "mt5-symbols-get-all-debug",
                "visible_only": bool(visible_only),
                "count": len(symbols_out),
                "symbols": symbols_out,
            },
        )
    finally:
        mt5.shutdown()


@app.get("/readonly/history-deals")
def readonly_history_deals(
    days: int = Query(default=30, ge=1, le=365),
    symbol: str | None = Query(default=None),
) -> JSONResponse:
    """Historical closed deals via history_deals_get — read-only."""
    _enforce_read_only_policy()
    ok, err = _safe_mt5_init()
    if not ok:
        return Utf8JsonResponse(
            status_code=503,
            content={
                "connected": False,
                "read_only_mode": READ_ONLY_MODE,
                "deals": [],
                "error": err or "MT5 غير متاح",
            },
        )
    try:
        now_utc = datetime.now(timezone.utc)
        from_date = now_utc - timedelta(days=int(days))
        to_date = now_utc
        deals_raw = mt5.history_deals_get(from_date, to_date)
        deals_list = deals_raw if deals_raw is not None else ()

        deals_out: list[dict[str, Any]] = []
        for d in deals_list:
            sym = getattr(d, "symbol", "") or ""
            if symbol and symbol.strip().upper() and sym.upper() != symbol.strip().upper():
                continue
            ts = getattr(d, "time", None)
            time_ms = _deal_time_to_ms(ts)
            deals_out.append(
                {
                    "ticket": int(getattr(d, "ticket", 0)),
                    "order": int(getattr(d, "order", 0)),
                    "position_id": int(getattr(d, "position_id", 0)),
                    "symbol": sym,
                    "type": int(getattr(d, "type", 0)),
                    "entry": int(getattr(d, "entry", 0)),
                    "volume": float(getattr(d, "volume", 0.0) or 0.0),
                    "price": float(getattr(d, "price", 0.0) or 0.0),
                    "profit": float(getattr(d, "profit", 0.0) or 0.0),
                    "commission": float(getattr(d, "commission", 0.0) or 0.0),
                    "swap": float(getattr(d, "swap", 0.0) or 0.0),
                    "fee": float(getattr(d, "fee", 0.0)) if hasattr(d, "fee") else None,
                    "time": time_ms if time_ms is not None else 0,
                    "time_iso": _iso_from_mt5_time(ts) if ts is not None else None,
                    "comment": getattr(d, "comment", "") or "",
                    "magic": int(getattr(d, "magic", 0) or 0),
                }
            )

        _record_successful_mt5_call()
        return Utf8JsonResponse(
            content={
                "connected": True,
                "read_only_mode": READ_ONLY_MODE,
                "from": from_date.isoformat(),
                "to": to_date.isoformat(),
                "deals": deals_out,
            },
        )
    finally:
        mt5.shutdown()


@app.get("/readonly/candles")
def readonly_candles(
    symbols: str | None = Query(default=None),
    timeframes: str | None = Query(default=None),
    count: int = Query(default=200, ge=1, le=_MAX_CANDLE_COUNT),
) -> JSONResponse:
    """Candles via copy_rates_from_pos — read-only only."""
    _enforce_read_only_policy()
    ok, err = _safe_mt5_init()
    if not ok:
        return Utf8JsonResponse(
            status_code=503,
            content={
                "connected": False,
                "read_only_mode": READ_ONLY_MODE,
                "source": "mt5-local-readonly-candles",
                "candles": [],
                "error": err or "MT5 غير متاح",
            },
        )
    try:
        symbols_list = _parse_symbols_param(symbols) or _symbols_from_env()
        requested_timeframes = _parse_csv_param(timeframes) or list(_DEFAULT_CANDLE_TIMEFRAMES)
        valid_timeframes = [tf for tf in requested_timeframes if tf in _TIMEFRAME_MAP]
        invalid_timeframes = [tf for tf in requested_timeframes if tf not in _TIMEFRAME_MAP]

        if len(valid_timeframes) == 0:
            return Utf8JsonResponse(
                status_code=400,
                content={
                    "connected": True,
                    "read_only_mode": READ_ONLY_MODE,
                    "source": "mt5-local-readonly-candles",
                    "candles": [],
                    "error": (
                        f"لا توجد إطارات زمنية صالحة. الإطارات المقبولة: M1,M5,M15,M30,H1,H4,D1. "
                        f"المُدخَل: {','.join(requested_timeframes)}"
                    ),
                },
            )

        candles: list[dict[str, Any]] = []
        skipped_symbols: list[str] = []

        for sym in symbols_list:
            if not mt5.symbol_select(sym, True):
                # Per-symbol failure — does not abort the whole request.
                skipped_symbols.append(sym)
                continue
            for tf in valid_timeframes:
                tf_const = _TIMEFRAME_MAP.get(tf)
                if tf_const is None:
                    continue
                rates = mt5.copy_rates_from_pos(sym, tf_const, 0, int(count))
                if rates is None:
                    skipped_symbols.append(f"{sym}/{tf}")
                    continue
                for rate in rates:
                    broker_ts = int(rate["time"])
                    # Normalise: subtract broker offset → true UTC seconds.
                    # broker_ts is in broker server time (e.g. UTC+3).
                    # Without this, time_iso would read "10:45+00:00" instead
                    # of the correct "07:45+00:00", causing candleAgeMs to be
                    # ~-3 h and the freshness committee to issue a false BLOCK.
                    utc_ts = broker_ts - _BROKER_TIME_OFFSET_SECS
                    candles.append(
                        {
                            "symbol": sym,
                            "timeframe": tf,
                            "time": utc_ts * 1000,                    # true UTC ms
                            "time_iso": _iso_from_mt5_time(utc_ts),   # true UTC ISO
                            "broker_time_iso": _iso_from_mt5_time(broker_ts),  # raw broker clock (debug)
                            "broker_time_offset_hours": _BROKER_TIME_OFFSET_HOURS,
                            "open": float(rate["open"]),
                            "high": float(rate["high"]),
                            "low": float(rate["low"]),
                            "close": float(rate["close"]),
                            "tick_volume": int(rate["tick_volume"]),
                            "spread": int(rate["spread"]),
                            "real_volume": int(rate["real_volume"]),
                        }
                    )

        if candles:
            _record_successful_mt5_call()

        response: dict[str, Any] = {
            "connected": True,
            "read_only_mode": READ_ONLY_MODE,
            "source": "mt5-local-readonly-candles",
            "symbols": symbols_list,
            "timeframes": valid_timeframes,
            "count": int(count),
            "broker_time_offset_hours": _BROKER_TIME_OFFSET_HOURS,
            "candles": candles,
        }
        if skipped_symbols:
            response["skipped_symbols"] = skipped_symbols
            response["skipped_note"] = (
                "بعض الرموز أو الإطارات الزمنية تعذّر جلبها — تحقق من Market Watch"
            )
            response["skipped_note_ar"] = response["skipped_note"]
            response["skipped_note_code"] = "some_symbols_or_timeframes_skipped"
        if invalid_timeframes:
            response["invalid_timeframes"] = invalid_timeframes

        return Utf8JsonResponse(content=response)
    finally:
        mt5.shutdown()


# =============================================================================
# DEMO EXECUTION — A26.2
# =============================================================================
# order_send is used ONLY here, gated by:
#   1. MT5_DEMO_EXECUTION_ENABLED = True  (env flag, default False)
#   2. manualConfirmation = True           (explicit user action)
#   3. accountMode = "DEMO_ONLY"           (request contract)
#   4. MT5 account trade_mode == 0         (live Demo account check)
#   5. All price/lot/rr validations pass
#
# READ_ONLY_MODE is intentionally NOT changed — all read-only endpoints above
# continue to call _enforce_read_only_policy() and will never reach order_send.
# =============================================================================

# ── Filling mode helpers — A26.3 ─────────────────────────────────────────────
# symbol_info.filling_mode is a bitmask:
#   bit 0 (value 1) → ORDER_FILLING_FOK  (0) supported
#   bit 1 (value 2) → ORDER_FILLING_IOC  (1) supported
#   RETURN (2) is tried as final fallback.
_FILLING_MODE_NAMES: dict[int, str] = {
    mt5.ORDER_FILLING_FOK:    "FOK",
    mt5.ORDER_FILLING_IOC:    "IOC",
    mt5.ORDER_FILLING_RETURN: "RETURN",
}

def _filling_mode_name(mode: int | None) -> str | None:
    if mode is None:
        return None
    return _FILLING_MODE_NAMES.get(mode, f"MODE_{mode}")


def _resolve_filling_modes(sym_info: Any, action: int) -> list[int]:
    """
    Returns candidate filling modes in priority order.
    Market  orders: IOC → FOK → RETURN
    Pending orders: RETURN → IOC → FOK
    """
    mask   = int(getattr(sym_info, "filling_mode", 0) or 0) if sym_info is not None else 0
    fok_ok = bool(mask & 1)
    ioc_ok = bool(mask & 2)

    if action == mt5.TRADE_ACTION_DEAL:
        raw = (
            ([mt5.ORDER_FILLING_IOC]    if ioc_ok else []) +
            ([mt5.ORDER_FILLING_FOK]    if fok_ok else []) +
            [mt5.ORDER_FILLING_RETURN]
        )
    else:
        raw = (
            [mt5.ORDER_FILLING_RETURN] +
            ([mt5.ORDER_FILLING_IOC]   if ioc_ok else []) +
            ([mt5.ORDER_FILLING_FOK]   if fok_ok else [])
        )

    # Deduplicate, preserve order
    seen: set[int] = set()
    result: list[int] = []
    for m in raw:
        if m not in seen:
            seen.add(m)
            result.append(m)
    return result


# ── Mapping: preview order type string → (MT5 order type const, MT5 action const) ──
_DEMO_ORDER_TYPE_MAP: dict[str, tuple[int, int]] = {
    "BUY_MARKET_PREVIEW":  (mt5.ORDER_TYPE_BUY,        mt5.TRADE_ACTION_DEAL),
    "SELL_MARKET_PREVIEW": (mt5.ORDER_TYPE_SELL,        mt5.TRADE_ACTION_DEAL),
    "BUY_LIMIT_PREVIEW":   (mt5.ORDER_TYPE_BUY_LIMIT,  mt5.TRADE_ACTION_PENDING),
    "SELL_LIMIT_PREVIEW":  (mt5.ORDER_TYPE_SELL_LIMIT,  mt5.TRADE_ACTION_PENDING),
    "BUY_STOP_PREVIEW":    (mt5.ORDER_TYPE_BUY_STOP,    mt5.TRADE_ACTION_PENDING),
    "SELL_STOP_PREVIEW":   (mt5.ORDER_TYPE_SELL_STOP,   mt5.TRADE_ACTION_PENDING),
    # BUY_STOP_LIMIT / SELL_STOP_LIMIT deferred to A26.3
}

# ── MT5 retcode → human-readable string ──────────────────────────────────────
_MT5_RETCODES: dict[int, str] = {
    10008: "PLACED (أمر معلق مقبول)",
    10009: "DONE (تم التنفيذ)",
    10010: "DONE_PARTIAL (تنفيذ جزئي)",
    10004: "REQUOTE (إعادة التسعير)",
    10006: "REJECT (مرفوض من السيرفر)",
    10007: "CANCEL (ملغى)",
    10011: "ERROR (خطأ)",
    10012: "TIMEOUT (انتهت المهلة)",
    10013: "INVALID (طلب غير صالح)",
    10014: "INVALID_VOLUME (حجم غير صالح)",
    10015: "INVALID_PRICE (سعر غير صالح)",
    10016: "INVALID_STOPS (SL/TP غير صالح)",
    10017: "TRADE_DISABLED (التداول معطّل)",
    10018: "MARKET_CLOSED (السوق مغلق)",
    10019: "NO_MONEY (رصيد غير كافٍ)",
    10020: "PRICE_CHANGED (تغيّر السعر)",
    10021: "PRICE_OFF (السعر خارج النطاق)",
    10024: "TOO_MANY_REQUESTS (طلبات كثيرة)",
    10030: "INVALID_FILL (وضع التنفيذ غير مدعوم)",
    10031: "CONNECTION (خطأ اتصال)",
    10032: "ONLY_REAL (مسموح للحسابات الحقيقية فقط)",
    10033: "LIMIT_ORDERS (تجاوز حد الأوامر المعلقة)",
    10034: "LIMIT_VOLUME (تجاوز حد الحجم)",
}

def _retcode_text(retcode: int) -> str:
    return _MT5_RETCODES.get(retcode, f"RETCODE_{retcode}")


class DemoOrderRequest(BaseModel):
    """
    عقد طلب التنفيذ التجريبي — A26.2.
    يُرسَل فقط من واجهة المراجعة النهائية بعد تأكيد يدوي.
    لا يُقبَل إلا على حسابات Demo مؤكدة.
    """
    platform:                   str
    accountMode:                str            # must be "DEMO_ONLY"
    symbol:                     str
    orderType:                  str
    direction:                  str | None = None
    entryPrice:                 float | None = None
    stopLoss:                   float | None = None
    takeProfit:                 float | None = None
    estimatedLot:               float | None = None
    riskUsd:                    float = 0.0
    rrRatio:                    float | None = None
    currentBid:                 float | None = None
    currentAsk:                 float | None = None
    spreadPoints:               float | None = None
    decisionId:                 str | None = None
    generatedAt:                float | None = None
    requiresManualConfirmation: bool = False   # must be True from contract
    executionEnabled:           bool = False   # contract value — remains False
    manualConfirmation:         bool = False   # must be True from explicit user action
    manualLot:                  float | None = None  # A26.5: user override for estimatedLot
    # Multi-target split execution (optional)
    comment_override: str | None = None  # overrides default comment (max 31 chars for MT5)
    targetLabel:      str | None = None  # "TP1" | "TP2" | "TP3"
    groupId:          str | None = None  # execution group identifier
    # Execution policy — affects RR floor
    executionPolicy:  str | None = None  # "STRICT" | "EXPERIMENTAL"
    minRequiredRR:    float | None = None  # user's configured minRewardRiskRatio (default 1.5)


def _validate_demo_order(req: DemoOrderRequest) -> str | None:
    """Returns Arabic error string if validation fails, else None."""
    # ── Contract checks ───────────────────────────────────────────────────────
    if req.manualConfirmation is not True:
        return "manualConfirmation يجب أن يكون true"
    if req.accountMode != "DEMO_ONLY":
        return "accountMode يجب أن يكون DEMO_ONLY"
    if req.requiresManualConfirmation is not True:
        return "requiresManualConfirmation يجب أن يكون true في العقد"
    # ── Field presence ────────────────────────────────────────────────────────
    if not req.symbol or not req.symbol.strip():
        return "symbol مطلوب"
    # A26.5: manualLot overrides estimatedLot if valid
    exec_lot_check = req.manualLot if (req.manualLot is not None and req.manualLot > 0) else req.estimatedLot
    if exec_lot_check is None or exec_lot_check <= 0:
        return "estimatedLot (أو manualLot) يجب أن يكون > 0"
    if req.stopLoss is None or req.stopLoss <= 0:
        return "stopLoss مطلوب ويجب > 0"
    if req.takeProfit is None or req.takeProfit <= 0:
        return "takeProfit مطلوب ويجب > 0"
    if req.entryPrice is None or req.entryPrice <= 0:
        return "entryPrice مطلوب ويجب > 0"
    # ── Order type ────────────────────────────────────────────────────────────
    if req.orderType not in _DEMO_ORDER_TYPE_MAP:
        return f"orderType غير مدعوم: {req.orderType}"
    # ── RR — context-aware floor ──────────────────────────────────────────────
    if req.rrRatio is not None:
        policy = (req.executionPolicy or "STRICT").upper()
        label  = (req.targetLabel or "").upper()

        if policy == "EXPERIMENTAL":
            # Lower floors per target label in experimental mode
            if label == "TP1":
                rr_floor = 0.50
            elif label == "TP3":
                rr_floor = 1.00
            else:  # TP2 or single order
                rr_floor = 0.80
        else:
            # STRICT: use client-provided minRequiredRR or 1.5 hard floor
            rr_floor = float(req.minRequiredRR) if req.minRequiredRR is not None else 1.5

        if req.rrRatio < rr_floor:
            return (
                f"rrRatio {req.rrRatio:.2f} أقل من الحد الأدنى "
                f"{rr_floor:.2f} ({policy}"
                + (f" — {label}" if label else "") + ")"
            )
    # ── SL/TP direction sanity ────────────────────────────────────────────────
    is_buy = "BUY" in req.orderType
    if is_buy:
        if req.stopLoss >= req.entryPrice:
            return "BUY: stopLoss يجب أن يكون < entryPrice"
        if req.takeProfit <= req.entryPrice:
            return "BUY: takeProfit يجب أن يكون > entryPrice"
    else:
        if req.stopLoss <= req.entryPrice:
            return "SELL: stopLoss يجب أن يكون > entryPrice"
        if req.takeProfit >= req.entryPrice:
            return "SELL: takeProfit يجب أن يكون < entryPrice"
    # ── Spread guard (if provided) ────────────────────────────────────────────
    if req.spreadPoints is not None and req.spreadPoints > 100:
        return f"السبريد {req.spreadPoints} نقطة يتجاوز الحد الأقصى المسموح (100)"
    return None


def _get_account_float(info: Any, *names: str, default: float = 0.0) -> float:
    """Try multiple attribute names on account_info; return first non-None float."""
    for name in names:
        v = getattr(info, name, None)
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
    return default


def _normalize_lot(raw_lot: float, sym_info: Any | None) -> tuple[float | None, str]:
    """
    Apply symbol volume constraints to raw_lot.
    Returns (normalized_lot_or_None, reason).
    """
    if sym_info is None:
        rounded = round(max(0.0, raw_lot), 2)
        if rounded <= 0:
            return None, "الهامش لا يكفي حتى لأقل لوت مسموح"
        return rounded, "لوت مقترح حسب الهامش المتاح مع هامش أمان 10%"

    v_min  = float(getattr(sym_info, "volume_min",  0.01) or 0.01)
    v_max  = float(getattr(sym_info, "volume_max",  1000) or 1000)
    v_step = float(getattr(sym_info, "volume_step", 0.01) or 0.01)

    steps   = int(raw_lot / v_step)
    clamped = round(max(0.0, min(steps * v_step, v_max)), 4)

    if clamped < v_min:
        return None, f"الهامش لا يكفي حتى لأقل لوت مسموح ({v_min})"
    return clamped, "لوت مقترح حسب الهامش المتاح مع هامش أمان 10%"


def _demo_mt5_init() -> tuple[bool, str | None]:
    """Initialize MT5 for demo execution — does NOT call _enforce_read_only_policy."""
    if not MT5_DEMO_EXECUTION_ENABLED:
        return False, "MT5_DEMO_EXECUTION_ENABLED غير مفعّل في بيئة الخدمة"
    if not mt5.initialize():
        err = mt5.last_error()
        return False, f"تعذّر تهيئة MT5: {err}"
    return True, None


@app.post("/demo/order-send")
def demo_order_send(payload: DemoOrderRequest) -> JSONResponse:
    """
    Demo-only order execution — A26.2.

    Authorisation layers (ALL must pass before order_send is called):
      1. MT5_DEMO_EXECUTION_ENABLED env flag
      2. manualConfirmation = true
      3. accountMode = "DEMO_ONLY"
      4. All field/price/rr validations
      5. MT5 account trade_mode == 0 (Demo)

    READ_ONLY_MODE is NOT checked here — it applies only to the read-only endpoints.
    order_send is called ONLY inside this function.
    """
    # ── Gate 1: env flag ──────────────────────────────────────────────────────
    if not MT5_DEMO_EXECUTION_ENABLED:
        return Utf8JsonResponse(
            status_code=403,
            content={
                "ok": False,
                "accepted": False,
                "errorCode": "PYTHON_MT5_EXECUTION_ENV_DISABLED",
                "error": "Demo execution disabled — set MT5_DEMO_EXECUTION_ENABLED=1 in Python process environment",
                "demoOnly": True,
            },
        )

    # ── Gate 2: request validation ────────────────────────────────────────────
    val_err = _validate_demo_order(payload)
    if val_err:
        return Utf8JsonResponse(
            status_code=400,
            content={"ok": False, "accepted": False, "errorCode": "VALIDATION_ERROR", "error": val_err, "demoOnly": True},
        )

    # ── Gate 3: MT5 initialise (no read-only policy) ──────────────────────────
    ok, err = _demo_mt5_init()
    if not ok:
        return Utf8JsonResponse(
            status_code=503,
            content={"ok": False, "accepted": False, "errorCode": "MT5_INIT_FAILED", "error": err or "MT5 غير متاح", "demoOnly": True},
        )

    try:
        # ── Gate 4: verify Demo account ───────────────────────────────────────
        info = mt5.account_info()
        if info is None:
            return Utf8JsonResponse(
                status_code=503,
                content={"ok": False, "accepted": False, "error": "تعذّر جلب بيانات الحساب", "demoOnly": True},
            )
        # ACCOUNT_TRADE_MODE_DEMO = 0
        if int(getattr(info, "trade_mode", -1)) != 0:
            return Utf8JsonResponse(
                status_code=403,
                content={
                    "ok": False,
                    "accepted": False,
                    "error": "الحساب ليس Demo — يُسمح بالتنفيذ على حسابات Demo فقط",
                    "demoOnly": True,
                },
            )

        sym = payload.symbol.strip().upper()

        # ── Symbol activation ─────────────────────────────────────────────────
        if not mt5.symbol_select(sym, True):
            return Utf8JsonResponse(
                status_code=400,
                content={"ok": False, "accepted": False, "error": f"الرمز '{sym}' غير موجود في Market Watch", "demoOnly": True},
            )

        order_type_val, action_val = _DEMO_ORDER_TYPE_MAP[payload.orderType]

        # ── Determine execution price ─────────────────────────────────────────
        if action_val == mt5.TRADE_ACTION_DEAL:
            # Market orders: use current live price
            tick = mt5.symbol_info_tick(sym)
            if tick is None:
                return Utf8JsonResponse(
                    status_code=503,
                    content={"ok": False, "accepted": False, "error": f"تعذّر جلب السعر الحالي للرمز {sym}", "demoOnly": True},
                )
            exec_price = float(tick.ask) if "BUY" in payload.orderType else float(tick.bid)
        else:
            # Pending orders: use entryPrice from request
            exec_price = float(payload.entryPrice)  # type: ignore[arg-type]

        # ── A26.5: resolve execution lot (manualLot overrides estimatedLot) ──────
        exec_lot: float = (
            float(payload.manualLot)
            if (payload.manualLot is not None and float(payload.manualLot) > 0)
            else float(payload.estimatedLot)  # type: ignore[arg-type]
        )

        # ── A26.3: read symbol_info for filling mode detection ────────────────
        sym_info = mt5.symbol_info(sym)
        symbol_filling_mask = int(getattr(sym_info, "filling_mode", 0) or 0) if sym_info else 0
        filling_modes = _resolve_filling_modes(sym_info, action_val)

        # ── A26.4/A26.5: Pre-trade margin precheck — rejects BEFORE order_send ─
        # A26.5 fix: use correct MT5 attribute "margin_free" (not "free_margin")
        free_margin_before  = _get_account_float(info, "margin_free", "free_margin")
        account_balance     = _get_account_float(info, "balance")
        account_equity      = _get_account_float(info, "equity")
        account_margin_used = _get_account_float(info, "margin")
        account_leverage    = int(getattr(info, "leverage", 0) or 0)

        margin_required:         float | None = None
        margin_precheck_ok:      bool  | None = None
        margin_precheck_unavail  = False
        suggested_max_lot:       float | None = None
        suggested_lot_reason:    str   | None = None

        try:
            mc = mt5.order_calc_margin(order_type_val, sym, exec_lot, exec_price)
            if mc is not None and float(mc) > 0.0:
                margin_required = float(mc)
        except Exception:
            margin_precheck_unavail = True

        if margin_required is not None:
            margin_precheck_ok = margin_required <= free_margin_before
            if not margin_precheck_ok:
                # Insufficient margin — do NOT call order_send
                shortfall = margin_required - free_margin_before
                try:
                    raw_suggested = exec_lot * (free_margin_before / margin_required) * 0.90
                    suggested_max_lot, suggested_lot_reason = _normalize_lot(raw_suggested, sym_info)
                except Exception:
                    suggested_max_lot    = None
                    suggested_lot_reason = "تعذّر حساب اللوت المقترح"

                return Utf8JsonResponse(
                    status_code=400,
                    content={
                        "ok":               False,
                        "accepted":         False,
                        "retcodeText":      "NO_MONEY_PRECHECK",
                        "error":            "الهامش غير كافٍ — لم يتم إرسال الأمر إلى MT5",
                        "marginRequired":   round(margin_required, 2),
                        "freeMarginBefore": round(free_margin_before, 2),
                        "marginShortfall":  round(shortfall, 2),
                        "suggestedMaxLot":  suggested_max_lot,
                        "suggestedLotReason": suggested_lot_reason,
                        "balance":          round(account_balance, 2),
                        "equity":           round(account_equity, 2),
                        "marginUsed":       round(account_margin_used, 2),
                        "leverage":         account_leverage,
                        "execLotRequested": exec_lot,
                        "demoOnly":         True,
                    },
                )

        # ── Build base request (no type_filling yet) ──────────────────────────
        # order_send: ONLY authorised use in this entire service — A26.2/A26.3/A26.5 Demo
        base_req: dict[str, Any] = {
            "action":    action_val,
            "symbol":    sym,
            "volume":    exec_lot,  # A26.5: uses exec_lot (manualLot or estimatedLot)
            "type":      order_type_val,
            "price":     exec_price,
            "sl":        float(payload.stopLoss),       # type: ignore[arg-type]
            "tp":        float(payload.takeProfit),     # type: ignore[arg-type]
            "deviation": 20,
            "magic":     26200,        # A26.2 magic number
            "comment":   (payload.comment_override or "KING_MT5_DEMO_A26_2")[:31],
            "type_time": mt5.ORDER_TIME_GTC,
        }

        # ── Try filling modes in priority order; retry only on INVALID_FILL ──
        _RETCODE_INVALID_FILL = 10030
        mt5_result              = None
        filling_mode_used: int | None = None
        filling_modes_tried: list[int] = []
        last_candidate          = None

        for fill_mode in filling_modes:
            req = {**base_req, "type_filling": fill_mode}
            filling_modes_tried.append(fill_mode)
            # order_send — ONLY authorised call in this codebase — A26.2/A26.3 Demo
            candidate = mt5.order_send(req)  # noqa: S603  # authorised A26.2
            if candidate is None:
                continue
            last_candidate = candidate
            if int(candidate.retcode) != _RETCODE_INVALID_FILL:
                mt5_result       = candidate
                filling_mode_used = fill_mode
                break
            # INVALID_FILL (10030) → loop: try next filling mode

        if mt5_result is None:
            if last_candidate is not None:
                mt5_result = last_candidate          # return last INVALID_FILL result
            else:
                last_err = mt5.last_error()
                return Utf8JsonResponse(
                    status_code=503,
                    content={
                        "ok": False, "accepted": False,
                        "error": f"order_send أرجع None بعد {len(filling_modes_tried)} محاولة: {last_err}",
                        "demoOnly": True,
                    },
                )

        _record_successful_mt5_call()

        accepted = int(mt5_result.retcode) == mt5.TRADE_RETCODE_DONE

        return Utf8JsonResponse(
            content={
                "ok":                 True,
                "accepted":           accepted,
                "ticket":             int(mt5_result.order) if accepted else None,
                "retcode":            int(mt5_result.retcode),
                "mt5Retcode":         int(mt5_result.retcode),
                "retcodeText":        _retcode_text(int(mt5_result.retcode)),
                "message":            getattr(mt5_result, "comment", ""),
                "mt5Comment":         getattr(mt5_result, "comment", ""),
                # Top-level request echo (for client verification)
                "requestedVolume":    exec_lot,
                "requestedPrice":     round(exec_price, 5),
                "requestedSL":        round(float(payload.stopLoss), 5),       # type: ignore[arg-type]
                "requestedTP":        round(float(payload.takeProfit), 5),     # type: ignore[arg-type]
                "fillingModeUsed":    _filling_mode_name(filling_mode_used),
                "fillingModesTried":  [_filling_mode_name(m) for m in filling_modes_tried],
                "symbolFillingMode":  symbol_filling_mask,
                # A26.4/A26.5 margin fields
                "marginRequired":     round(margin_required, 2) if margin_required is not None else None,
                "freeMarginBefore":   round(free_margin_before, 2),
                "marginOk":           margin_precheck_ok,
                "marginPrecheckUnavailable": margin_precheck_unavail or None,
                "balance":            round(account_balance, 2),
                "equity":             round(account_equity, 2),
                "leverage":           account_leverage,
                "requestSummary": {
                    "symbol":    sym,
                    "orderType": payload.orderType,
                    "lot":       exec_lot,
                    "price":     exec_price,
                    "sl":        float(payload.stopLoss),       # type: ignore[arg-type]
                    "tp":        float(payload.takeProfit),     # type: ignore[arg-type]
                    "lotSource": "manualLot" if (payload.manualLot is not None and float(payload.manualLot) > 0) else "estimatedLot",
                },
                "accountLogin": int(getattr(info, "login", 0) or 0),
                "server":       getattr(info, "server", None),
                "demoOnly":     True,
            },
        )

    finally:
        mt5.shutdown()


# ---------------------------------------------------------------------------
# SQLite API endpoints (Phase 1 migration -- replaces Convex queries)
# ---------------------------------------------------------------------------

@app.get("/api/signals")
def api_get_signals(
    limit:  int          = Query(default=50,   ge=1, le=500),
    symbol: str | None   = Query(default=None, max_length=20),
    status: str | None   = Query(default=None, max_length=20),
    db:     Session      = Depends(get_db),
) -> JSONResponse:
    """
    Returns the most recent analytical signals from the agent council.

    Query parameters:
        limit  - max rows returned (default 50, max 500)
        symbol - filter by trading symbol, e.g. XAUUSD (optional)
        status - filter by status: PENDING | ACTIVE | EXPIRED (optional)

    Replaces: Convex query api.strategies.listSignals
    Read-only: no writes performed here.
    """
    q = db.query(StrategySignal)

    if symbol and symbol.strip():
        q = q.filter(StrategySignal.symbol == symbol.strip().upper())

    if status and status.strip():
        q = q.filter(StrategySignal.status == status.strip().upper())

    rows = q.order_by(StrategySignal.timestamp.desc()).limit(limit).all()

    return Utf8JsonResponse(
        content={
            "ok":      True,
            "count":   len(rows),
            "signals": [r.to_dict() for r in rows],
        }
    )


@app.get("/api/journal")
def api_get_journal(
    limit:  int        = Query(default=50,   ge=1, le=500),
    result: str | None = Query(default=None, max_length=20),
    symbol: str | None = Query(default=None, max_length=20),
    db:     Session    = Depends(get_db),
) -> JSONResponse:
    """
    Returns agent-council DecisionJournal entries (approved + rejected history).

    Query parameters:
        limit  - max rows returned (default 50, max 500)
        result - filter by APPROVED | REJECTED (optional)
        symbol - filter by symbol via context JSON field (optional, best-effort)

    Read-only: no writes performed here.
    """
    q = db.query(DecisionJournal)

    if result and result.strip():
        q = q.filter(DecisionJournal.result == result.strip().upper())

    rows = q.order_by(DecisionJournal.timestamp.desc()).limit(limit).all()

    entries: list[dict] = []
    for r in rows:
        row_dict = r.to_dict()
        # Parse context JSON for symbol filtering
        if symbol and symbol.strip():
            try:
                ctx = json.loads(row_dict.get("context", "{}"))
                if ctx.get("symbol", "").upper() != symbol.strip().upper():
                    continue
            except Exception:
                pass
        # Parse context and agents_votes into proper objects for easy frontend use
        try:
            row_dict["context"]      = json.loads(row_dict.get("context", "{}"))
            row_dict["agents_votes"] = json.loads(row_dict.get("agents_votes", "{}"))
        except Exception:
            row_dict["context"]      = {}
            row_dict["agents_votes"] = {}
        entries.append(row_dict)

    return Utf8JsonResponse(
        content={
            "ok":      True,
            "count":   len(entries),
            "entries": entries,
        }
    )


class GoldProSnapshotRequest(BaseModel):
    """Gold Pro Lab — analysis snapshot saved from the UI. Read-only record, no trading."""
    symbol:           str
    timestamp:        int | None = None
    price:            float | None = None
    signal:           str | None = None
    confluenceScore:  float | None = None
    entryPrice:       float | None = None
    stopLoss:         float | None = None
    takeProfit1:      float | None = None
    takeProfit2:      float | None = None
    rrRatio:          float | None = None
    lotSize:          float | None = None
    atr:              float | None = None
    mtfAlignment:     int | None = None
    indicators:       dict | None = None


@app.post("/api/gold-pro/snapshots")
def api_save_gold_pro_snapshot(
    body: GoldProSnapshotRequest,
    db: Session = Depends(get_db),
) -> JSONResponse:
    """
    Saves a Gold Pro Lab analysis snapshot locally (SQLite).
    Replaces: Convex mutation api.goldProAnalysis.saveAnalysis.
    Read-only analytical record — no trading performed.
    """
    row = GoldProAnalysis(
        symbol=body.symbol.strip().upper(),
        analysis_ts=datetime.fromtimestamp(body.timestamp / 1000, tz=timezone.utc) if body.timestamp else None,
        price=body.price,
        signal=body.signal,
        confluence_score=body.confluenceScore,
        entry_price=body.entryPrice,
        stop_loss=body.stopLoss,
        take_profit_1=body.takeProfit1,
        take_profit_2=body.takeProfit2,
        rr_ratio=body.rrRatio,
        lot_size=body.lotSize,
        atr=body.atr,
        mtf_alignment=body.mtfAlignment,
        indicators=json.dumps(body.indicators or {}),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return Utf8JsonResponse(content={"ok": True, "id": row.id})


@app.get("/api/gold-pro/snapshots")
def api_get_gold_pro_snapshots(
    limit:  int        = Query(default=50, ge=1, le=500),
    symbol: str | None = Query(default=None, max_length=20),
    db:     Session    = Depends(get_db),
) -> JSONResponse:
    """
    Returns the most recent Gold Pro Lab analysis snapshots.
    Replaces: Convex query api.goldProAnalysis.getMyAnalyses.
    Read-only — no writes performed here.
    """
    q = db.query(GoldProAnalysis)

    if symbol and symbol.strip():
        q = q.filter(GoldProAnalysis.symbol == symbol.strip().upper())

    rows = q.order_by(GoldProAnalysis.timestamp.desc()).limit(limit).all()

    return Utf8JsonResponse(
        content={
            "ok":      True,
            "count":   len(rows),
            "history": [r.to_dict() for r in rows],
        }
    )


@app.get("/api/gold-pro/accuracy-stats")
def api_get_gold_pro_accuracy_stats(
    symbol: str | None = Query(default=None, max_length=20),
    db:     Session    = Depends(get_db),
) -> JSONResponse:
    """
    Returns aggregate accuracy stats over saved Gold Pro Lab snapshots.
    Replaces: Convex query api.goldProAnalysis.getAccuracyStats.
    Read-only — no writes performed here.
    """
    q = db.query(GoldProAnalysis)

    if symbol and symbol.strip():
        q = q.filter(GoldProAnalysis.symbol == symbol.strip().upper())

    rows = q.all()

    total   = len(rows)
    wins    = sum(1 for r in rows if r.outcome == "win")
    losses  = sum(1 for r in rows if r.outcome == "loss")
    pending = sum(1 for r in rows if r.outcome == "pending")
    decided = wins + losses
    accuracy = round((wins / decided) * 100, 1) if decided > 0 else 0.0

    return Utf8JsonResponse(
        content={
            "ok": True,
            "stats": {
                "total":    total,
                "wins":     wins,
                "losses":   losses,
                "pending":  pending,
                "accuracy": accuracy,
            },
        }
    )


def _diagnose_telegram_dns(host: str = "api.telegram.org", port: int = 443) -> str | None:
    """
    Best-effort connectivity hint for Telegram failures.
    Returns a short Arabic diagnostic string, or None if everything looks reachable.
    Never raises — used only to enrich error messages.
    """
    try:
        socket.getaddrinfo(host, port)
    except OSError:
        return f"تعذّر تحويل (DNS) العنوان {host} — تحقق من إعدادات DNS/الشبكة"

    try:
        with socket.create_connection((host, port), timeout=5.0):
            pass
    except OSError:
        return f"تم تحويل (DNS) العنوان {host} لكن الاتصال بالمنفذ {port} محظور — تحقق من جدار الحماية أو مضاد الفيروسات"

    return None


@app.post("/api/telegram/test")
def api_telegram_test(db: Session = Depends(get_db)) -> JSONResponse:
    """
    Send a test message to the configured Telegram bot.
    Reads credentials from DB (SystemConfig) first, falls back to env vars.
    Returns 200 OK if delivered, 503 otherwise.
    Read-only — no trades executed.
    """
    import requests as _req

    # Read from DB first, then env
    def _get_cred(key: str, env_key: str) -> str | None:
        row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
        if row and row.value:
            return row.value
        return os.environ.get(env_key)

    token   = _get_cred("telegram_bot_token", "TELEGRAM_BOT_TOKEN")
    chat_id = _get_cred("telegram_chat_id",   "TELEGRAM_CHAT_ID")
    proxy_url = _get_cred("telegram_proxy_url", "TELEGRAM_PROXY_URL")

    if not token or not chat_id:
        return Utf8JsonResponse(
            status_code=503,
            content={"ok": False, "detail": "Telegram credentials not configured"},
        )

    proxies = {"https": proxy_url, "http": proxy_url} if proxy_url else None

    try:
        resp = _req.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={
                "chat_id":    chat_id,
                "text":       "اختبار اتصال — نظام الملك الهندسي للتداول العالمي",
                "parse_mode": "HTML",
            },
            timeout=15.0,
            proxies=proxies,
        )
        if resp.ok:
            return Utf8JsonResponse(content={"ok": True})
        # Telegram error responses are JSON: {"ok":false,"error_code":...,"description":"..."}
        try:
            err_json = resp.json()
            detail = err_json.get("description") or resp.text[:200]
        except ValueError:
            detail = resp.text[:200]
        if resp.status_code == 401:
            detail = f"رمز البوت (Token) غير صحيح: {detail}"
        elif resp.status_code == 400 and "chat not found" in detail.lower():
            detail = f"معرف المحادثة (Chat ID) غير صحيح أو لم يبدأ المستخدم محادثة مع البوت بعد (أرسل /start للبوت): {detail}"
        return Utf8JsonResponse(
            status_code=503,
            content={"ok": False, "detail": detail},
        )
    except _req.exceptions.Timeout:
        dns_hint = _diagnose_telegram_dns()
        return Utf8JsonResponse(
            status_code=503,
            content={
                "ok": False,
                "detail": (
                    "انتهت مهلة الاتصال بخوادم Telegram — تحقق من اتصال الإنترنت أو الجدار الناري"
                    + (f" — {dns_hint}" if dns_hint else "")
                ),
            },
        )
    except _req.exceptions.ConnectionError as exc:
        dns_hint = _diagnose_telegram_dns()
        return Utf8JsonResponse(
            status_code=503,
            content={
                "ok": False,
                "detail": (
                    f"تعذّر الاتصال بخوادم Telegram (api.telegram.org) — تحقق من اتصال الإنترنت: {exc}"
                    + (f" — {dns_hint}" if dns_hint else "")
                ),
            },
        )
    except Exception as exc:
        return Utf8JsonResponse(
            status_code=503,
            content={"ok": False, "detail": str(exc)},
        )


@app.post("/api/telegram/test-connections")
def api_telegram_test_connections(db: Session = Depends(get_db)) -> JSONResponse:
    """
    يفحص اتصال MT5 و OKX ثم يرسل عبر Telegram:
      1) رسالة حالة الاتصال للمنصتين.
      2) رسالة صفقة نموذجية [تجريبي] بنفس تنسيق التنبيهات الحقيقية.
    Read-only -- لا يتم فتح أو تعديل أي صفقة.
    """
    import requests as _req

    def _get_cred(key: str, env_key: str) -> str | None:
        row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
        if row and row.value:
            return row.value
        return os.environ.get(env_key)

    token     = _get_cred("telegram_bot_token", "TELEGRAM_BOT_TOKEN")
    chat_id   = _get_cred("telegram_chat_id",   "TELEGRAM_CHAT_ID")
    proxy_url = _get_cred("telegram_proxy_url", "TELEGRAM_PROXY_URL")

    if not token or not chat_id:
        return Utf8JsonResponse(
            status_code=503,
            content={"ok": False, "detail": "Telegram credentials not configured"},
        )

    proxies = {"https": proxy_url, "http": proxy_url} if proxy_url else None

    # -- 1) فحص اتصال MT5 -----------------------------------------------
    mt5_status: dict[str, Any] = {"connected": False}
    init_ok, init_err = _safe_mt5_init()
    if init_ok:
        try:
            account = _account_payload()
            if account.get("connected"):
                mt5_status = {
                    "connected": True,
                    "login":   account.get("login"),
                    "server":  account.get("server"),
                    "balance": account.get("balance"),
                    "currency": account.get("currency"),
                }
            else:
                mt5_status = {"connected": False, "error": account.get("error")}
        finally:
            mt5.shutdown()
    else:
        mt5_status = {"connected": False, "error": init_err}

    # -- 2) فحص اتصال OKX (بيانات عامة فقط) -------------------------------
    okx_status: dict[str, Any] = {"connected": False}
    try:
        tickers = fetch_okx_tickers(["BTC-USDT"])
        if tickers:
            okx_status = {"connected": True, "symbol": tickers[0]["symbol"], "last": tickers[0]["last"]}
        else:
            okx_status = {"connected": False, "error": "تعذّر جلب بيانات OKX العامة"}
    except Exception as exc:
        okx_status = {"connected": False, "error": str(exc)}

    baghdad_time = datetime.now(timezone.utc) + timedelta(hours=3)
    time_str = baghdad_time.strftime("%I:%M %p").lstrip("0") + " بتوقيت بغداد"

    mt5_line = (
        f"🟢 MT5: متصل — الحساب {mt5_status.get('login')} / {mt5_status.get('server')} "
        f"(الرصيد: {mt5_status.get('balance')} {mt5_status.get('currency')})"
        if mt5_status.get("connected")
        else f"🔴 MT5: غير متصل — {mt5_status.get('error') or 'غير معروف'}"
    )
    okx_line = (
        f"🟢 OKX: متصل — {okx_status.get('symbol')} = ${okx_status.get('last')}"
        if okx_status.get("connected")
        else f"🔴 OKX: غير متصل — {okx_status.get('error') or 'غير معروف'}"
    )

    status_text = (
        f"━━━━━━━━━━━━━━━━━━━\n"
        f"📡 رسالة اختبار اتصال المنصات\n"
        f"──────────────────\n"
        f"{mt5_line}\n"
        f"{okx_line}\n"
        f"──────────────────\n"
        f"⏰ وقت الفحص: {time_str}\n"
        f"\n"
        f"تحليل معلوماتي مؤسسي — ليس توصية مالية"
    )

    demo_text = (
        f"━━━━━━━━━━━━━━━━━━━\n"
        f"[تجريبي] نموذج تنسيق إشارة — لا يمثل توصية فعلية\n"
        f"🪙 الزوج: GBPUSD  —  1h\n"
        f"🔴 الإشارة: بيع SELL   |   القوة: متوسطة ⚡️⚡️\n"
        f"──────────────────\n"
        f"📥 سعر الدخول: <code>1.33956</code>\n"
        f"🛑 وقف الخسارة (SL): <code>1.34151</code>\n"
        f"🏆 الهدف الذكي (TP): <code>1.33565</code>\n"
        f"──────────────────\n"
        f"💰 حجم اللوت/العقد: <code>0.44</code>\n"
        f"⚠️ المبلغ المعرض للمخاطرة: 2.0% (≈ $71.89 من رصيد المنصة الحي)\n"
        f"🎯 الربح المتوقع: $143.78\n"
        f"⏳ مدة الصفقة المتوقعة: 4 إلى 12 ساعة\n"
        f"──────────────────\n"
        f"⏰ وقت صدور الإشارة: {time_str}\n"
        f"\n"
        f"[تجريبي] تحليل معلوماتي مؤسسي — ليس توصية مالية"
    )

    sent: dict[str, bool] = {"status_message": False, "demo_message": False}
    errors: dict[str, str] = {}

    for label, text in (("status_message", status_text), ("demo_message", demo_text)):
        try:
            resp = _req.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
                timeout=15.0,
                proxies=proxies,
            )
            if resp.ok:
                sent[label] = True
            else:
                try:
                    err_json = resp.json()
                    errors[label] = err_json.get("description") or resp.text[:200]
                except ValueError:
                    errors[label] = resp.text[:200]
        except Exception as exc:
            errors[label] = str(exc)

    return Utf8JsonResponse(
        content={
            "ok": all(sent.values()),
            "mt5":  mt5_status,
            "okx":  okx_status,
            "sent": sent,
            "errors": errors,
        }
    )


@app.get("/api/telegram/subscribers")
def api_telegram_subscribers(db: Session = Depends(get_db)) -> JSONResponse:
    """
    قائمة كل المشتركين في بوت التوصيات (نشط/متوقف/محظور) + عدادات إجمالية.
    قراءة فقط -- لا تنفيذ تداول، لا إرسال رسائل.
    """
    rows = db.query(TelegramSubscriber).order_by(TelegramSubscriber.updated_at.desc()).all()
    subscribers = [row.to_dict() for row in rows]
    active = sum(1 for s in subscribers if s["isActive"])
    blocked = sum(1 for s in subscribers if s["isBlocked"])
    return Utf8JsonResponse(content={
        "ok": True,
        "total": len(subscribers),
        "active": active,
        "blocked": blocked,
        "subscribers": subscribers,
    })


class TelegramSubscriberAction(BaseModel):
    chatId: str


@app.post("/api/telegram/subscribers/block")
def api_telegram_subscribers_block(body: TelegramSubscriberAction, db: Session = Depends(get_db)) -> JSONResponse:
    """
    حظر مشترك: يوقف إرسال التوصيات إليه فوراً (is_active=0) ويمنعه من
    إعادة الاشتراك عبر /start حتى يُلغى الحظر. قراءة/تحكم فقط.
    """
    row = db.query(TelegramSubscriber).filter(TelegramSubscriber.chat_id == body.chatId).first()
    if row is None:
        return Utf8JsonResponse(status_code=404, content={"ok": False, "detail": "subscriber not found"})
    block_subscriber(db, body.chatId)
    return Utf8JsonResponse(content={"ok": True})


@app.post("/api/telegram/subscribers/unblock")
def api_telegram_subscribers_unblock(body: TelegramSubscriberAction, db: Session = Depends(get_db)) -> JSONResponse:
    """
    إلغاء حظر مشترك. لا يعيد التفعيل تلقائياً -- يجب أن يرسل /start من جديد.
    قراءة/تحكم فقط.
    """
    row = db.query(TelegramSubscriber).filter(TelegramSubscriber.chat_id == body.chatId).first()
    if row is None:
        return Utf8JsonResponse(status_code=404, content={"ok": False, "detail": "subscriber not found"})
    unblock_subscriber(db, body.chatId)
    return Utf8JsonResponse(content={"ok": True})


@app.post("/api/trade-history/sync-now")
def api_trade_history_sync_now(db: Session = Depends(get_db)) -> JSONResponse:
    """
    تشغيل دورة مزامنة واحدة فوراً لسجل الصفقات (تشخيص/تجربة) -- نفس منطق
    الحلقة الخلفية كل 60 ثانية. لا ينفذ أي صفقة، فقط سحب + تخزين + مطابقة.
    قراءة/تحليل فقط.
    """
    counters = sync_mt5_trades_once(db)
    return Utf8JsonResponse(content={"ok": True, **counters})


# ---------------------------------------------------------------------------
# System Configuration endpoints (GET/POST /api/config)
# ---------------------------------------------------------------------------

_ALLOWED_CONFIG_KEYS: frozenset[str] = frozenset({
    "ema_length",
    "rsi_length",
    "atr_length",
    "bb_length",
    "bb_std",
    "atr_sl_mult",
    "atr_tp_mult",
    "min_rr",
    "telegram_bot_token",
    "telegram_chat_id",
    "telegram_proxy_url",
    "okx_account_balance_usd",
})

_CONFIG_DEFAULTS: dict[str, str] = {
    "ema_length":  "200",
    "rsi_length":  "14",
    "atr_length":  "14",
    "bb_length":   "20",
    "bb_std":      "2.0",
    "atr_sl_mult": "1.5",
    "atr_tp_mult": "3.0",
    "min_rr":      "2.0",
    "okx_account_balance_usd": "10000",
}


@app.get("/api/config")
def api_get_config(db: Session = Depends(get_db)) -> JSONResponse:
    """
    Return the current engine configuration merged with defaults.
    Telegram tokens are masked in the response (first 10 chars only).
    Read-only: no writes.
    """
    rows = db.query(SystemConfig).all()
    stored: dict[str, str] = {r.key: r.value for r in rows}

    # Merge defaults with stored (stored wins)
    merged: dict[str, str] = {**_CONFIG_DEFAULTS, **stored}

    # Mask sensitive values
    masked = {}
    for k, v in merged.items():
        if k == "telegram_bot_token" and v:
            masked[k] = v[:10] + "..." if len(v) > 10 else "***"
        else:
            masked[k] = v

    return Utf8JsonResponse(content={"ok": True, "config": masked})


class _ConfigEntry(BaseModel):
    key:   str
    value: str


class _ConfigBatch(BaseModel):
    entries: list[_ConfigEntry]


@app.post("/api/config")
def api_set_config(body: _ConfigEntry, db: Session = Depends(get_db)) -> JSONResponse:
    """
    Save or update a single config key.
    Only keys in _ALLOWED_CONFIG_KEYS are accepted.
    """
    if body.key not in _ALLOWED_CONFIG_KEYS:
        return Utf8JsonResponse(
            status_code=422,
            content={"ok": False, "detail": f"Key '{body.key}' is not configurable"},
        )
    existing = db.query(SystemConfig).filter(SystemConfig.key == body.key).first()
    if existing:
        existing.value      = body.value
        existing.updated_at = datetime.now(timezone.utc)
    else:
        db.add(SystemConfig(key=body.key, value=body.value))
    db.commit()
    return Utf8JsonResponse(content={"ok": True, "key": body.key})


@app.post("/api/config/batch")
def api_set_config_batch(
    body: _ConfigBatch,
    db:   Session = Depends(get_db),
) -> JSONResponse:
    """
    Save multiple config entries in a single transaction.
    Only keys in _ALLOWED_CONFIG_KEYS are accepted; unknown keys are skipped.
    """
    saved: list[str] = []
    skipped: list[str] = []
    for entry in body.entries:
        if entry.key not in _ALLOWED_CONFIG_KEYS:
            skipped.append(entry.key)
            continue
        existing = db.query(SystemConfig).filter(SystemConfig.key == entry.key).first()
        if existing:
            existing.value      = entry.value
            existing.updated_at = datetime.now(timezone.utc)
        else:
            db.add(SystemConfig(key=entry.key, value=entry.value))
        saved.append(entry.key)
    db.commit()
    return Utf8JsonResponse(content={"ok": True, "saved": saved, "skipped": skipped})


@app.delete("/api/config/{key}")
def api_delete_config(key: str, db: Session = Depends(get_db)) -> JSONResponse:
    """
    Delete a config key to revert it to the built-in default.
    Useful for the 'Reset to Defaults' button on individual settings.
    """
    row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if row:
        db.delete(row)
        db.commit()
    return Utf8JsonResponse(content={"ok": True, "key": key, "reverted_to_default": True})


# ---------------------------------------------------------------------------
# Triple Firewall — confluence history, market session clock, position sizing
# (Read-only / stateless analytics -- no trading execution of any kind)
# ---------------------------------------------------------------------------

@app.get("/api/triple-firewall/signals")
def api_triple_firewall_signals(
    limit:      int        = Query(default=50,   ge=1, le=500),
    symbol:     str | None = Query(default=None, max_length=20),
    confluence: str | None = Query(default=None, max_length=10),
    db:         Session    = Depends(get_db),
) -> JSONResponse:
    """
    Returns recent Triple Firewall confluence analysis history.

    Query parameters:
        limit      - max rows returned (default 50, max 500)
        symbol     - filter by trading symbol, e.g. XAUUSD (optional)
        confluence - filter by confluence level: NONE | WEAK | MEDIUM | STRONG (optional)

    Read-only: no writes performed here.
    """
    q = db.query(TripleFirewallSignal)

    if symbol and symbol.strip():
        q = q.filter(TripleFirewallSignal.symbol == symbol.strip().upper())

    if confluence and confluence.strip():
        q = q.filter(TripleFirewallSignal.confluence_level == confluence.strip().upper())

    rows = q.order_by(TripleFirewallSignal.timestamp.desc()).limit(limit).all()

    return Utf8JsonResponse(
        content={
            "ok":      True,
            "count":   len(rows),
            "signals": [r.to_dict() for r in rows],
        }
    )


@app.get("/api/triple-firewall/session")
def api_triple_firewall_session() -> JSONResponse:
    """
    Returns the current FX market session clock (Baghdad UTC+3).
    Pure informational data -- no DB access, no trading.
    """
    return Utf8JsonResponse(content={"ok": True, "session": get_market_session()})


class PositionSizeRequest(BaseModel):
    """Stateless risk-percent position sizing request. Informational only -- no trading."""
    accountEquity:  float
    riskPercent:    float
    entryPrice:     float
    stopLoss:       float
    tradeTickValue: float
    tradeTickSize:  float
    point:          float
    volumeMin:      float = 0.01
    volumeMax:      float = 1000.0
    volumeStep:     float = 0.01


@app.post("/api/triple-firewall/position-size")
def api_triple_firewall_position_size(body: PositionSizeRequest) -> JSONResponse:
    """
    Calculates a normalized lot size from a risk-percent-of-equity model.
    Stateless, read-only -- does not place or modify any order.
    """
    result = calculate_position_size(
        account_equity=body.accountEquity,
        risk_percent=body.riskPercent,
        entry_price=body.entryPrice,
        stop_loss=body.stopLoss,
        trade_tick_value=body.tradeTickValue,
        trade_tick_size=body.tradeTickSize,
        point=body.point,
        volume_min=body.volumeMin,
        volume_max=body.volumeMax,
        volume_step=body.volumeStep,
    )
    return Utf8JsonResponse(content={"ok": True, **result})


# ---------------------------------------------------------------------------
# OKX Public Market Data endpoints (Read-Only -- no auth required)
# ---------------------------------------------------------------------------

@app.get("/readonly/okx/candles")
def readonly_okx_candles(
    instId: str = Query(default="BTC-USDT", max_length=30, alias="instId"),
    bar:    str = Query(default="1H",        max_length=5),
    limit:  int = Query(default=250,         ge=1, le=300),
) -> JSONResponse:
    """
    Fetch OHLCV candles from OKX public REST API.
    No authentication required. Read-only market data only.
    No trading execution of any kind.
    """
    try:
        candles = fetch_okx_candles(instId.strip(), bar.strip(), limit)
    except Exception as exc:
        logger.error("readonly_okx_candles: unexpected error -- %s", exc)
        return Utf8JsonResponse(
            status_code=503,
            content={"ok": False, "error": str(exc), "candles": []},
        )

    return Utf8JsonResponse(content={
        "ok":      True,
        "source":  "okx-public",
        "instId":  instId,
        "bar":     bar,
        "count":   len(candles),
        "candles": candles,
    })


@app.get("/readonly/okx/tickers")
def readonly_okx_tickers(
    symbols: str = Query(default="BTC-USDT,ETH-USDT", max_length=200),
) -> JSONResponse:
    """
    Fetch live ticker snapshot for one or more OKX instruments.
    No authentication required. Read-only market data only.
    Pass comma-separated instrument IDs, e.g. symbols=BTC-USDT,ETH-USDT
    """
    inst_ids = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not inst_ids:
        return Utf8JsonResponse(
            status_code=400,
            content={"ok": False, "error": "لم يتم تحديد أي رمز", "tickers": []},
        )

    try:
        tickers = fetch_okx_tickers(inst_ids)
    except Exception as exc:
        logger.error("readonly_okx_tickers: unexpected error -- %s", exc)
        return Utf8JsonResponse(
            status_code=503,
            content={"ok": False, "error": str(exc), "tickers": []},
        )

    return Utf8JsonResponse(content={
        "ok":      True,
        "source":  "okx-public",
        "count":   len(tickers),
        "tickers": tickers,
    })


# ---------------------------------------------------------------------------
# Gold + Crypto: Screener + Multi-Timeframe Analysis (Read-Only)
#
# يخص هذا القسم الذهب (XAUUSD) والكريبتو (OKX) فقط:
#   1) GET  /api/lab/gold-crypto-screener        -- قائمة ترشيح الأزواج القابلة للتداول
#   2) POST /api/lab/multi-timeframe-analysis    -- تحليل الزوج المختار عبر عدة فريمات
# ---------------------------------------------------------------------------

# الأزواج المسموح بها لهذه الميزة فقط (الذهب + الكريبتو)
_SCREENER_MT5_SYMBOLS: list[str] = ["XAUUSD"]
_MTF_MT5_TIMEFRAMES:   list[str] = ["M5", "M15", "H1", "H4", "D1"]
_MTF_OKX_BARS:         list[str] = ["5m", "15m", "1H", "4H", "1D"]


def _get_okx_account_balance() -> float:
    """رأس مال OKX المُدخل يدوياً من الإعدادات (افتراضي $10,000)."""
    db = SessionLocal()
    try:
        row = db.query(SystemConfig).filter(
            SystemConfig.key == "okx_account_balance_usd"
        ).first()
        return float(row.value) if row and row.value else float(_CONFIG_DEFAULTS["okx_account_balance_usd"])
    except Exception:
        return float(_CONFIG_DEFAULTS["okx_account_balance_usd"])
    finally:
        db.close()


@app.get("/api/lab/gold-crypto-screener")
async def api_gold_crypto_screener() -> JSONResponse:
    """
    شاشة ترشيح الذهب والكريبتو: تعيد قائمة بالأزواج (XAUUSD + رموز OKX)
    مع حالة السوق الحالية وما إذا كانت قابلة للتحليل الآن.
    قراءة فقط -- لا تنفيذ تداول من أي نوع.
    """
    candidates: list[dict[str, Any]] = []

    # -- XAUUSD عبر MT5 --
    init_ok, init_err = await asyncio.to_thread(_safe_mt5_init)
    if init_ok:
        try:
            ticks = await asyncio.to_thread(_ticks_payload, _SCREENER_MT5_SYMBOLS)
        finally:
            await asyncio.to_thread(mt5.shutdown)

        for t in ticks.get("ticks", []):
            if t.get("error"):
                candidates.append({
                    "symbol": t["symbol"],
                    "source": "mt5",
                    "tradable": False,
                    "reason": t["error"],
                })
                continue

            market_closed = bool(t.get("market_closed"))
            candidates.append({
                "symbol": t["symbol"],
                "source": "mt5",
                "tradable": not market_closed,
                "reason": "السوق مغلق حالياً" if market_closed else "السوق مفتوح -- قابل للتحليل",
                "bid": t.get("bid"),
                "ask": t.get("ask"),
                "spread": t.get("spread"),
                "spread_points": t.get("spread_points"),
                "time": t.get("time"),
            })
    else:
        for sym in _SCREENER_MT5_SYMBOLS:
            candidates.append({
                "symbol": sym,
                "source": "mt5",
                "tradable": False,
                "reason": f"تعذّر الاتصال بـ MT5: {init_err}",
            })

    # -- OKX (BTC-USDT, ETH-USDT, ...) --
    try:
        okx_tickers = await asyncio.to_thread(fetch_okx_tickers, _OKX_SCAN_SYMBOLS)
    except Exception as exc:
        okx_tickers = []
        logger.warning("gold_crypto_screener: OKX tickers failed -- %s", exc)

    okx_seen = {t["symbol"] for t in okx_tickers}
    for t in okx_tickers:
        candidates.append({
            "symbol": t["symbol"],
            "source": "okx",
            "tradable": True,
            "reason": "السوق متاح على مدار الساعة -- قابل للتحليل",
            "last": t.get("last"),
            "bid": t.get("bid"),
            "ask": t.get("ask"),
            "change_pct_24h": t.get("change_pct"),
            "vol_24h": t.get("vol_24h"),
            "time": t.get("ts"),
        })

    for sym in _OKX_SCAN_SYMBOLS:
        if sym not in okx_seen:
            candidates.append({
                "symbol": sym,
                "source": "okx",
                "tradable": False,
                "reason": "تعذّر جلب بيانات السعر من OKX حالياً",
            })

    return Utf8JsonResponse(content={
        "ok":         True,
        "read_only":  True,
        "candidates": candidates,
        "ts":         datetime.now(timezone.utc).isoformat(),
    })


class MultiTimeframeAnalysisRequest(BaseModel):
    symbol: str


@app.post("/api/lab/multi-timeframe-analysis")
async def api_multi_timeframe_analysis(body: MultiTimeframeAnalysisRequest) -> JSONResponse:
    """
    تحليل الزوج المختار (XAUUSD أو رمز OKX) عبر عدة فريمات زمنية
    (M5/M15/H1/H4/D1 لـ MT5، أو 5m/15m/1H/4H/1D لـ OKX).

    يخص هذه الميزة الذهب والكريبتو فقط. أي إشارة معتمدة يتم حفظها في قاعدة
    البيانات وإرسال تنبيه تيليجرام لها تلقائياً عبر المسار الحالي
    (analyze_market -> _send_telegram_alert) -- لا حاجة لكود إرسال جديد.

    قراءة فقط -- لا تنفيذ تداول من أي نوع.
    """
    symbol = body.symbol.strip().upper()
    allowed = set(_SCREENER_MT5_SYMBOLS) | set(_OKX_SCAN_SYMBOLS)
    if symbol not in allowed:
        return Utf8JsonResponse(
            status_code=400,
            content={
                "ok": False,
                "error": f"الرمز '{symbol}' غير مسموح به -- هذه الميزة تخص الذهب والكريبتو فقط",
                "allowed_symbols": sorted(allowed),
            },
        )

    engine = CouncilEngine()
    results: list[dict[str, Any]] = []

    if "-" in symbol:
        # -- مسار OKX --
        account_balance = await asyncio.to_thread(_get_okx_account_balance)
        for bar in _MTF_OKX_BARS:
            verdicts = await asyncio.to_thread(
                _sync_scan_okx_cycle, engine, [symbol], bar, _AGENT_SCAN_CANDLE_COUNT, account_balance,
            )
            results.append(_verdict_to_summary(OKX_BAR_DISPLAY.get(bar, bar), verdicts))
    else:
        # -- مسار MT5 --
        for tf in _MTF_MT5_TIMEFRAMES:
            verdicts = await asyncio.to_thread(
                _sync_scan_cycle, engine, [symbol], tf, _AGENT_SCAN_CANDLE_COUNT,
            )
            results.append(_verdict_to_summary(tf, verdicts))

    return Utf8JsonResponse(content={
        "ok":        True,
        "read_only": True,
        "symbol":    symbol,
        "results":   results,
        "ts":        datetime.now(timezone.utc).isoformat(),
    })


def _verdict_to_summary(timeframe: str, verdicts: list[CouncilVerdict]) -> dict[str, Any]:
    """يحوّل CouncilVerdict إلى ملخص JSON لاستخدامه في تحليل متعدد الفريمات."""
    if not verdicts:
        return {
            "timeframe": timeframe,
            "approved": False,
            "direction": None,
            "reason": "تعذّر جلب الشموع لهذا الفريم",
        }

    v = verdicts[0]
    return {
        "timeframe":       timeframe,
        "approved":        v.approved,
        "direction":       v.direction,
        "signal_strength": round(v.signal_strength, 4) if v.signal_strength is not None else None,
        "entry":           v.entry,
        "sl":              v.sl,
        "tp":              v.tp,
        "lot_size":        v.lot_size,
        "risk_amount":     v.risk_amount,
        "risk_percent":    v.risk_percent,
        "profit_amount":   v.profit_amount,
        "duration":        v.duration,
        "digits":          v.digits,
        "confluence":      v.confluence,
    }


# ---------------------------------------------------------------------------
# Ranked Screener + Watchlist (Read-Only, Gold + Crypto + MT5 visible symbols)
# ---------------------------------------------------------------------------

_CONFLUENCE_LABELS_AR: dict[str, str] = {
    "STRONG": "توافق قوي 3/3",
    "MEDIUM": "توافق متوسط 2/3",
    "WEAK":   "توافق ضعيف 1/3",
    "NONE":   "بدون توافق 0/3",
}


def _candidate_reason(approved: bool, direction: str | None, confluence_level: str | None) -> str:
    label = _CONFLUENCE_LABELS_AR.get((confluence_level or "").upper(), "بدون توافق")
    if approved and direction:
        return f"إشارة {direction} معتمدة — {label}"
    return f"غير معتمد حالياً — {label}"


@app.get("/api/lab/ranked-candidates")
def api_lab_ranked_candidates(source: str | None = Query(default=None)) -> JSONResponse:
    """
    قائمة ترشيح مرتبة حسب الأفضلية (قوة الإشارة) لكل الرموز التي يفحصها
    المسح الخلفي (رموز MT5 المرئية + رموز OKX). تعتمد على آخر صف محفوظ في
    triple_firewall_signals لكل رمز -- لا تُجري تحليلاً جديداً ولا ترسل
    تنبيهات. قراءة فقط.

    source : "mt5" -> رموز MT5 المرئية فقط (طرفية الذهب)،
             "okx"  -> رموز OKX فقط (طرفية الكريبتو)،
             بدون قيمة -> القائمة المدمجة (السلوك السابق).
    """
    universe: list[tuple[str, str]] = []

    if source == "okx":
        universe = [(s, "okx") for s in _OKX_SCAN_SYMBOLS]
    else:
        mt5_symbols: list[str] = []
        init_ok, _ = _safe_mt5_init()
        if init_ok:
            try:
                mt5_symbols = _get_visible_mt5_symbols() or _symbols_from_env()
            finally:
                mt5.shutdown()
        else:
            mt5_symbols = _symbols_from_env()

        universe = [(s, "mt5") for s in mt5_symbols]
        if source != "mt5":
            universe += [(s, "okx") for s in _OKX_SCAN_SYMBOLS]

    db = SessionLocal()
    try:
        candidates: list[dict[str, Any]] = []
        for symbol, source in universe:
            row = (
                db.query(TripleFirewallSignal)
                .filter(TripleFirewallSignal.symbol == symbol)
                .order_by(TripleFirewallSignal.timestamp.desc())
                .first()
            )
            if row is None:
                candidates.append({
                    "symbol": symbol,
                    "source": source,
                    "approved": False,
                    "direction": None,
                    "signal_strength": 0.0,
                    "confluence_level": None,
                    "reason": "بانتظار أول دورة فحص",
                    "last_scan_ts": None,
                })
                continue

            candidates.append({
                "symbol": symbol,
                "source": source,
                "approved": bool(row.approved),
                "direction": row.direction,
                "signal_strength": round(row.signal_strength, 4),
                "confluence_level": row.confluence_level,
                "reason": _candidate_reason(bool(row.approved), row.direction, row.confluence_level),
                "last_scan_ts": row.timestamp.isoformat() if row.timestamp else None,
            })
    finally:
        db.close()

    candidates.sort(key=lambda c: (c["approved"], c["signal_strength"]), reverse=True)

    return Utf8JsonResponse(content={
        "ok":         True,
        "read_only":  True,
        "candidates": candidates,
        "ts":         datetime.now(timezone.utc).isoformat(),
    })


_WATCHLIST_CONFIG_KEY = "lab_watchlist_symbols"
_WATCHLIST_MAX_SYMBOLS = 5


def _get_watchlist_symbols() -> list[str]:
    db = SessionLocal()
    try:
        row = db.query(SystemConfig).filter(SystemConfig.key == _WATCHLIST_CONFIG_KEY).first()
        if not row or not row.value:
            return []
        try:
            data = json.loads(row.value)
        except (TypeError, ValueError):
            return []
        return [s for s in data if isinstance(s, str)] if isinstance(data, list) else []
    finally:
        db.close()


@app.get("/api/lab/watchlist")
def api_lab_get_watchlist() -> JSONResponse:
    """قائمة المتابعة الحالية (حد أقصى 5 رموز) -- قراءة فقط."""
    return Utf8JsonResponse(content={"ok": True, "symbols": _get_watchlist_symbols()})


class WatchlistRequest(BaseModel):
    symbols: list[str]


@app.post("/api/lab/watchlist")
def api_lab_set_watchlist(body: WatchlistRequest) -> JSONResponse:
    """
    تحديث قائمة المتابعة (حد أقصى 5 رموز/أزواج). يجب أن يكون كل رمز ضمن
    مجموعة الترشيح الحالية (رموز MT5 المرئية + رموز OKX المسموحة).
    لا تنفيذ تداول -- مجرد تخزين تفضيل المستخدم لتوجيه المسح الخلفي.
    """
    requested = []
    for s in body.symbols:
        sym = s.strip().upper()
        if sym and sym not in requested:
            requested.append(sym)

    if len(requested) > _WATCHLIST_MAX_SYMBOLS:
        return Utf8JsonResponse(
            status_code=400,
            content={"ok": False, "error": f"الحد الأقصى {_WATCHLIST_MAX_SYMBOLS} عملات/أزواج"},
        )

    mt5_symbols: list[str] = []
    init_ok, _ = _safe_mt5_init()
    if init_ok:
        try:
            mt5_symbols = _get_visible_mt5_symbols() or _symbols_from_env()
        finally:
            mt5.shutdown()
    else:
        mt5_symbols = _symbols_from_env()

    allowed = {s.upper() for s in mt5_symbols} | set(_OKX_SCAN_SYMBOLS)
    invalid = [s for s in requested if s not in allowed]
    if invalid:
        return Utf8JsonResponse(
            status_code=400,
            content={"ok": False, "error": f"رموز غير مسموحة: {', '.join(invalid)}", "allowed_symbols": sorted(allowed)},
        )

    db = SessionLocal()
    try:
        row = db.query(SystemConfig).filter(SystemConfig.key == _WATCHLIST_CONFIG_KEY).first()
        value = json.dumps(requested, ensure_ascii=False)
        if row:
            row.value = value
        else:
            db.add(SystemConfig(key=_WATCHLIST_CONFIG_KEY, value=value))
        db.commit()
    finally:
        db.close()

    return Utf8JsonResponse(content={"ok": True, "symbols": requested})


async def run_watchlist_multi_timeframe_scan() -> None:
    """
    حلقة خلفية إضافية: تحلل رموز قائمة المتابعة (حد أقصى 5) عبر عدة فريمات
    عند إغلاق كل شمعة، بشكل منفصل عن المسح الخلفي الأساسي (H1 لكل الرموز).

    إشارة معتمدة على أي فريم تُحفظ وتُرسل تيليجرام تلقائياً عبر المسار
    الحالي (analyze_market -> _send_telegram_alert).
    """
    mt5_periods = {"M5": 300, "M15": 900, "H1": 3600, "H4": 14400, "D1": 86400}
    okx_periods = {"5m": 300, "15m": 900, "1H": 3600, "4H": 14400, "1D": 86400}

    logger.info("watchlist_scan: loop started")

    while True:
        await asyncio.sleep(60)

        symbols = _get_watchlist_symbols()
        if not symbols:
            continue

        now = time.time()
        engine = CouncilEngine()

        mt5_symbols = [s for s in symbols if "-" not in s]
        okx_symbols = [s for s in symbols if "-" in s]

        for tf, period in mt5_periods.items():
            if mt5_symbols and (now % period) < 60:
                for sym in mt5_symbols:
                    try:
                        await asyncio.to_thread(_sync_scan_cycle, engine, [sym], tf, _AGENT_SCAN_CANDLE_COUNT)
                    except Exception as exc:
                        logger.warning("watchlist_scan: mt5 %s/%s failed -- %s", sym, tf, exc)

        for bar, period in okx_periods.items():
            if okx_symbols and (now % period) < 60:
                account_balance = await asyncio.to_thread(_get_okx_account_balance)
                for sym in okx_symbols:
                    try:
                        await asyncio.to_thread(
                            _sync_scan_okx_cycle, engine, [sym], bar, _AGENT_SCAN_CANDLE_COUNT, account_balance,
                        )
                    except Exception as exc:
                        logger.warning("watchlist_scan: okx %s/%s failed -- %s", sym, bar, exc)


# ---------------------------------------------------------------------------
# WebSocket: live market stream (Phase 2 -- framework ready, stream TBD)
# ---------------------------------------------------------------------------

@app.websocket("/ws/live-market")
async def ws_live_market(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for live market data streaming.

    Protocol (current -- ping/pong handshake):
        server -> client : {"type": "connected", "version": <build>}
        client -> server : {"type": "ping"}
        server -> client : {"type": "pong", "ts": <utc_iso>}
        client -> server : {"type": "subscribe", "symbols": ["XAUUSD"]}
        server -> client : {"type": "ack", "subscribed": ["XAUUSD"]}

    Live tick streaming is implemented in Phase 2 once MT5 polling
    is wired to the broadcast loop.  The connection stays open and
    the server responds to all messages until the client disconnects.

    No trading operations are performed here.
    """
    await websocket.accept()
    _ws_clients.add(websocket)

    await websocket.send_json({
        "type":        "connected",
        "version":     _BUILD_VERSION,
        "read_only":   True,
        "ts":          datetime.now(timezone.utc).isoformat(),
    })

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "")

            if msg_type == "ping":
                await websocket.send_json({
                    "type": "pong",
                    "ts":   datetime.now(timezone.utc).isoformat(),
                })

            elif msg_type == "subscribe":
                symbols = data.get("symbols", [])
                await websocket.send_json({
                    "type":       "ack",
                    "subscribed": symbols,
                    "note":       "agent council active -- signals broadcast on approval",
                })
                
                # Trigger an immediate on-demand scan
                async def _scan_and_send(syms: list[str], ws: WebSocket) -> None:
                    try:
                        eng = CouncilEngine()
                        for s in syms:
                            if "-" in s:
                                res = await asyncio.to_thread(_sync_scan_okx_cycle, eng, [s], _OKX_SCAN_BAR, _AGENT_SCAN_CANDLE_COUNT)
                            else:
                                res = await asyncio.to_thread(_sync_scan_cycle, eng, [s], _AGENT_SCAN_TIMEFRAME, _AGENT_SCAN_CANDLE_COUNT)
                            
                            for verdict in res:
                                ds = "okx" if "-" in verdict.symbol else "mt5"
                                try:
                                    await ws.send_json({
                                        "type":            "agent_signal",
                                        "symbol":          verdict.symbol,
                                        "direction":       verdict.direction,
                                        "signal_strength": round(verdict.signal_strength, 4),
                                        "entry":           verdict.entry,
                                        "sl":              verdict.sl,
                                        "tp":              verdict.tp,
                                        "atr":             round(verdict.atr, 5) if verdict.atr else None,
                                        "risk_amount":     verdict.risk_amount,
                                        "profit_amount":   verdict.profit_amount,
                                        "lot_size":        verdict.lot_size,
                                        "duration":        verdict.duration,
                                        "votes": [
                                            {
                                                "agent":      v.agent,
                                                "approved":   v.approved,
                                                "confidence": round(v.confidence, 4),
                                                "reason":     v.reason,
                                            }
                                            for v in verdict.votes
                                        ],
                                        "ts":          verdict.timestamp.isoformat(),
                                        "read_only":   True,
                                        "data_source": ds,
                                    })
                                except Exception:
                                    pass
                    except Exception as e:
                        logger.warning(f"on-demand scan failed: {e}")
                
                asyncio.create_task(_scan_and_send(symbols, websocket))

            else:
                await websocket.send_json({
                    "type":  "error",
                    "error": f"unknown message type: {msg_type!r}",
                })

    except WebSocketDisconnect:
        pass  # clean client disconnect -- no action needed
    finally:
        _ws_clients.discard(websocket)


# ---------------------------------------------------------------------------
# Read-only endpoints reminder + demo endpoint authorisation note:
# - FORBIDDEN_MT5_FUNCTION_NAMES applies to ALL endpoints ABOVE /demo/order-send.
# - order_send is ONLY used inside /demo/order-send, gated by MT5_DEMO_EXECUTION_ENABLED.
# - READ_ONLY_MODE remains True and governs all /readonly/* endpoints.

@app.get("/api/okx/scanner")
def api_okx_scanner():
    """
    Fetch all OKX SPOT instruments and filter them.
    """
    import okx_bridge
    instruments = okx_bridge.fetch_okx_spot_instruments()
    
    total = len(instruments)
    approved = []
    rejected = []
    
    # Stablecoins to exclude from base
    STABLECOINS = {"USDT", "USDC", "DAI", "BUSD", "TUSD", "USDP", "EURT", "FDUSD"}
    
    # Leveraged or meme/junk tokens keywords (basic filter)
    LEVERAGED_KEYWORDS = {"UP", "DOWN", "BULL", "BEAR", "3L", "3S", "5L", "5S"}

    for inst in instruments:
        inst_id = inst.get("instId", "")
        base = inst.get("baseCcy", "").upper()
        quote = inst.get("quoteCcy", "").upper()
        state = inst.get("state", "")
        
        # Default object
        coin = {
            "symbol": inst_id,
            "base": base,
            "quote": quote,
            "status": "rejected",
            "reason": ""
        }
        
        if state != "live":
            coin["reason"] = "العملة غير نشطة حالياً (Not Live)"
            rejected.append(coin)
            continue
            
        if quote != "USDT":
            coin["reason"] = f"يجب أن يكون التسعير بـ USDT وليس {quote}"
            rejected.append(coin)
            continue
            
        if base in STABLECOINS:
            coin["reason"] = "عملة مستقرة مستبعدة"
            rejected.append(coin)
            continue
            
        is_leveraged = any(kw in inst_id.upper() for kw in LEVERAGED_KEYWORDS)
        if is_leveraged:
            coin["reason"] = "عملة ذات رافعة مالية مدمجة/مخاطرة عالية"
            rejected.append(coin)
            continue
            
        coin["status"] = "approved"
        coin["reason"] = "سيولة مقبولة ونشطة للتداول"
        approved.append(coin)
        
    return Utf8JsonResponse(content={
        "total": total,
        "approved_count": len(approved),
        "rejected_count": len(rejected),
        "coins": approved + rejected
    })

@app.get("/api/mt5-readonly/scan")
def api_mt5_scan():
    """
    Returns MT5 symbols categorized as approved/rejected for the scanner UI.
    """
    ok, _ = _safe_mt5_init()
    if not ok:
        return Utf8JsonResponse(
            status_code=503,
            content={"ok": False, "error": "MT5 is not available"}
        )
        
    symbols = _get_visible_mt5_symbols(limit=300)
    
    coins = []
    approved_count = 0
    rejected_count = 0
    
    for sym in symbols:
        sym_upper = sym.upper()
        
        # Simple criteria: accept 6-char forex pairs and common metals
        is_forex = len(sym_upper) == 6 and sym_upper.isalpha()
        is_metal = sym_upper in ["XAUUSD", "XAGUSD", "XAUEUR", "XAGEUR"]
        is_crypto = sym_upper in ["BTCUSD", "ETHUSD"]
        
        # Determine base/quote roughly for 6-char pairs
        base = sym[:3] if len(sym) >= 6 else sym
        quote = sym[3:6] if len(sym) >= 6 else "USD"
        
        if is_forex or is_metal or is_crypto:
            status = "approved"
            reason = "مقبول: زوج عملات/معادن سيولة عالية"
            approved_count += 1
        else:
            status = "rejected"
            reason = "مرفوض: رمز غير قياسي أو خارج تركيز التداول الرئيسي"
            rejected_count += 1
            
        coins.append({
            "symbol": sym,
            "base": base,
            "quote": quote,
            "status": status,
            "reason": reason
        })
        
    return Utf8JsonResponse(content={
        "total": len(symbols),
        "approved_count": approved_count,
        "rejected_count": rejected_count,
        "coins": coins
    })
