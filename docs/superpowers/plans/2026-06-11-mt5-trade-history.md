# سجل الصفقات وربطها بإشارات النظام — خطة التنفيذ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** سحب الصفقات المغلقة والمفتوحة من MT5، تخزينها محلياً في `local_quant.db`، ربطها تلقائياً بإشارات `TripleFirewallSignal` (رمز + اتجاه + نافذة 24 ساعة)، وعرضها في صفحة `/trade-history`.

**Architecture:** مهمة خلفية دورية (60 ثانية) في `mt5_readonly_service/mt5_trade_sync.py` تسحب `history_deals_get`/`positions_get`، تجمّع الـ deals حسب `position_id`، تطابقها مع `TripleFirewallSignal`، وتخزنها في جدولين جديدين (`mt5_trade_history`, `mt5_open_positions`) عبر SQLAlchemy. أربعة endpoints جديدة في `main.py` (إضافية فقط) تعرض البيانات لصفحة Next.js جديدة عبر proxy routes.

**Tech Stack:** FastAPI, SQLAlchemy/SQLite (`mt5_readonly_service`), MetaTrader5 Python package، Next.js App Router + Clerk auth (proxy routes)، React/TypeScript (صفحة `/trade-history`).

**المرجع:** `docs/superpowers/specs/2026-06-11-mt5-trade-history-design.md`

**القيود الصارمة (تنطبق على كل المهام):**
- ❌ لا Convex، لا تعديل `convex/schema.ts`، لا أي جدول Convex جديد.
- ❌ لا `order_send`/`order_close`/`order_modify`/`order_check`/`OrderSend` في أي ملف جديد أو معدَّل.
- ❌ لا تعديل دوال/مسارات Stage 5A المحمية الموجودة — كل تعديل في `main.py` إضافي فقط.
- ✅ نسخة احتياطية إلزامية قبل أي تعديل (Task 1).

---

### Task 1: نسخة احتياطية من قاعدة البيانات

**Files:**
- Read: `mt5_readonly_service/local_quant.db`
- Create: `mt5_readonly_service/local_quant_backup_before_trade_history.db`

- [ ] **Step 1: نسخ ملف قاعدة البيانات**

```bash
cp "mt5_readonly_service/local_quant.db" "mt5_readonly_service/local_quant_backup_before_trade_history.db"
```

(على PowerShell: `Copy-Item "mt5_readonly_service/local_quant.db" "mt5_readonly_service/local_quant_backup_before_trade_history.db"`)

- [ ] **Step 2: التحقق من وجود الملف الجديد**

```bash
ls -la mt5_readonly_service/local_quant_backup_before_trade_history.db
```

Expected: الملف موجود وحجمه يطابق `local_quant.db` الأصلي.

- [ ] **Step 3: عدم إضافة النسخة الاحتياطية إلى Git**

النسخة الاحتياطية تبقى محلية فقط ولا تدخل Git:

```bash
git status --short mt5_readonly_service/local_quant_backup_before_trade_history.db
```

Expected: السطر يظهر بعلامة `??` (untracked) — **لا تنفّذ `git add` ولا `git commit` لهذا الملف** في أي خطوة لاحقة من هذه الخطة.

---

### Task 2: إضافة جدولي `MT5TradeHistory` و `MT5OpenPosition` إلى `database.py`

**Files:**
- Modify: `mt5_readonly_service/database.py` (إضافة كلاسين جديدين بعد `class TripleFirewallSignal` الذي ينتهي عند السطر 319، قبل `class TelegramSubscriber` في السطر 322)

- [ ] **Step 1: إضافة الكلاسين الجديدين**

أدخل الكود التالي في `mt5_readonly_service/database.py` بعد نهاية `class TripleFirewallSignal` (بعد السطر 319، قبل السطر الفارغ الذي يسبق `class TelegramSubscriber`):

