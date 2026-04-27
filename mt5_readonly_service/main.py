"""
Local MT5 Read-only Connector — FastAPI service.

================================================================================
READ-ONLY CONTRACT — يُمنع أي تنفيذ أو أوامر من هذه الخدمة:
- لا توجد نقاط نهاية للبيع أو الشراء أو الإغلاق أو التعديل أو الأوامر المعلقة.
- يُسمح فقط بقراءة الحساب والتيكات والمراكز المفتوحة عبر واجهات MetaTrader5
  الموثقة للقراءة (initialize / account_info / symbol_info_tick / positions_get).
- لا يُستورد أو يُستدعى صراحةً أي من دوال التداول المحظورة أدناه.
================================================================================
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

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

# Import MetaTrader5 only for documented read paths.
# The underlying DLL exposes trading APIs; we deliberately never call them here.
import MetaTrader5 as mt5

_DEFAULT_SYMBOLS: tuple[str, ...] = ("EURUSD", "GBPUSD", "XAUUSD")


def _enforce_read_only_policy() -> None:
    """Fail fast if someone disables read-only mode by mistake."""
    if READ_ONLY_MODE is not True:
        raise RuntimeError("READ_ONLY_MODE must remain True for this service.")


def _symbols_from_env() -> list[str]:
    raw = os.environ.get("SYMBOLS", "").strip()
    if not raw:
        return list(_DEFAULT_SYMBOLS)
    parts = [s.strip().upper() for s in raw.split(",") if s.strip()]
    return parts or list(_DEFAULT_SYMBOLS)


def _iso_from_mt5_time(ts: int | float | None) -> str | None:
    if ts is None:
        return None
    try:
        sec = float(ts) / (1000.0 if ts > 10_000_000_000 else 1.0)
        return datetime.fromtimestamp(sec, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _safe_mt5_init() -> tuple[bool, str | None]:
    """Initialize terminal connection; no credentials stored or requested."""
    _enforce_read_only_policy()
    if not mt5.initialize():
        err = mt5.last_error()
        return False, f"MT5 initialize failed (terminal closed or not installed?): {err}"
    return True, None


def _account_payload() -> dict[str, Any]:
    info = mt5.account_info()
    if info is None:
        return {"connected": False, "error": "account_info returned None"}
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


def _ticks_payload(symbols: list[str]) -> dict[str, Any]:
    ticks_out: list[dict[str, Any]] = []
    for sym in symbols:
        if not mt5.symbol_select(sym, True):
            ticks_out.append(
                {
                    "symbol": sym,
                    "error": "symbol_select failed or unknown symbol",
                }
            )
            continue
        tick = mt5.symbol_info_tick(sym)
        info = mt5.symbol_info(sym)
        spread_pts = int(info.spread) if info is not None else None
        if tick is None:
            ticks_out.append({"symbol": sym, "error": "no tick"})
            continue
        bid_f = float(tick.bid)
        ask_f = float(tick.ask)
        ticks_out.append(
            {
                "symbol": sym,
                "bid": bid_f,
                "ask": ask_f,
                "spread": round(ask_f - bid_f, 10),
                "spread_points": spread_pts,
                "time": _iso_from_mt5_time(getattr(tick, "time_msc", None) or getattr(tick, "time", None)),
            }
        )
    return {"ticks": ticks_out}


def _positions_payload() -> dict[str, Any]:
    """Read-only open positions via positions_get only."""
    rows = mt5.positions_get()
    if rows is None:
        err = mt5.last_error()
        return {"positions": [], "error": f"positions_get failed: {err}"}
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


app = FastAPI(
    title="MT5 Read-only Local Connector",
    description="Read-only REST facade beside MetaTrader 5 terminal (Windows). No trading endpoints.",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict[str, Any]:
    _enforce_read_only_policy()
    ok, err = _safe_mt5_init()
    try:
        return {
            "status": "ok",
            "read_only_mode": READ_ONLY_MODE,
            "mt5_connected": ok,
            "detail": None if ok else err,
        }
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
            content={"connected": False, "error": err or "MT5 unavailable"},
        )
    try:
        body = _account_payload()
        if not body.get("connected"):
            return JSONResponse(status_code=503, content=body)
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
            content={"connected": False, "error": err or "MT5 unavailable", "ticks": []},
        )
    try:
        symbols = _symbols_from_env()
        payload = _ticks_payload(symbols)
        payload["connected"] = True
        payload["symbols_configured"] = symbols
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
            content={"connected": False, "error": err or "MT5 unavailable", "positions": []},
        )
    try:
        payload = _positions_payload()
        payload["connected"] = True
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
                "error": err or "MT5 unavailable",
                "account": None,
                "ticks": [],
                "positions": [],
            },
        )
    try:
        symbols = _symbols_from_env()
        account = _account_payload()
        ticks_block = _ticks_payload(symbols)
        pos_block = _positions_payload()
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
            combined.setdefault("error", account.get("error", "account unavailable"))
        return JSONResponse(content=combined)
    finally:
        mt5.shutdown()


# Explicit reminder: never attach routers that expose {FORBIDDEN_MT5_FUNCTION_NAMES}.
