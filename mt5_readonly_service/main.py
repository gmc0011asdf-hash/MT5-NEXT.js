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

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# -----------------------------------------------------------------------------
# Safety switches — never flip READ_ONLY_MODE without a separate security review.
# -----------------------------------------------------------------------------
READ_ONLY_MODE: bool = True

# Names we must never invoke via MetaTrader5 (documentation + lint anchor).
FORBIDDEN_MT5_FUNCTION_NAMES: tuple[str, ...] = (
    "order_send",
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
        return JSONResponse(
            status_code=400,
            content={"connected": False, "error": "رقم الحساب غير صالح — يجب أن يكون رقماً موجباً"},
        )
    if not server:
        return JSONResponse(
            status_code=400,
            content={"connected": False, "error": "اسم السيرفر مطلوب"},
        )
    if not password:
        return JSONResponse(
            status_code=400,
            content={"connected": False, "error": "كلمة المرور مطلوبة"},
        )

    # Terminal path validation — checks directory vs file vs missing
    path_error = _validate_terminal_path(terminal_path)
    if path_error:
        return JSONResponse(
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
        return JSONResponse(
            status_code=503,
            content={
                "connected": False,
                "error": f"فشل الاتصال بـ MT5: {err} — تحقق من بيانات الدخول والسيرفر",
            },
        )
    try:
        info = mt5.account_info()
        if info is None:
            return JSONResponse(
                status_code=503,
                content={
                    "connected": False,
                    "error": "تم فتح MT5 لكن تعذّر جلب بيانات الحساب — تحقق من رقم الحساب",
                },
            )
        _record_successful_mt5_call()
        return JSONResponse(
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
    return JSONResponse(content=body, status_code=200 if body.get("connected") else 503)


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
        return JSONResponse(
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
        return JSONResponse(
            status_code=503,
            content={"connected": False, "error": err or "MT5 غير متاح"},
        )
    try:
        body = _account_payload()
        if not body.get("connected"):
            return JSONResponse(status_code=503, content=body)
        _record_successful_mt5_call()
        return JSONResponse(content=body)
    finally:
        mt5.shutdown()


@app.get("/readonly/ticks")
def readonly_ticks() -> JSONResponse:
    _enforce_read_only_policy()
    ok, err = _safe_mt5_init()
    if not ok:
        return JSONResponse(
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
        return JSONResponse(content=payload)
    finally:
        mt5.shutdown()


@app.get("/readonly/positions")
def readonly_positions() -> JSONResponse:
    _enforce_read_only_policy()
    ok, err = _safe_mt5_init()
    if not ok:
        return JSONResponse(
            status_code=503,
            content={"connected": False, "error": err or "MT5 غير متاح", "positions": []},
        )
    try:
        payload = _positions_payload()
        payload["connected"] = True
        _record_successful_mt5_call()
        return JSONResponse(content=payload)
    finally:
        mt5.shutdown()


@app.get("/readonly/snapshot")
def readonly_snapshot() -> JSONResponse:
    _enforce_read_only_policy()
    ok, err = _safe_mt5_init()
    if not ok:
        return JSONResponse(
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
        return JSONResponse(content=combined)
    finally:
        mt5.shutdown()


def _serialize_symbol_meta(si: Any) -> dict[str, Any]:
    """Read-only SymbolInfo subset — no trading."""
    return {
        "name": getattr(si, "name", "") or "",
        "path": getattr(si, "path", "") or "",
        "description": getattr(si, "description", "") or "",
        "currency_base": getattr(si, "currency_base", "") or "",
        "currency_profit": getattr(si, "currency_profit", "") or "",
        "currency_margin": getattr(si, "currency_margin", "") or "",
        "digits": int(getattr(si, "digits", 0) or 0),
        "visible": bool(getattr(si, "visible", False)),
        "trade_mode": int(getattr(si, "trade_mode", 0) or 0),
        "point": float(getattr(si, "point", 0.0) or 0.0),
        "spread": int(getattr(si, "spread", 0) or 0),
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
        return JSONResponse(
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
        return JSONResponse(
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
        return JSONResponse(
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
        return JSONResponse(
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
        return JSONResponse(
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
            return JSONResponse(
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
                    ts = int(rate["time"])
                    candles.append(
                        {
                            "symbol": sym,
                            "timeframe": tf,
                            "time": ts * 1000,
                            "time_iso": _iso_from_mt5_time(ts),
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
            "candles": candles,
        }
        if skipped_symbols:
            response["skipped_symbols"] = skipped_symbols
            response["skipped_note"] = (
                "بعض الرموز أو الإطارات الزمنية تعذّر جلبها — تحقق من Market Watch"
            )
        if invalid_timeframes:
            response["invalid_timeframes"] = invalid_timeframes

        return JSONResponse(content=response)
    finally:
        mt5.shutdown()


# Explicit reminder: never attach routers that expose {FORBIDDEN_MT5_FUNCTION_NAMES}.