```python
class MT5TradeHistory(Base):
    """
    One row per fully-closed MT5 position (deals from history_deals_get
    grouped by position_id). Built and upserted by
    mt5_trade_sync.sync_mt5_trades_once().

    A row is inserted only once a position has at least one IN deal and
    at least one OUT/OUT_BY deal (i.e. it is fully or partially closed).
    Subsequent partial closes UPDATE close_price/close_time/close_volume/
    deals_count/profit/commission/swap on the same row -- open_time and
    matched_signal_id never change after first insert.

    Read-only contract: this table is populated purely from
    history_deals_get(); nothing here triggers order_send/order_close.
    """

    __tablename__ = "mt5_trade_history"

    id                          = Column(Integer, primary_key=True, autoincrement=True)
    position_id                 = Column(Integer, nullable=False, unique=True)
    symbol                      = Column(String(20), nullable=False)
    direction                   = Column(String(10), nullable=False)  # BUY | SELL
    volume                      = Column(Float, nullable=False)
    open_price                  = Column(Float, nullable=False)
    open_time                   = Column(DateTime(timezone=True), nullable=False)
    open_deal_ticket            = Column(Integer, nullable=False)
    close_price                 = Column(Float, nullable=False)
    close_time                  = Column(DateTime(timezone=True), nullable=False)
    close_deal_ticket           = Column(Integer, nullable=False)
    close_volume                = Column(Float, nullable=False, default=0.0)
    deals_count                 = Column(Integer, nullable=False, default=0)
    profit                      = Column(Float, nullable=False, default=0.0)
    commission                  = Column(Float, nullable=False, default=0.0)
    swap                        = Column(Float, nullable=False, default=0.0)
    comment                     = Column(String(255), nullable=True)
    magic                       = Column(Integer, nullable=True)
    matched_signal_id           = Column(Integer, nullable=True)
    matched_time_delta_seconds  = Column(Integer, nullable=True)
    created_at                  = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at                  = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (
        Index("ix_mth_position_id", "position_id", unique=True),
        Index("ix_mth_symbol_open_time", "symbol", "open_time"),
    )

    def to_dict(self) -> dict:
        return {
            "id":                      self.id,
            "positionId":              self.position_id,
            "symbol":                  self.symbol,
            "direction":               self.direction,
            "volume":                  self.volume,
            "openPrice":               self.open_price,
            "openTime":                self.open_time.isoformat() if self.open_time else None,
            "openDealTicket":          self.open_deal_ticket,
            "closePrice":              self.close_price,
            "closeTime":               self.close_time.isoformat() if self.close_time else None,
            "closeDealTicket":         self.close_deal_ticket,
            "closeVolume":             self.close_volume,
            "dealsCount":              self.deals_count,
            "profit":                  self.profit,
            "commission":              self.commission,
            "swap":                    self.swap,
            "comment":                 self.comment,
            "magic":                   self.magic,
            "matchedSignalId":         self.matched_signal_id,
            "matchedTimeDeltaSeconds": self.matched_time_delta_seconds,
            "createdAt":               self.created_at.isoformat() if self.created_at else None,
            "updatedAt":               self.updated_at.isoformat() if self.updated_at else None,
        }


class MT5OpenPosition(Base):
    """
    Current snapshot of open MT5 positions (positions_get()).
    Upserted by ticket every sync cycle; rows for tickets no longer open
    are deleted (the position has been closed and will appear in
    mt5_trade_history once history_deals_get reflects it).

    Read-only contract: this table is populated purely from
    positions_get(); nothing here triggers order_send/order_close/order_modify.
    """

    __tablename__ = "mt5_open_positions"

    id                          = Column(Integer, primary_key=True, autoincrement=True)
    ticket                      = Column(Integer, nullable=False, unique=True)
    symbol                      = Column(String(20), nullable=False)
    direction                   = Column(String(10), nullable=False)  # BUY | SELL
    volume                      = Column(Float, nullable=False)
    open_price                  = Column(Float, nullable=False)
    open_time                   = Column(DateTime(timezone=True), nullable=False)
    current_price               = Column(Float, nullable=False)
    sl                          = Column(Float, nullable=True)
    tp                          = Column(Float, nullable=True)
    profit                      = Column(Float, nullable=False, default=0.0)
    comment                     = Column(String(255), nullable=True)
    matched_signal_id           = Column(Integer, nullable=True)
    matched_time_delta_seconds  = Column(Integer, nullable=True)
    updated_at                  = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (
        Index("ix_mop_ticket", "ticket", unique=True),
        Index("ix_mop_symbol", "symbol"),
    )

    def to_dict(self) -> dict:
        return {
            "id":                      self.id,
            "ticket":                  self.ticket,
            "symbol":                  self.symbol,
            "direction":               self.direction,
            "volume":                  self.volume,
            "openPrice":               self.open_price,
            "openTime":                self.open_time.isoformat() if self.open_time else None,
            "currentPrice":            self.current_price,
            "sl":                      self.sl,
            "tp":                      self.tp,
            "profit":                  self.profit,
            "comment":                 self.comment,
            "matchedSignalId":         self.matched_signal_id,
            "matchedTimeDeltaSeconds": self.matched_time_delta_seconds,
            "updatedAt":               self.updated_at.isoformat() if self.updated_at else None,
        }
```

Both tables are brand new (no existing rows to migrate), so `Base.metadata.create_all(bind=engine)` inside the existing `init_db()` (database.py:462-469) will create them automatically — **no change needed to `init_db()` or `_ensure_telegram_subscriber_columns()`**.

- [ ] **Step 2: التحقق من صحة بناء الجملة Python**

```bash
python -m py_compile mt5_readonly_service/database.py
```

Expected: لا أي إخراج (نجاح صامت).

- [ ] **Step 3: التحقق من إنشاء الجدولين فعلياً**

شغّل من داخل `mt5_readonly_service/`:

```bash
python -c "from database import init_db, engine; from sqlalchemy import inspect; init_db(); print(sorted(inspect(engine).get_table_names()))"
```

Expected: القائمة المطبوعة تحتوي `mt5_trade_history` و `mt5_open_positions` بالإضافة للجداول الموجودة.

- [ ] **Step 4: Commit**

```bash
git add mt5_readonly_service/database.py
git commit -m "feat(trade-history): add MT5TradeHistory and MT5OpenPosition tables"
```

---

### Task 3: إنشاء `mt5_trade_sync.py` — السحب + التجميع + المطابقة + الحلقة الخلفية

**Files:**
- Create: `mt5_readonly_service/mt5_trade_sync.py`

- [ ] **Step 1: إنشاء الملف**

```python
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

_HISTORY_DAYS: int = int(os.environ.get("MT5_TRADE_SYNC_HISTORY_DAYS", "30"))
_SYNC_INTERVAL_SECONDS: int = int(os.environ.get("MT5_TRADE_SYNC_INTERVAL_SECONDS", "60"))
_MATCH_WINDOW: timedelta = timedelta(hours=24)

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
    deals_raw = mt5.history_deals_get(from_date, now_utc)
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


def sync_mt5_trades_once(db: Session) -> dict[str, int]:
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
        return {"closedInserted": 0, "closedUpserted": 0, "openUpserted": 0, "openRemoved": 0}
    try:
        closed_inserted, closed_upserted = _sync_closed_trades(db)
        open_upserted, open_removed = _sync_open_positions(db)
        return {
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
```

- [ ] **Step 2: التحقق من صحة بناء الجملة Python**

```bash
python -m py_compile mt5_readonly_service/mt5_trade_sync.py
```

Expected: لا أي إخراج (نجاح صامت).

- [ ] **Step 3: كتابة سكربت تحقق مؤقت (in-process) للتجميع والمطابقة**

أنشئ ملفاً مؤقتاً `mt5_readonly_service/_verify_trade_sync.py` (سيُحذف في الخطوة التالية بعد النجاح — لا يُلتزم به):

