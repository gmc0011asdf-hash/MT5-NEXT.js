"""
mt5_trade_sync.py -- Periodic local sync of MT5 closed trades + open
positions, linked to TripleFirewallSignal for recommendation-accuracy
analysis.

Read-only contract: this module calls only history_deals_get(),
positions_get(), and account-info-free read paths via mt5.initialize()/
mt5.shutdown(). It NEVER calls order_send, order_close, order_modify,
order_check, or OrderSend. It does not modify strategy parameters, risk
settings, or signal approval thresholds.

Two persisted tables (see database.py):
    - mt5_trade_history  : one row per fully-closed position (grouped by
                            position_id), upserted on partial closes.
    - mt5_open_positions : current snapshot of open positions, upserted/
                            deleted by ticket every cycle.

Each newly-inserted row is matched (once) against TripleFirewallSignal:
same symbol, same direction, approved=1, signal timestamp within 24 hours
before the trade's open_time (closest signal wins).
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from database import MT5OpenPosition, MT5TradeHistory, SessionLocal, TripleFirewallSignal

logger = logging.getLogger(__name__)

# Import MetaTrader5 only for documented read paths (history_deals_get,
# positions_get, initialize/shutdown). We deliberately never call the
# trading APIs the underlying DLL also exposes.
import MetaTrader5 as mt5

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_HISTORY_DAYS: int = int(os.environ.get("MT5_TRADE_SYNC_HISTORY_DAYS", "365"))
_SYNC_INTERVAL_SECONDS: int = int(os.environ.get("MT5_TRADE_SYNC_INTERVAL_SECONDS", "60"))
_MATCH_WINDOW: timedelta = timedelta(hours=24)

# mt5.history_deals_get(date_from, date_to) interprets date_from/date_to in
# the broker's server timezone (same convention as copy_rates_from_pos --
# see main.py's _BROKER_TIME_OFFSET_HOURS). Without a buffer, a trade closed
# moments ago (broker server time) can fall just after `now_utc` (true UTC)
# and be silently excluded from the pulled range -- the most recently closed
# trade then never appears in mt5_trade_history. Extend date_to by the same
# offset so the freshest deals are always included.
_BROKER_TIME_OFFSET_HOURS: int = int(os.environ.get("MT5_BROKER_TIME_OFFSET_HOURS", "3"))

# MT5 deal/position type constants -- read from the mt5 module with safe
# fallbacks to their documented numeric values, in case a stub/older
# build of the package does not export them.
_DEAL_ENTRY_IN: int = getattr(mt5, "DEAL_ENTRY_IN", 0)
_DEAL_ENTRY_OUT: int = getattr(mt5, "DEAL_ENTRY_OUT", 1)
_DEAL_ENTRY_OUT_BY: int = getattr(mt5, "DEAL_ENTRY_OUT_BY", 3)
_DEAL_TYPE_BUY: int = getattr(mt5, "DEAL_TYPE_BUY", 0)
_POSITION_TYPE_BUY: int = getattr(mt5, "POSITION_TYPE_BUY", 0)


# ---------------------------------------------------------------------------
# Read-only safety helpers (independent from main.py to avoid circular
# imports -- mirrors main.py's _enforce_read_only_policy / _safe_mt5_init)
# ---------------------------------------------------------------------------

READ_ONLY_MODE: bool = True


def _enforce_read_only_policy() -> None:
    if READ_ONLY_MODE is not True:
        raise RuntimeError("READ_ONLY_MODE must remain True for mt5_trade_sync.")


def _safe_mt5_init() -> tuple[bool, str | None]:
    _enforce_read_only_policy()
    if not mt5.initialize():
        err = mt5.last_error()
        return False, f"mt5.initialize() failed: {err}"
    return True, None


def _mt5_time_to_datetime(ts: Any) -> datetime | None:
    """Convert an MT5 deal/position `time` field (epoch seconds) to an
    aware UTC datetime. Mirrors main.py's _iso_from_mt5_time convention
    (no broker-offset adjustment -- deals/positions report true UTC epoch,
    unlike copy_rates_from_pos candle timestamps)."""
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc)
    except (OverflowError, OSError, ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Deal grouping (closed trades)
# ---------------------------------------------------------------------------

def _group_deals_by_position(deals: list[Any]) -> dict[int, list[Any]]:
    groups: dict[int, list[Any]] = {}
    for d in deals:
        position_id = int(getattr(d, "position_id", 0) or 0)
        if position_id == 0:
            continue
        groups.setdefault(position_id, []).append(d)
    return groups


def _build_trade_from_group(position_id: int, deals: list[Any]) -> dict[str, Any] | None:
    """Build a trade-history dict from one position_id's deals.
    Returns None if the position has no IN deal or no OUT/OUT_BY deal yet
    (i.e. it is still fully open -- handled by mt5_open_positions instead)."""
    in_deals = [d for d in deals if int(getattr(d, "entry", -1)) == _DEAL_ENTRY_IN]
    out_deals = [d for d in deals if int(getattr(d, "entry", -1)) in (_DEAL_ENTRY_OUT, _DEAL_ENTRY_OUT_BY)]
    if not in_deals or not out_deals:
        return None

    in_deals_sorted = sorted(in_deals, key=lambda d: getattr(d, "time", 0))
    out_deals_sorted = sorted(out_deals, key=lambda d: getattr(d, "time", 0))

    open_deal = in_deals_sorted[0]
    close_deal = out_deals_sorted[-1]

    deal_type = int(getattr(open_deal, "type", 0))
    direction = "BUY" if deal_type == _DEAL_TYPE_BUY else "SELL"

    return {
        "position_id": position_id,
        "symbol": getattr(open_deal, "symbol", "") or "",
        "direction": direction,
        "volume": float(getattr(open_deal, "volume", 0.0) or 0.0),
        "open_price": float(getattr(open_deal, "price", 0.0) or 0.0),
        "open_time": _mt5_time_to_datetime(getattr(open_deal, "time", None)),
        "open_deal_ticket": int(getattr(open_deal, "ticket", 0) or 0),
        "close_price": float(getattr(close_deal, "price", 0.0) or 0.0),
        "close_time": _mt5_time_to_datetime(getattr(close_deal, "time", None)),
        "close_deal_ticket": int(getattr(close_deal, "ticket", 0) or 0),
        "close_volume": sum(float(getattr(d, "volume", 0.0) or 0.0) for d in out_deals_sorted),
        "deals_count": len(deals),
        "profit": sum(float(getattr(d, "profit", 0.0) or 0.0) for d in out_deals_sorted),
        "commission": sum(float(getattr(d, "commission", 0.0) or 0.0) for d in deals),
        "swap": sum(float(getattr(d, "swap", 0.0) or 0.0) for d in deals),
        "comment": getattr(open_deal, "comment", "") or "",
        "magic": int(getattr(open_deal, "magic", 0) or 0),
    }


# ---------------------------------------------------------------------------
# Signal matching
# ---------------------------------------------------------------------------

def _find_matching_signal(
    db: Session, symbol: str, direction: str, open_time: datetime
) -> TripleFirewallSignal | None:
    window_start = open_time - _MATCH_WINDOW
    return (
        db.query(TripleFirewallSignal)
        .filter(
            TripleFirewallSignal.symbol == symbol,
            TripleFirewallSignal.direction == direction,
            TripleFirewallSignal.approved == 1,
            TripleFirewallSignal.timestamp <= open_time,
            TripleFirewallSignal.timestamp >= window_start,
        )
        .order_by(TripleFirewallSignal.timestamp.desc())
        .first()
    )


def _apply_match(db: Session, row: MT5TradeHistory | MT5OpenPosition, open_time: datetime | None) -> None:
    """Set matched_signal_id / matched_time_delta_seconds on a freshly
    inserted row, if a TripleFirewallSignal matches. No-op if open_time
    is unknown or no signal matches (row stays unmatched -- a manual trade).

    SQLite does not persist tzinfo, so TripleFirewallSignal.timestamp comes
    back naive after a round-trip through the database. open_time is freshly
    built (timezone-aware UTC) and has not been through that round-trip, so
    we normalize both to naive UTC before comparing/subtracting."""
    if open_time is None:
        return
    if open_time.tzinfo is not None:
        open_time = open_time.replace(tzinfo=None)
    signal = _find_matching_signal(db, row.symbol, row.direction, open_time)
    if signal is None:
        return
    row.matched_signal_id = signal.id
    signal_timestamp = signal.timestamp
    if signal_timestamp.tzinfo is not None:
        signal_timestamp = signal_timestamp.replace(tzinfo=None)
    delta = open_time - signal_timestamp
    row.matched_time_delta_seconds = int(delta.total_seconds())


# ---------------------------------------------------------------------------
# Upsert helpers
# ---------------------------------------------------------------------------

def _is_valid_trade(trade: dict[str, Any]) -> bool:
    """Guard against malformed/incomplete deal groups before insert.
    Returns False (and logs a warning) if open_time/close_time are
    missing, symbol is empty, or position_id is 0 -- such a row would
    violate the NOT NULL columns or indicate a still-open/garbage group."""
    if trade.get("open_time") is None:
        logger.warning("mt5_trade_sync: skipping position_id=%s -- open_time is None", trade.get("position_id"))
        return False
    if trade.get("close_time") is None:
        logger.warning("mt5_trade_sync: skipping position_id=%s -- close_time is None", trade.get("position_id"))
        return False
    if not trade.get("symbol"):
        logger.warning("mt5_trade_sync: skipping position_id=%s -- empty symbol", trade.get("position_id"))
        return False
    if not trade.get("position_id"):
        logger.warning("mt5_trade_sync: skipping trade -- position_id is 0/missing")
        return False
    return True


def _upsert_trade_history(db: Session, trade: dict[str, Any]) -> bool:
    """Insert or update one mt5_trade_history row. Returns True if a new
    row was inserted (caller uses this to count `closedInserted`).
    Caller (_sync_closed_trades) must call _is_valid_trade() first and
    skip invalid groups -- this function assumes a valid trade dict."""
    row = (
        db.query(MT5TradeHistory)
        .filter(MT5TradeHistory.position_id == trade["position_id"])
        .first()
    )
    now = datetime.now(timezone.utc)

    if row is None:
        row = MT5TradeHistory(
            position_id=trade["position_id"],
            symbol=trade["symbol"],
            direction=trade["direction"],
            volume=trade["volume"],
            open_price=trade["open_price"],
            open_time=trade["open_time"],
            open_deal_ticket=trade["open_deal_ticket"],
            close_price=trade["close_price"],
            close_time=trade["close_time"],
            close_deal_ticket=trade["close_deal_ticket"],
            close_volume=trade["close_volume"],
            deals_count=trade["deals_count"],
            profit=trade["profit"],
            commission=trade["commission"],
            swap=trade["swap"],
            comment=trade["comment"],
            magic=trade["magic"],
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        db.flush()
        _apply_match(db, row, trade["open_time"])
        db.commit()
        return True

    row.close_price = trade["close_price"]
    row.close_time = trade["close_time"]
    row.close_deal_ticket = trade["close_deal_ticket"]
    row.close_volume = trade["close_volume"]
    row.deals_count = trade["deals_count"]
    row.profit = trade["profit"]
    row.commission = trade["commission"]
    row.swap = trade["swap"]
    row.updated_at = now
    db.commit()
    return False


def _upsert_open_position(db: Session, p: Any) -> None:
    ticket = int(getattr(p, "ticket", 0) or 0)
    pos_type = int(getattr(p, "type", 0))
    direction = "BUY" if pos_type == _POSITION_TYPE_BUY else "SELL"
    open_time = _mt5_time_to_datetime(getattr(p, "time", None))
    now = datetime.now(timezone.utc)

    row = db.query(MT5OpenPosition).filter(MT5OpenPosition.ticket == ticket).first()
    if row is None:
        row = MT5OpenPosition(
            ticket=ticket,
            symbol=getattr(p, "symbol", "") or "",
            direction=direction,
            volume=float(getattr(p, "volume", 0.0) or 0.0),
            open_price=float(getattr(p, "price_open", 0.0) or 0.0),
            open_time=open_time,
            current_price=float(getattr(p, "price_current", 0.0) or 0.0),
            sl=float(getattr(p, "sl", 0.0) or 0.0),
            tp=float(getattr(p, "tp", 0.0) or 0.0),
            profit=float(getattr(p, "profit", 0.0) or 0.0),
            comment=getattr(p, "comment", "") or "",
            updated_at=now,
        )
        db.add(row)
        db.flush()
        _apply_match(db, row, open_time)
        db.commit()
        return

    row.current_price = float(getattr(p, "price_current", 0.0) or 0.0)
    row.profit = float(getattr(p, "profit", 0.0) or 0.0)
    row.sl = float(getattr(p, "sl", 0.0) or 0.0)
    row.tp = float(getattr(p, "tp", 0.0) or 0.0)
    row.updated_at = now
    db.commit()


# ---------------------------------------------------------------------------
# Sync passes
# ---------------------------------------------------------------------------

def _sync_closed_trades(db: Session) -> tuple[int, int]:
    """Returns (inserted_count, upserted_count)."""
    now_utc = datetime.now(timezone.utc)
    from_date = now_utc - timedelta(days=_HISTORY_DAYS)
    to_date = now_utc + timedelta(hours=_BROKER_TIME_OFFSET_HOURS)
    deals_raw = mt5.history_deals_get(from_date, to_date)
    deals = list(deals_raw) if deals_raw is not None else []

    inserted = 0
    upserted = 0
    for position_id, group_deals in _group_deals_by_position(deals).items():
        trade = _build_trade_from_group(position_id, group_deals)
        if trade is None:
            continue
        if not _is_valid_trade(trade):
            continue
        is_new = _upsert_trade_history(db, trade)
        upserted += 1
        if is_new:
            inserted += 1
    return inserted, upserted


def _sync_open_positions(db: Session) -> tuple[int, int]:
    """Returns (upserted_count, removed_count)."""
    rows = mt5.positions_get()
    positions = list(rows) if rows is not None else []

    seen_tickets: set[int] = set()
    upserted = 0
    for p in positions:
        ticket = int(getattr(p, "ticket", 0) or 0)
        if ticket == 0:
            continue
        seen_tickets.add(ticket)
        _upsert_open_position(db, p)
        upserted += 1

    removed = 0
    for row in db.query(MT5OpenPosition).all():
        if row.ticket not in seen_tickets:
            db.delete(row)
            removed += 1
    if removed:
        db.commit()

    return upserted, removed


def sync_mt5_trades_once(db: Session) -> dict[str, Any]:
    """One full synchronization pass: pulls closed deals + open positions
    from MT5, upserts mt5_trade_history / mt5_open_positions, and runs
    signal matching for newly-inserted rows.

    Read-only -- never calls order_send/order_close/order_modify/
    order_check/OrderSend. Used by both run_mt5_trade_sync() (60s loop)
    and POST /api/trade-history/sync-now (manual diagnostic trigger)."""
    _enforce_read_only_policy()
    ok, err = _safe_mt5_init()
    if not ok:
        logger.warning("mt5_trade_sync: MT5 init failed -- %s", err)
        return {
            "ok": False,
            "error": err,
            "closedInserted": 0, "closedUpserted": 0, "openUpserted": 0, "openRemoved": 0,
        }
    try:
        closed_inserted, closed_upserted = _sync_closed_trades(db)
        open_upserted, open_removed = _sync_open_positions(db)
        return {
            "ok": True,
            "closedInserted": closed_inserted,
            "closedUpserted": closed_upserted,
            "openUpserted": open_upserted,
            "openRemoved": open_removed,
        }
    finally:
        mt5.shutdown()


# ---------------------------------------------------------------------------
# Background loop
# ---------------------------------------------------------------------------

async def run_mt5_trade_sync() -> None:
    """Background task: syncs MT5 closed trades + open positions every
    MT5_TRADE_SYNC_INTERVAL_SECONDS (default 60s). Runs forever; never
    raises out of the loop. Read-only -- see module docstring."""
    while True:
        db = SessionLocal()
        try:
            await asyncio.to_thread(sync_mt5_trades_once, db)
        except Exception as exc:
            logger.warning("mt5_trade_sync: cycle failed -- %s", exc)
        finally:
            db.close()
        await asyncio.sleep(_SYNC_INTERVAL_SECONDS)
