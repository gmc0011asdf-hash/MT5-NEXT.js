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

import json
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel


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


def _parse_csv_param(raw: str | None) -> list[str]:
    if raw is None:
        return []
    return [p.strip().upper() for p in raw.split(",") if p.strip()]


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
# FastAPI application
# -----------------------------------------------------------------------------

app = FastAPI(
    title="MT5 Read-only Local Connector",
    description="Read-only REST facade beside MetaTrader 5 terminal (Windows). No trading endpoints.",
    version=_BUILD_VERSION,
)


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
        symbols = _symbols_from_env()
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
        symbols_list = _parse_csv_param(symbols) or _symbols_from_env()
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


# Read-only endpoints reminder + demo endpoint authorisation note:
# - FORBIDDEN_MT5_FUNCTION_NAMES applies to ALL endpoints ABOVE /demo/order-send.
# - order_send is ONLY used inside /demo/order-send, gated by MT5_DEMO_EXECUTION_ENABLED.
# - READ_ONLY_MODE remains True and governs all /readonly/* endpoints.