```python
"""Temporary in-process verification for grouping/matching logic.
Uses an in-memory SQLite database + fake MT5 deal/position objects
(no real MT5 connection needed). Delete after a successful run."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import database
import mt5_trade_sync as sync

# --- in-memory DB setup ----------------------------------------------------
engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestSession = sessionmaker(bind=engine)
database.Base.metadata.create_all(bind=engine)
db = TestSession()

NOW = datetime(2026, 6, 11, 12, 0, 0, tzinfo=timezone.utc)


def deal(**kw):
    defaults = dict(
        ticket=0, order=0, position_id=0, symbol="XAUUSD", type=0, entry=0,
        volume=0.0, price=0.0, profit=0.0, commission=0.0, swap=0.0,
        time=NOW.timestamp(), comment="", magic=0,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


# --- Test 1: full close in one go, with a matching approved signal --------
signal = database.TripleFirewallSignal(
    symbol="XAUUSD", direction="BUY", approved=1, signal_strength=0.8,
    confluence_level="STRONG", timestamp=NOW - timedelta(hours=2),
)
db.add(signal)
db.commit()

open_time = NOW
deals_1 = [
    deal(ticket=1, position_id=100, type=0, entry=sync._DEAL_ENTRY_IN,
         volume=0.1, price=2300.0, time=open_time.timestamp()),
    deal(ticket=2, position_id=100, type=1, entry=sync._DEAL_ENTRY_OUT,
         volume=0.1, price=2310.0, profit=10.0,
         time=(open_time + timedelta(hours=1)).timestamp()),
]
trade_1 = sync._build_trade_from_group(100, deals_1)
assert trade_1 is not None, "trade_1 should be a closed trade"
assert trade_1["direction"] == "BUY"
assert trade_1["deals_count"] == 2
assert trade_1["close_volume"] == 0.1
assert trade_1["profit"] == 10.0

is_new = sync._upsert_trade_history(db, trade_1)
assert is_new is True
row_1 = db.query(database.MT5TradeHistory).filter_by(position_id=100).first()
assert row_1.matched_signal_id == signal.id, "trade_1 should match the approved BUY signal"
print("Test 1 (full close + matched signal): PASS")

# --- Test 2: partial close across two cycles -------------------------------
deals_2_cycle1 = [
    deal(ticket=10, position_id=200, type=0, entry=sync._DEAL_ENTRY_IN,
         volume=0.2, price=2300.0, time=open_time.timestamp()),
    deal(ticket=11, position_id=200, type=1, entry=sync._DEAL_ENTRY_OUT,
         volume=0.1, price=2305.0, profit=5.0,
         time=(open_time + timedelta(minutes=30)).timestamp()),
]
trade_2a = sync._build_trade_from_group(200, deals_2_cycle1)
assert trade_2a is not None
assert trade_2a["close_volume"] == 0.1
assert trade_2a["deals_count"] == 2
sync._upsert_trade_history(db, trade_2a)

deals_2_cycle2 = deals_2_cycle1 + [
    deal(ticket=12, position_id=200, type=1, entry=sync._DEAL_ENTRY_OUT,
         volume=0.1, price=2308.0, profit=8.0,
         time=(open_time + timedelta(hours=1)).timestamp()),
]
trade_2b = sync._build_trade_from_group(200, deals_2_cycle2)
assert trade_2b["close_volume"] == 0.2
assert trade_2b["deals_count"] == 3
assert trade_2b["profit"] == 13.0  # 5.0 + 8.0
is_new_2 = sync._upsert_trade_history(db, trade_2b)
assert is_new_2 is False, "second pass should UPDATE, not insert"

row_2 = db.query(database.MT5TradeHistory).filter_by(position_id=200).first()
assert row_2.deals_count == 3
assert row_2.close_volume == 0.2
assert row_2.profit == 13.0
print("Test 2 (partial close across two cycles): PASS")

# --- Test 3: no matching signal (manual trade) ------------------------------
deals_3 = [
    deal(ticket=20, position_id=300, type=1, entry=sync._DEAL_ENTRY_IN,
         volume=0.1, price=2300.0, time=open_time.timestamp(), symbol="EURUSD"),
    deal(ticket=21, position_id=300, type=0, entry=sync._DEAL_ENTRY_OUT,
         volume=0.1, price=2295.0, profit=-5.0,
         time=(open_time + timedelta(hours=1)).timestamp(), symbol="EURUSD"),
]
trade_3 = sync._build_trade_from_group(300, deals_3)
assert trade_3["direction"] == "SELL"
sync._upsert_trade_history(db, trade_3)
row_3 = db.query(database.MT5TradeHistory).filter_by(position_id=300).first()
assert row_3.matched_signal_id is None, "EURUSD trade should not match an XAUUSD signal"
print("Test 3 (no matching signal): PASS")

# --- Test 4: still-open position (no OUT deal) -> not a trade --------------
deals_4 = [
    deal(ticket=30, position_id=400, type=0, entry=sync._DEAL_ENTRY_IN,
         volume=0.1, price=2300.0, time=open_time.timestamp()),
]
trade_4 = sync._build_trade_from_group(400, deals_4)
assert trade_4 is None, "position with only an IN deal must not become a trade row"
print("Test 4 (still-open position ignored): PASS")

# --- Test 5: _is_valid_trade rejects malformed trade dicts -----------------
valid_trade = dict(trade_1)
assert sync._is_valid_trade(valid_trade) is True

missing_open_time = dict(trade_1, open_time=None)
assert sync._is_valid_trade(missing_open_time) is False

missing_close_time = dict(trade_1, close_time=None)
assert sync._is_valid_trade(missing_close_time) is False

empty_symbol = dict(trade_1, symbol="")
assert sync._is_valid_trade(empty_symbol) is False

zero_position_id = dict(trade_1, position_id=0)
assert sync._is_valid_trade(zero_position_id) is False

print("Test 5 (_is_valid_trade rejects malformed trades): PASS")

print("ALL TESTS PASSED")
```

