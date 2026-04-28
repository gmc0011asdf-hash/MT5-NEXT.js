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
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, Query
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
                "error": err or "MT5 unavailable",
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
                "error": err or "MT5 unavailable",
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
                    "fee": float(getattr(d, "fee", 0.0))
                    if hasattr(d, "fee")
                    else None,
                    "time": time_ms if time_ms is not None else 0,
                    "time_iso": _iso_from_mt5_time(ts) if ts is not None else None,
                    "comment": getattr(d, "comment", "") or "",
                    "magic": int(getattr(d, "magic", 0) or 0),
                }
            )

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


# Explicit reminder: never attach routers that expose {FORBIDDEN_MT5_FUNCTION_NAMES}.