- [ ] **Step 4: تشغيل سكربت التحقق**

```bash
cd mt5_readonly_service
python _verify_trade_sync.py
```

Expected:
```
Test 1 (full close + matched signal): PASS
Test 2 (partial close across two cycles): PASS
Test 3 (no matching signal): PASS
Test 4 (still-open position ignored): PASS
Test 5 (_is_valid_trade rejects malformed trades): PASS
ALL TESTS PASSED
```

إذا فشل أي اختبار، أصلح المنطق في `mt5_trade_sync.py` وأعد التشغيل قبل المتابعة.

- [ ] **Step 5: حذف سكربت التحقق المؤقت**

```bash
rm mt5_readonly_service/_verify_trade_sync.py
```

(على PowerShell: `Remove-Item mt5_readonly_service/_verify_trade_sync.py`)

- [ ] **Step 6: فحص عدم وجود أي دالة تنفيذ تداول**

```bash
grep -inE "order_send|order_close|order_modify|order_check|OrderSend" mt5_readonly_service/mt5_trade_sync.py
```

Expected: لا أي نتيجة (exit code غير صفري / لا سطور).

- [ ] **Step 7: Commit**

```bash
git add mt5_readonly_service/mt5_trade_sync.py
git commit -m "feat(trade-history): add MT5 trade sync, grouping, and signal matching"
```

---

### Task 4: تسجيل المهمة الخلفية + endpoint التشخيص `POST /api/trade-history/sync-now`

**Files:**
- Modify: `mt5_readonly_service/main.py:31-32` (الاستيرادات)
- Modify: `mt5_readonly_service/main.py:772-780` (`_startup`)
- Modify: `mt5_readonly_service/main.py` (إضافة endpoint بعد `api_telegram_subscribers_unblock`، حول السطر 2295)

- [ ] **Step 1: تحديث الاستيرادات**

في `mt5_readonly_service/main.py`, السطر 31، أضف `MT5OpenPosition, MT5TradeHistory` إلى استيراد `database` (ترتيب أبجدي):

```python
from database import DecisionJournal, GoldProAnalysis, MT5OpenPosition, MT5TradeHistory, SessionLocal, StrategySignal, SystemConfig, TelegramSubscriber, TripleFirewallSignal, get_db, init_db
```

بعد السطر 32 (`from telegram_subscribers import ...`)، أضف سطراً جديداً:

```python
from mt5_trade_sync import run_mt5_trade_sync, sync_mt5_trades_once
```

- [ ] **Step 2: تسجيل المهمة الخلفية في `_startup`**

في `mt5_readonly_service/main.py`, داخل `_startup()` (حول السطر 780)، أضف سطراً بعد `asyncio.create_task(run_telegram_bot_polling())`:

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
    asyncio.create_task(run_mt5_trade_sync())
```

- [ ] **Step 3: إضافة endpoint `POST /api/trade-history/sync-now`**

أضف بعد `api_telegram_subscribers_unblock` (حول السطر 2295)، قبل تعليق `# System Configuration endpoints`:

```python
@app.post("/api/trade-history/sync-now")
def api_trade_history_sync_now(db: Session = Depends(get_db)) -> JSONResponse:
    """
    تشغيل دورة مزامنة واحدة فوراً لسجل الصفقات (تشخيص/تجربة) -- نفس منطق
    الحلقة الخلفية كل 60 ثانية. لا ينفذ أي صفقة، فقط سحب + تخزين + مطابقة.
    قراءة/تحليل فقط.
    """
    counters = sync_mt5_trades_once(db)
    return Utf8JsonResponse(content={"ok": True, **counters})
```

- [ ] **Step 4: التحقق من صحة بناء الجملة Python**

```bash
python -m py_compile mt5_readonly_service/main.py
```

Expected: لا أي إخراج (نجاح صامت).

- [ ] **Step 5: اختبار الاستدعاء المباشر (in-process، بدون httpx)**

من داخل `mt5_readonly_service/`:

```bash
python -c "
from database import SessionLocal, init_db
from main import api_trade_history_sync_now
init_db()
db = SessionLocal()
res = api_trade_history_sync_now(db=db)
print(res.status_code, res.body)
db.close()
"
```

Expected: `status_code == 200`، والـ body JSON يحتوي `"ok": true` بالإضافة لعدادات
`closedInserted/closedUpserted/openUpserted/openRemoved` (قد تكون كلها `0` إذا
كان MT5 غير مفتوح — هذا متوقع ومقبول، المهم عدم حدوث استثناء).

- [ ] **Step 6: Commit**

```bash
git add mt5_readonly_service/main.py
git commit -m "feat(trade-history): register background sync task and sync-now endpoint"
```

---

### Task 5: إضافة `GET /api/trade-history/closed`, `/open`, `/summary`

**Files:**
- Modify: `mt5_readonly_service/main.py` (إضافة بعد endpoint `sync-now` المُضاف في Task 4)

- [ ] **Step 1: إضافة دوال مساعدة لضم بيانات الإشارة المطابقة**

أضف مباشرة بعد `api_trade_history_sync_now`:

```python
def _signal_summary(db: Session, signal_id: int | None, time_delta_seconds: int | None) -> dict | None:
    """Return a small summary of the matched TripleFirewallSignal, or None
    if there is no match (manual trade)."""
    if signal_id is None:
        return None
    signal = db.query(TripleFirewallSignal).filter(TripleFirewallSignal.id == signal_id).first()
    if signal is None:
        return None
    return {
        "id": signal.id,
        "confluenceLevel": signal.confluence_level,
        "signalStrength": signal.signal_strength,
        "sl": signal.sl,
        "tp": signal.tp,
        "rr": signal.rr,
        "timestamp": signal.timestamp.isoformat() if signal.timestamp else None,
        "matchedTimeDeltaSeconds": time_delta_seconds,
    }


def _trade_history_with_signal(db: Session, row: MT5TradeHistory) -> dict:
    data = row.to_dict()
    data["matchedSignal"] = _signal_summary(db, row.matched_signal_id, row.matched_time_delta_seconds)
    return data


def _open_position_with_signal(db: Session, row: MT5OpenPosition) -> dict:
    data = row.to_dict()
    data["matchedSignal"] = _signal_summary(db, row.matched_signal_id, row.matched_time_delta_seconds)
    return data
```

- [ ] **Step 2: إضافة `GET /api/trade-history/closed`**

```python
@app.get("/api/trade-history/closed")
def api_trade_history_closed(
    days: int = Query(default=30, ge=1, le=365),
    symbol: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """
    سجل الصفقات المغلقة (مجمّعة حسب position_id) مع بيانات إشارة النظام
    المطابقة (إن وُجدت). قراءة فقط -- ليست توصية مالية.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    query = db.query(MT5TradeHistory).filter(MT5TradeHistory.open_time >= cutoff)
    if symbol and symbol.strip():
        query = query.filter(MT5TradeHistory.symbol == symbol.strip())

    total = query.count()
    rows = (
        query.order_by(MT5TradeHistory.close_time.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    trades = [_trade_history_with_signal(db, row) for row in rows]
    return Utf8JsonResponse(content={"ok": True, "total": total, "trades": trades})
```

- [ ] **Step 3: إضافة `GET /api/trade-history/open`**

```python
@app.get("/api/trade-history/open")
def api_trade_history_open(db: Session = Depends(get_db)) -> JSONResponse:
    """
    لقطة الصفقات المفتوحة حالياً مع بيانات إشارة النظام المطابقة (إن وُجدت).
    قراءة فقط -- ليست توصية مالية.
    """
    rows = db.query(MT5OpenPosition).order_by(MT5OpenPosition.open_time.desc()).all()
    positions = [_open_position_with_signal(db, row) for row in rows]
    return Utf8JsonResponse(content={"ok": True, "total": len(positions), "positions": positions})
```

- [ ] **Step 4: إضافة `GET /api/trade-history/summary`**

```python
@app.get("/api/trade-history/summary")
def api_trade_history_summary(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """
    إحصاءات معلوماتية لقياس دقة التوصيات (مرتبط بإشارة مقابل غير مرتبط).
    قراءة فقط -- ليست توصية مالية، ولا تُستخدم لتعديل الاستراتيجية تلقائياً.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = db.query(MT5TradeHistory).filter(MT5TradeHistory.open_time >= cutoff).all()

    matched = [r for r in rows if r.matched_signal_id is not None]
    unmatched = [r for r in rows if r.matched_signal_id is None]

    def _win_rate(group: list[MT5TradeHistory]) -> float | None:
        if not group:
            return None
        wins = sum(1 for r in group if r.profit > 0)
        return round(wins / len(group) * 100, 2)

    return Utf8JsonResponse(content={
        "ok": True,
        "days": days,
        "totalTrades": len(rows),
        "matchedTrades": len(matched),
        "unmatchedTrades": len(unmatched),
        "overallWinRatePct": _win_rate(rows),
        "matchedWinRatePct": _win_rate(matched),
        "unmatchedWinRatePct": _win_rate(unmatched),
        "netProfit": round(sum(r.profit for r in rows), 2),
    })
```

- [ ] **Step 5: التحقق من صحة بناء الجملة Python**

```bash
python -m py_compile mt5_readonly_service/main.py
```

Expected: لا أي إخراج (نجاح صامت).

- [ ] **Step 6: اختبار الاستدعاء المباشر للـ 3 endpoints (in-process)**

```bash
cd mt5_readonly_service
python -c "
from database import SessionLocal, init_db
from main import api_trade_history_closed, api_trade_history_open, api_trade_history_summary
init_db()
db = SessionLocal()
print('closed:', api_trade_history_closed(days=30, symbol=None, limit=50, offset=0, db=db).status_code)
print('open:', api_trade_history_open(db=db).status_code)
print('summary:', api_trade_history_summary(days=30, db=db).status_code)
db.close()
"
```

Expected: الأسطر الثلاثة تطبع `200`.

- [ ] **Step 7: فحص عدم وجود أي دالة تنفيذ تداول في main.py الجديد**

```bash
git diff mt5_readonly_service/main.py | grep -inE "order_send|order_close|order_modify|order_check|OrderSend"
```

Expected: لا أي نتيجة.

- [ ] **Step 8: Commit**

```bash
git add mt5_readonly_service/main.py
git commit -m "feat(trade-history): add closed/open/summary read endpoints"
```

---

### Task 6: Next.js proxy routes تحت `src/app/api/trade-history/`

**Files:**
- Create: `src/app/api/trade-history/closed/route.ts`
- Create: `src/app/api/trade-history/open/route.ts`
- Create: `src/app/api/trade-history/summary/route.ts`
- Create: `src/app/api/trade-history/sync-now/route.ts`

- [ ] **Step 1: `src/app/api/trade-history/closed/route.ts`**

```typescript
/**
 * Read-only proxy for closed MT5 trade history (matched against system signals).
 * Proxies GET http://127.0.0.1:8010/api/trade-history/closed
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const FETCH_TIMEOUT_MS = 8000;

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const u = new URL(`${MT5_SERVICE_BASE}/api/trade-history/closed`);
  for (const key of ["days", "symbol", "limit", "offset"] as const) {
    const v = sp.get(key);
    if (v !== null && v !== "") u.searchParams.set(key, v);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(u.toString(), {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { ok: false, total: 0, trades: [], error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها" },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 2: `src/app/api/trade-history/open/route.ts`**

```typescript
/**
 * Read-only proxy for currently-open MT5 positions (matched against system signals).
 * Proxies GET http://127.0.0.1:8010/api/trade-history/open
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const FETCH_TIMEOUT_MS = 8000;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${MT5_SERVICE_BASE}/api/trade-history/open`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { ok: false, total: 0, positions: [], error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها" },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 3: `src/app/api/trade-history/summary/route.ts`**

```typescript
/**
 * Read-only proxy for trade-history summary stats (recommendation-accuracy
 * informational metrics -- not financial advice).
 * Proxies GET http://127.0.0.1:8010/api/trade-history/summary
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const FETCH_TIMEOUT_MS = 8000;

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const u = new URL(`${MT5_SERVICE_BASE}/api/trade-history/summary`);
  const days = sp.get("days");
  if (days !== null && days !== "") u.searchParams.set("days", days);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(u.toString(), {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      {
        ok: false,
        days: 30,
        totalTrades: 0,
        matchedTrades: 0,
        unmatchedTrades: 0,
        overallWinRatePct: null,
        matchedWinRatePct: null,
        unmatchedWinRatePct: null,
        netProfit: 0,
        error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها",
      },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 4: `src/app/api/trade-history/sync-now/route.ts`**

```typescript
/**
 * Diagnostic proxy: triggers one immediate MT5 trade-history sync cycle.
 * Read-only / analysis-only -- does not place, close, or modify any order.
 * Proxies POST http://127.0.0.1:8010/api/trade-history/sync-now
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const FETCH_TIMEOUT_MS = 15000;

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${MT5_SERVICE_BASE}/api/trade-history/sync-now`, {
      method: "POST",
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { ok: false, error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها" },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 5: التحقق من TypeScript**

```bash
pnpm exec tsc --noEmit
```

Expected: `EXIT:0` (لا أخطاء).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/trade-history/
git commit -m "feat(trade-history): add Next.js proxy routes for trade-history API"
```

---

### Task 7: صفحة `/trade-history`

**Files:**
- Create: `src/app/(dashboard)/trade-history/page.tsx`

- [ ] **Step 1: إنشاء الصفحة**

```typescript
"use client";

import { useState, useCallback, useEffect } from "react";
import { History, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";

interface MatchedSignal {
  id: number;
  confluenceLevel: string | null;
  signalStrength: number;
  sl: number | null;
  tp: number | null;
  rr: number | null;
  timestamp: string | null;
  matchedTimeDeltaSeconds: number | null;
}

interface ClosedTrade {
  id: number;
  positionId: number;
  symbol: string;
  direction: string;
  volume: number;
  openPrice: number;
  openTime: string | null;
  closePrice: number;
  closeTime: string | null;
  closeVolume: number;
  dealsCount: number;
  profit: number;
  commission: number;
  swap: number;
  matchedSignal: MatchedSignal | null;
}

interface OpenPosition {
  id: number;
  ticket: number;
  symbol: string;
  direction: string;
  volume: number;
  openPrice: number;
  openTime: string | null;
  currentPrice: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  matchedSignal: MatchedSignal | null;
}

interface ClosedResponse {
  ok: boolean;
  total: number;
  trades: ClosedTrade[];
  error?: string;
}

interface OpenResponse {
  ok: boolean;
  total: number;
  positions: OpenPosition[];
  error?: string;
}

interface SummaryResponse {
  ok: boolean;
  days: number;
  totalTrades: number;
  matchedTrades: number;
  unmatchedTrades: number;
  overallWinRatePct: number | null;
  matchedWinRatePct: number | null;
  unmatchedWinRatePct: number | null;
  netProfit: number;
  error?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatTimeDelta(seconds: number | null): string {
  if (seconds === null) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `قبل ${hours} ساعة و${minutes} دقيقة من فتح الصفقة`;
  return `قبل ${minutes} دقيقة من فتح الصفقة`;
}

function directionLabel(direction: string): string {
  return direction === "BUY" ? "شراء" : "بيع";
}

function profitClass(profit: number): string {
  if (profit > 0) return "text-green-400";
  if (profit < 0) return "text-red-400";
  return "text-slate-400";
}

function signalBadge(signal: MatchedSignal | null) {
  if (!signal) {
    return (
      <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
        لا توجد إشارة مطابقة
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="rounded border border-green-700 bg-green-950 px-2 py-0.5 text-xs text-green-400 w-fit">
        ✅ مرتبطة بإشارة — {signal.confluenceLevel ?? "—"}
      </span>
      <span className="text-[10px] text-slate-500">{formatTimeDelta(signal.matchedTimeDeltaSeconds)}</span>
    </div>
  );
}

export default function TradeHistoryPage() {
  const [closed, setClosed] = useState<ClosedResponse | null>(null);
  const [open, setOpen] = useState<OpenResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [closedRes, openRes, summaryRes] = await Promise.all([
        fetch("/api/trade-history/closed?days=30&limit=50&offset=0", { cache: "no-store" }),
        fetch("/api/trade-history/open", { cache: "no-store" }),
        fetch("/api/trade-history/summary?days=30", { cache: "no-store" }),
      ]);
      const [closedBody, openBody, summaryBody]: [ClosedResponse, OpenResponse, SummaryResponse] =
        await Promise.all([closedRes.json(), openRes.json(), summaryRes.json()]);

      if (!closedBody.ok || !openBody.ok || !summaryBody.ok) {
        setError(closedBody.error ?? openBody.error ?? summaryBody.error ?? "تعذّر تحميل سجل الصفقات");
      }
      setClosed(closedBody);
      setOpen(openBody);
      setSummary(summaryBody);
    } catch {
      setError("تعذّر الاتصال بخدمة MT5 المحلية");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/trade-history/sync-now", { method: "POST", cache: "no-store" });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error ?? "تعذّر تنفيذ المزامنة");
        return;
      }
      await loadData();
    } catch {
      setError("تعذّر الاتصال بخدمة MT5 المحلية");
    } finally {
      setSyncing(false);
    }
  }, [loadData]);

  const closedTrades = closed?.trades ?? [];
  const openPositions = open?.positions ?? [];

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/25">
            <History className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">سجل الصفقات وربطها بإشارات النظام</h1>
            <p className="text-xs text-muted-foreground">
              الصفقات المغلقة والمفتوحة من MT5، مع ربط تلقائي بإشارات الجدار الثلاثي لقياس دقة التوصيات
            </p>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-300">
          ⚠️ هذه البيانات لأغراض التحليل والتعلم من النتائج فقط، وليست توصية مالية أو أمر تداول.
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950 p-2 text-xs text-red-400">
            ⚠️ {error}
          </div>
        )}

        {/* Summary cards */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-5 text-center">
            <p className="text-2xl font-bold text-slate-200">{summary?.totalTrades ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">إجمالي الصفقات المغلقة (30 يوم)</p>
          </div>
          <div className="rounded-xl border border-green-800 bg-green-950/30 px-4 py-5 text-center">
            <p className="text-2xl font-bold text-green-400">{summary?.matchedTrades ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">
              مرتبطة بإشارة — نسبة الربح {summary?.matchedWinRatePct ?? "—"}%
            </p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-5 text-center">
            <p className="text-2xl font-bold text-slate-200">{summary?.unmatchedTrades ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">
              غير مرتبطة (يدوية) — نسبة الربح {summary?.unmatchedWinRatePct ?? "—"}%
            </p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-5 text-center">
            <p className={`text-2xl font-bold ${profitClass(summary?.netProfit ?? 0)}`}>
              {summary?.netProfit ?? 0}
            </p>
            <p className="mt-1 text-xs text-slate-400">صافي الربح/الخسارة</p>
          </div>
        </div>

        {/* Open positions */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-2">
            <p className="text-xs uppercase tracking-widest text-slate-500">الصفقات المفتوحة</p>
            <div className="flex gap-2">
              <button
                onClick={syncNow}
                disabled={syncing}
                className="flex items-center gap-1 rounded border border-amber-700 px-3 py-1 text-xs text-amber-300 hover:bg-amber-950 disabled:opacity-50"
              >
                <RefreshCw className="h-3 w-3" />
                {syncing ? "جاري المزامنة..." : "مزامنة الآن"}
              </button>
              <button
                onClick={loadData}
                disabled={loading}
                className="flex items-center gap-1 rounded border border-slate-600 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                <RefreshCw className="h-3 w-3" />
                {loading ? "جاري التحديث..." : "تحديث"}
              </button>
            </div>
          </div>

          {openPositions.length === 0 && !loading && (
            <p className="text-center text-sm text-slate-500 py-6">لا توجد صفقات مفتوحة حالياً</p>
          )}

          {openPositions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-500">
                    <th className="p-2 text-right">الرمز</th>
                    <th className="p-2 text-right">الاتجاه</th>
                    <th className="p-2 text-right">الحجم</th>
                    <th className="p-2 text-right">سعر الفتح</th>
                    <th className="p-2 text-right">السعر الحالي</th>
                    <th className="p-2 text-right">الربح العائم</th>
                    <th className="p-2 text-right">إشارة النظام</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map((p) => (
                    <tr key={p.ticket} className="border-b border-slate-800">
                      <td className="p-2 font-bold text-slate-200">{p.symbol}</td>
                      <td className="p-2">
                        <span className="flex items-center gap-1 text-slate-300">
                          {p.direction === "BUY" ? (
                            <TrendingUp className="h-3 w-3 text-green-400" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-red-400" />
                          )}
                          {directionLabel(p.direction)}
                        </span>
                      </td>
                      <td className="p-2 text-slate-400">{p.volume}</td>
                      <td className="p-2 text-slate-400">{p.openPrice}</td>
                      <td className="p-2 text-slate-400">{p.currentPrice}</td>
                      <td className={`p-2 font-bold ${profitClass(p.profit)}`}>{p.profit}</td>
                      <td className="p-2">{signalBadge(p.matchedSignal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Closed trades */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-2">
            <p className="text-xs uppercase tracking-widest text-slate-500">الصفقات المغلقة (آخر 30 يوم)</p>
          </div>

          {closedTrades.length === 0 && !loading && (
            <p className="text-center text-sm text-slate-500 py-6">لا توجد صفقات مغلقة ضمن آخر 30 يوم</p>
          )}

          {closedTrades.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-500">
                    <th className="p-2 text-right">الرمز</th>
                    <th className="p-2 text-right">الاتجاه</th>
                    <th className="p-2 text-right">الحجم</th>
                    <th className="p-2 text-right">وقت الفتح</th>
                    <th className="p-2 text-right">وقت الإغلاق</th>
                    <th className="p-2 text-right">الربح/الخسارة</th>
                    <th className="p-2 text-right">إشارة النظام</th>
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.map((t) => (
                    <tr key={t.positionId} className="border-b border-slate-800">
                      <td className="p-2 font-bold text-slate-200">{t.symbol}</td>
                      <td className="p-2">
                        <span className="flex items-center gap-1 text-slate-300">
                          {t.direction === "BUY" ? (
                            <TrendingUp className="h-3 w-3 text-green-400" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-red-400" />
                          )}
                          {directionLabel(t.direction)}
                        </span>
                      </td>
                      <td className="p-2 text-slate-400">{t.volume}</td>
                      <td className="p-2 text-slate-400">{formatDate(t.openTime)}</td>
                      <td className="p-2 text-slate-400">{formatDate(t.closeTime)}</td>
                      <td className={`p-2 font-bold ${profitClass(t.profit)}`}>{t.profit}</td>
                      <td className="p-2">{signalBadge(t.matchedSignal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-600">
          ⚠️ نظام تحليل معلوماتي مؤسسي — لا يمثل توصية مالية ولا يقوم بتنفيذ أي صفقات
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: التحقق من TypeScript**

```bash
pnpm exec tsc --noEmit
```

Expected: `EXIT:0`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/trade-history/page.tsx"
git commit -m "feat(trade-history): add /trade-history page"
```

---

### Task 8: إضافة الرابط في `navigation.ts`

**Files:**
- Modify: `src/lib/constants/navigation.ts`

- [ ] **Step 1: إضافة استيراد أيقونة `History`**

غيّر السطر 2-11 من:

```typescript
import {
  BookOpen,
  FileText,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Settings,
  Shield,
  Users,
} from "lucide-react";
```

إلى:

```typescript
import {
  BookOpen,
  FileText,
  FlaskConical,
  Globe,
  History,
  LayoutDashboard,
  Settings,
  Shield,
  Users,
} from "lucide-react";
```

- [ ] **Step 2: إضافة عنصر التنقل ضمن مجموعة "intel"**

غيّر:

```typescript
  {
    id:    "intel",
    title: "التحليل والاستخبارات",
    icon:  BookOpen,
    items: [
      { label: "سجل القرارات",             href: "/decision-journal", icon: BookOpen },
      { label: "رادار الأخبار الاقتصادية", href: "/reports",           icon: FileText },
    ],
  },
```

إلى:

```typescript
  {
    id:    "intel",
    title: "التحليل والاستخبارات",
    icon:  BookOpen,
    items: [
      { label: "سجل القرارات",             href: "/decision-journal", icon: BookOpen },
      { label: "سجل الصفقات",              href: "/trade-history",    icon: History  },
      { label: "رادار الأخبار الاقتصادية", href: "/reports",           icon: FileText },
    ],
  },
```

- [ ] **Step 3: التحقق من TypeScript**

```bash
pnpm exec tsc --noEmit
```

Expected: `EXIT:0`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/constants/navigation.ts
git commit -m "feat(trade-history): add sidebar link for /trade-history"
```

---

### Task 9: التحقق النهائي الشامل

**Files:** لا تعديل — تحقق فقط.

- [ ] **Step 1: فحص Python كامل**

```bash
python -m py_compile mt5_readonly_service/main.py mt5_readonly_service/database.py mt5_readonly_service/mt5_trade_sync.py
```

Expected: لا أي إخراج.

- [ ] **Step 2: TypeScript**

```bash
pnpm exec tsc --noEmit
```

Expected: `EXIT:0`.

- [ ] **Step 3: Build**

```bash
pnpm run build
```

Expected: نجاح بناء كل الصفحات بما فيها `/trade-history`.

- [ ] **Step 4: فحص شامل لعدم وجود دوال تنفيذ تداول في كل الملفات الجديدة/المعدَّلة**

استخدم `git diff --name-only HEAD` (التغييرات غير المُلتزمة) بالإضافة إلى الملفات الجديدة غير المتتبَّعة، بدلاً من المقارنة مع `main` (قد لا يكون الفرع الحالي `main`):

```bash
{ git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u | grep -E "\.(py|ts|tsx)$" | xargs grep -inE "order_send|order_close|order_modify|order_check|OrderSend" ; echo "EXIT:$?"
```

Expected: لا أي سطر مطابق، و`EXIT:1` (أي `grep` لم يجد شيئاً = نظيف).

- [ ] **Step 5: التأكد من عدم لمس Convex**

```bash
git status --short | grep -i convex || echo "NO CONVEX CHANGES"
```

Expected: `NO CONVEX CHANGES`.

- [ ] **Step 6: اختبار يدوي (يتطلب MT5 مفتوحاً)**

1. شغّل خدمة MT5: `cd mt5_readonly_service && uvicorn main:app --host 127.0.0.1 --port 8010 --reload`
2. شغّل Next.js: `pnpm dev`
3. افتح `/trade-history` — تحقق من ظهور التنويه، البطاقات، جدول الصفقات المفتوحة، جدول الصفقات المغلقة (قد تكون فارغة إذا لا توجد صفقات في الحساب).
4. اضغط "مزامنة الآن" — تحقق من عدم ظهور خطأ، وتحديث الجداول.
5. انتظر 60+ ثانية، تحقق من سجلات الخدمة (`logger`) لرؤية أن `mt5_trade_sync` يعمل دورياً دون أخطاء متكررة.
6. تحقق من اتجاه RTL وعدم وجود نصوص إنجليزية ظاهرة للمستخدم (باستثناء الرموز التقنية مثل XAUUSD).

- [ ] **Step 7: `git status` نهائي**

```bash
git status --short
```

راجع القائمة وتأكد أنها تطابق فقط الملفات المذكورة في خطة التنفيذ (لا تغييرات غير متوقعة).

---

## ملخص الملفات المتأثرة

| الملف | نوع التغيير |
|---|---|
| `mt5_readonly_service/local_quant_backup_before_trade_history.db` | جديد (نسخة احتياطية) |
| `mt5_readonly_service/database.py` | إضافة `MT5TradeHistory`, `MT5OpenPosition` |
| `mt5_readonly_service/mt5_trade_sync.py` | جديد |
| `mt5_readonly_service/main.py` | إضافي: استيرادات + تسجيل المهمة الخلفية + 4 endpoints |
| `src/app/api/trade-history/closed/route.ts` | جديد |
| `src/app/api/trade-history/open/route.ts` | جديد |
| `src/app/api/trade-history/summary/route.ts` | جديد |
| `src/app/api/trade-history/sync-now/route.ts` | جديد |
| `src/app/(dashboard)/trade-history/page.tsx` | جديد |
| `src/lib/constants/navigation.ts` | إضافة رابط "سجل الصفقات" |
