# News Radar — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data foundation + `/reports` page for the News Radar feature: an organized semi-dynamic economic calendar stored in a new SQLite table, served by 3 read-only FastAPI endpoints, proxied through 3 Next.js routes, and displayed on a rebuilt `/reports` page with a live countdown, risk-zone warning, manual refresh, and currency/asset filters. No external API/keys, no Convex changes, no Telegram, no analysis linkage (Phase 2).

**Architecture:** A new `economic_calendar.py` module holds ~14 static `NewsEventTemplate` definitions and pure functions (`generate_occurrences`, `compute_status`, `is_in_risk_window`, `sync_calendar_events`). A new `EconomicNewsEvent` SQLAlchemy model (table `economic_news_events`) persists generated occurrences, upserted by `event_id`. A background task `run_news_radar_sync()` (registered in `_startup()`, same pattern as `run_mt5_trade_sync()`) keeps the table fresh with an adaptive 60s/300s sleep. Three FastAPI endpoints expose the data; three Next.js proxy routes (Clerk-authenticated, following the existing `trade-history` proxy pattern) forward to them; the `/reports` page consumes them with client-side countdown and filtering.

**Tech Stack:** FastAPI + SQLAlchemy (SQLite) on the Python side; Next.js App Router + Clerk auth + Tailwind on the frontend. No new dependencies.

---

## Spec Reference

Full design: `docs/superpowers/specs/2026-06-12-news-radar-phase-1-design.md` (approved). This plan corrects one detail from that spec: `EconomicNewsEvent.created_at`/`updated_at` use the codebase's existing `default=_utcnow, onupdate=_utcnow` pattern (matching `MT5TradeHistory`/`MT5OpenPosition`) instead of `func.now()` (which is not imported in `database.py` and would require a new import for no benefit).

---

## Task 1: Add `EconomicNewsEvent` model to `database.py`

**Files:**
- Modify: `mt5_readonly_service/database.py:16` (add `import json`)
- Modify: `mt5_readonly_service/database.py:448` (insert new model between `MT5OpenPosition` and `TelegramSubscriber`)

- [ ] **Step 1: Add the `json` import**

`database.py` currently starts with:

```python
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Generator
```

Change to:

```python
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator
```

- [ ] **Step 2: Insert the `EconomicNewsEvent` model**

Insert the new class immediately after `MT5OpenPosition.to_dict()` ends and before `class TelegramSubscriber(Base):` (currently line 449 in `database.py`). The new class:

```python
class EconomicNewsEvent(Base):
    """
    Organized semi-dynamic economic calendar event (News Radar -- Phase 1).

    Rows are generated from static NewsEventTemplate definitions in
    economic_calendar.py (no external API, no live news feed). `actual`
    always remains None until a real news source is connected in a future
    phase -- this is disclosed in the UI.

    Read-only contract: this table is populated purely by
    economic_calendar.sync_calendar_events(); nothing here triggers
    order_send/order_close/order_modify.
    """

    __tablename__ = "economic_news_events"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    source              = Column(String(50), nullable=False, default="organized_calendar")
    event_id            = Column(String(100), nullable=False, unique=True)
    title               = Column(String(255), nullable=False)
    currency            = Column(String(10), nullable=False)
    impact              = Column(String(10), nullable=False)  # high | medium | low
    event_time_utc      = Column(DateTime(timezone=True), nullable=False)
    event_time_baghdad  = Column(DateTime(timezone=True), nullable=False)
    forecast            = Column(String(50), nullable=True)
    previous            = Column(String(50), nullable=True)
    actual              = Column(String(50), nullable=True)
    affected_symbols    = Column(Text, nullable=False, default="[]")  # JSON-encoded list[str]
    status              = Column(String(20), nullable=False, default="upcoming")
    created_at          = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at          = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (
        Index("ix_ene_event_id", "event_id", unique=True),
        Index("ix_ene_event_time_utc", "event_time_utc"),
        Index("ix_ene_currency", "currency"),
    )

    def to_dict(self) -> dict:
        return {
            "id":               self.id,
            "source":           self.source,
            "eventId":          self.event_id,
            "title":            self.title,
            "currency":         self.currency,
            "impact":           self.impact,
            "eventTimeUtc":     self.event_time_utc.isoformat() if self.event_time_utc else None,
            "eventTimeBaghdad": self.event_time_baghdad.isoformat() if self.event_time_baghdad else None,
            "forecast":         self.forecast,
            "previous":         self.previous,
            "actual":           self.actual,
            "affectedSymbols":  json.loads(self.affected_symbols or "[]"),
            "status":           self.status,
        }
```

- [ ] **Step 3: Verify**

```bash
cd mt5_readonly_service
python -m py_compile database.py
```

Expected: no output, exit code 0.

```bash
python -c "from database import EconomicNewsEvent, init_db; init_db(); print('ok: economic_news_events table created')"
```

Expected: `ok: economic_news_events table created` (idempotent -- safe to re-run; does not drop existing tables).

- [ ] **Step 4: Commit**

```bash
git add mt5_readonly_service/database.py
git commit -m "feat: add EconomicNewsEvent table for News Radar Phase 1"
```

---

## Task 2: Create `mt5_readonly_service/economic_calendar.py`

**Files:**
- Create: `mt5_readonly_service/economic_calendar.py`

This module contains: the static event templates, occurrence generation, status/risk-window computation, the sync function, and the background loop.

- [ ] **Step 1: Write the full module**

```python
"""
economic_calendar.py -- Organized semi-dynamic economic calendar
(News Radar -- Phase 1).

Generates a small, fixed set of recurring macro-economic events (CPI, NFP,
FOMC, ECB/BOE rate decisions, etc.) from static templates -- no external API,
no API keys, no live news feed. `previous`/`forecast` are static, realistic
display values per template; `actual` always stays None.

Read-only contract: this module never calls order_send, order_close,
order_modify, order_check, or OrderSend, and never imports MetaTrader5.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from database import EconomicNewsEvent, SessionLocal

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Event templates
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class NewsEventTemplate:
    template_id: str
    title: str                  # Arabic display title
    currency: str                # USD | EUR | GBP
    impact: str                  # high | medium
    affected_symbols: list[str]
    recurrence: str              # "weekly" | "monthly_first_friday" | "monthly_mid"
    weekday: int | None = None   # 0=Monday .. 6=Sunday (for "weekly")
    monthly_day: int = 13        # day-of-month (for "monthly_mid", <= 28)
    utc_time: tuple[int, int] = (13, 30)
    previous: str = "--"
    forecast: str = "--"


TEMPLATES: list[NewsEventTemplate] = [
    NewsEventTemplate(
        template_id="us_nfp",
        title="تقرير التوظيف الأمريكي (NFP)",
        currency="USD",
        impact="high",
        affected_symbols=["XAUUSD", "DXY", "EURUSD", "BTC-USDT"],
        recurrence="monthly_first_friday",
        utc_time=(13, 30),
        previous="175K",
        forecast="180K",
    ),
    NewsEventTemplate(
        template_id="us_cpi",
        title="مؤشر أسعار المستهلك الأمريكي (CPI)",
        currency="USD",
        impact="high",
        affected_symbols=["XAUUSD", "DXY", "EURUSD"],
        recurrence="monthly_mid",
        monthly_day=13,
        utc_time=(13, 30),
        previous="3.2%",
        forecast="3.1%",
    ),
    NewsEventTemplate(
        template_id="us_ppi",
        title="مؤشر أسعار المنتجين الأمريكي (PPI)",
        currency="USD",
        impact="medium",
        affected_symbols=["XAUUSD", "DXY"],
        recurrence="monthly_mid",
        monthly_day=14,
        utc_time=(13, 30),
        previous="0.2%",
        forecast="0.3%",
    ),
    NewsEventTemplate(
        template_id="us_fomc",
        title="قرار الفائدة الأمريكي (FOMC)",
        currency="USD",
        impact="high",
        affected_symbols=["XAUUSD", "DXY", "EURUSD", "BTC-USDT"],
        recurrence="monthly_mid",
        monthly_day=20,
        utc_time=(18, 0),
        previous="4.50%",
        forecast="4.50%",
    ),
    NewsEventTemplate(
        template_id="us_unemployment_claims",
        title="طلبات إعانة العمالة الأمريكية الأسبوعية",
        currency="USD",
        impact="medium",
        affected_symbols=["XAUUSD", "DXY"],
        recurrence="weekly",
        weekday=3,  # Thursday
        utc_time=(13, 30),
        previous="230K",
        forecast="225K",
    ),
    NewsEventTemplate(
        template_id="us_gdp",
        title="الناتج المحلي الإجمالي الأمريكي (GDP)",
        currency="USD",
        impact="high",
        affected_symbols=["XAUUSD", "DXY", "EURUSD"],
        recurrence="monthly_mid",
        monthly_day=27,
        utc_time=(12, 30),
        previous="2.8%",
        forecast="2.6%",
    ),
    NewsEventTemplate(
        template_id="us_retail_sales",
        title="مبيعات التجزئة الأمريكية",
        currency="USD",
        impact="medium",
        affected_symbols=["XAUUSD", "DXY"],
        recurrence="monthly_mid",
        monthly_day=15,
        utc_time=(13, 30),
        previous="0.4%",
        forecast="0.3%",
    ),
    NewsEventTemplate(
        template_id="us_pce",
        title="مؤشر نفقات الاستهلاك الشخصي الأساسي (PCE)",
        currency="USD",
        impact="high",
        affected_symbols=["XAUUSD", "DXY", "EURUSD"],
        recurrence="monthly_mid",
        monthly_day=28,
        utc_time=(13, 30),
        previous="2.5%",
        forecast="2.4%",
    ),
    NewsEventTemplate(
        template_id="us_consumer_confidence",
        title="مؤشر ثقة المستهلك الأمريكي",
        currency="USD",
        impact="medium",
        affected_symbols=["XAUUSD", "DXY"],
        recurrence="monthly_mid",
        monthly_day=25,
        utc_time=(15, 0),
        previous="100.0",
        forecast="101.5",
    ),
    NewsEventTemplate(
        template_id="us_ism_manufacturing",
        title="مؤشر مديري المشتريات الصناعي الأمريكي (ISM)",
        currency="USD",
        impact="medium",
        affected_symbols=["XAUUSD", "DXY"],
        recurrence="monthly_mid",
        monthly_day=1,
        utc_time=(14, 0),
        previous="48.5",
        forecast="49.0",
    ),
    NewsEventTemplate(
        template_id="eu_ecb_rate",
        title="قرار الفائدة للبنك المركزي الأوروبي (ECB)",
        currency="EUR",
        impact="high",
        affected_symbols=["EURUSD", "XAUUSD"],
        recurrence="monthly_mid",
        monthly_day=18,
        utc_time=(12, 15),
        previous="3.50%",
        forecast="3.50%",
    ),
    NewsEventTemplate(
        template_id="eu_cpi",
        title="مؤشر أسعار المستهلك في منطقة اليورو (CPI)",
        currency="EUR",
        impact="medium",
        affected_symbols=["EURUSD", "XAUUSD"],
        recurrence="monthly_mid",
        monthly_day=17,
        utc_time=(10, 0),
        previous="2.4%",
        forecast="2.3%",
    ),
    NewsEventTemplate(
        template_id="uk_boe_rate",
        title="قرار الفائدة لبنك إنجلترا (BOE)",
        currency="GBP",
        impact="high",
        affected_symbols=["GBPUSD", "XAUUSD"],
        recurrence="monthly_mid",
        monthly_day=21,
        utc_time=(11, 0),
        previous="4.25%",
        forecast="4.25%",
    ),
    NewsEventTemplate(
        template_id="uk_cpi",
        title="مؤشر أسعار المستهلك البريطاني (CPI)",
        currency="GBP",
        impact="medium",
        affected_symbols=["GBPUSD", "XAUUSD"],
        recurrence="monthly_mid",
        monthly_day=16,
        utc_time=(6, 0),
        previous="2.6%",
        forecast="2.5%",
    ),
]


# ---------------------------------------------------------------------------
# Occurrence generation
# ---------------------------------------------------------------------------

def _at_time(d: date, hour: int, minute: int) -> datetime:
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=timezone.utc)


def _first_friday(year: int, month: int) -> date:
    first = date(year, month, 1)
    offset = (4 - first.weekday()) % 7  # Friday == 4
    return first + timedelta(days=offset)


def _months_in_window(window_start: datetime, window_end: datetime) -> set[tuple[int, int]]:
    months: set[tuple[int, int]] = set()
    cursor = date(window_start.year, window_start.month, 1)
    end_marker = date(window_end.year, window_end.month, 1)
    while True:
        months.add((cursor.year, cursor.month))
        if cursor >= end_marker:
            break
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return months


def generate_occurrences(now_utc: datetime, days_ahead: int = 7) -> list[dict]:
    """Project each template onto its occurrence(s) within
    [now_utc - 1 day, now_utc + days_ahead]. Returns raw event dicts ready
    for upsert (event_id, event_time_utc, event_time_baghdad, ...)."""
    window_start = now_utc - timedelta(days=1)
    window_end = now_utc + timedelta(days=days_ahead)

    occurrences: list[dict] = []
    for tmpl in TEMPLATES:
        hour, minute = tmpl.utc_time
        candidates: list[datetime] = []

        if tmpl.recurrence == "weekly":
            assert tmpl.weekday is not None
            span_days = (window_end.date() - window_start.date()).days
            for offset in range(span_days + 1):
                d = window_start.date() + timedelta(days=offset)
                if d.weekday() == tmpl.weekday:
                    candidates.append(_at_time(d, hour, minute))

        elif tmpl.recurrence == "monthly_first_friday":
            for year, month in _months_in_window(window_start, window_end):
                candidates.append(_at_time(_first_friday(year, month), hour, minute))

        elif tmpl.recurrence == "monthly_mid":
            for year, month in _months_in_window(window_start, window_end):
                candidates.append(_at_time(date(year, month, tmpl.monthly_day), hour, minute))

        else:
            logger.warning("economic_calendar: unknown recurrence %r for %s", tmpl.recurrence, tmpl.template_id)
            continue

        for event_time_utc in candidates:
            if window_start <= event_time_utc <= window_end:
                event_time_baghdad = event_time_utc + timedelta(hours=3)
                occurrences.append({
                    "template_id":       tmpl.template_id,
                    "event_id":          f"{tmpl.template_id}:{event_time_utc.date().isoformat()}",
                    "title":             tmpl.title,
                    "currency":          tmpl.currency,
                    "impact":            tmpl.impact,
                    "event_time_utc":    event_time_utc,
                    "event_time_baghdad": event_time_baghdad,
                    "forecast":          tmpl.forecast,
                    "previous":          tmpl.previous,
                    "affected_symbols":  tmpl.affected_symbols,
                })

    return occurrences


# ---------------------------------------------------------------------------
# Status / risk-window computation
# ---------------------------------------------------------------------------

def compute_status(event_time_utc: datetime, now_utc: datetime) -> str:
    """
    delta = (event_time_utc - now_utc).total_seconds()
    - delta > 1800            -> "upcoming"    (قادم)
    - 0 < delta <= 1800        -> "imminent"    (قريب جدًا)
    - -900 <= delta <= 0       -> "released"    (صدر -- ضمن نافذة +15 دقيقة)
    - delta < -900             -> "risk_ended"  (انتهت فترة الخطر)
    """
    delta = (event_time_utc - now_utc).total_seconds()
    if delta > 1800:
        return "upcoming"
    if delta > 0:
        return "imminent"
    if delta >= -900:
        return "released"
    return "risk_ended"


def is_in_risk_window(event_time_utc: datetime, now_utc: datetime, impact: str) -> bool:
    """High-impact only: True if now is within
    [event_time_utc - 5min, event_time_utc + 15min]."""
    if impact != "high":
        return False
    delta = (event_time_utc - now_utc).total_seconds()
    return -900 <= delta <= 300


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------

def sync_calendar_events(db: Session, now_utc: datetime | None = None) -> dict:
    """Generate occurrences, upsert into economic_news_events by event_id,
    recompute status for all generated rows, and return counters:
    {"generated": N, "upserted": N, "activeWindowCount": N}."""
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)

    occurrences = generate_occurrences(now_utc)
    upserted = 0

    for occ in occurrences:
        row = (
            db.query(EconomicNewsEvent)
            .filter(EconomicNewsEvent.event_id == occ["event_id"])
            .first()
        )
        status = compute_status(occ["event_time_utc"], now_utc)

        if row is None:
            row = EconomicNewsEvent(
                source="organized_calendar",
                event_id=occ["event_id"],
                title=occ["title"],
                currency=occ["currency"],
                impact=occ["impact"],
                event_time_utc=occ["event_time_utc"],
                event_time_baghdad=occ["event_time_baghdad"],
                forecast=occ["forecast"],
                previous=occ["previous"],
                actual=None,
                affected_symbols=json.dumps(occ["affected_symbols"]),
                status=status,
            )
            db.add(row)
        else:
            row.status = status

        upserted += 1

    db.commit()

    window_end = now_utc + timedelta(days=7)
    active_window_count = (
        db.query(EconomicNewsEvent)
        .filter(EconomicNewsEvent.event_time_utc >= now_utc - timedelta(days=1))
        .filter(EconomicNewsEvent.event_time_utc <= window_end)
        .count()
    )

    return {
        "generated": len(occurrences),
        "upserted": upserted,
        "activeWindowCount": active_window_count,
    }


# ---------------------------------------------------------------------------
# Background sync loop
# ---------------------------------------------------------------------------

def _seconds_to_next_high_impact(db: Session, now_utc: datetime | None = None) -> float | None:
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)
    row = (
        db.query(EconomicNewsEvent)
        .filter(EconomicNewsEvent.impact == "high")
        .filter(EconomicNewsEvent.event_time_utc >= now_utc)
        .order_by(EconomicNewsEvent.event_time_utc.asc())
        .first()
    )
    if row is None:
        return None
    return (row.event_time_utc - now_utc).total_seconds()


async def run_news_radar_sync() -> None:
    """Background task: regenerates/upserts the organized calendar on an
    adaptive interval -- 60s if a high-impact event is within 30 minutes,
    otherwise 300s. Runs forever; never raises out of the loop. Does not
    send Telegram alerts (Phase 1 constraint -- see Phase 2 contract)."""
    while True:
        next_high_impact_seconds: float | None = None
        db = SessionLocal()
        try:
            now_utc = datetime.now(timezone.utc)
            sync_calendar_events(db, now_utc=now_utc)
            next_high_impact_seconds = _seconds_to_next_high_impact(db, now_utc=now_utc)
        except Exception as exc:
            logger.warning("news_radar_sync: cycle failed -- %s", exc)
        finally:
            db.close()

        if next_high_impact_seconds is not None and next_high_impact_seconds <= 1800:
            await asyncio.sleep(60)
        else:
            await asyncio.sleep(300)
```

- [ ] **Step 2: Verify**

```bash
cd mt5_readonly_service
python -m py_compile economic_calendar.py
```

Expected: no output, exit code 0.

```bash
python -c "
from datetime import datetime, timezone
from database import SessionLocal, init_db
from economic_calendar import sync_calendar_events, generate_occurrences, compute_status, is_in_risk_window

init_db()
now = datetime.now(timezone.utc)
occs = generate_occurrences(now)
print('generated:', len(occs))
db = SessionLocal()
try:
    result = sync_calendar_events(db, now_utc=now)
    print('sync result:', result)
finally:
    db.close()
"
```

Expected: `generated: <N>` with N > 0, and `sync result: {'generated': N, 'upserted': N, 'activeWindowCount': M}` with M > 0.

- [ ] **Step 3: Commit**

```bash
git add mt5_readonly_service/economic_calendar.py
git commit -m "feat: add organized semi-dynamic economic calendar (News Radar Phase 1)"
```

---

## Task 3: Add 3 endpoints to `main.py`

**Files:**
- Modify: `mt5_readonly_service/main.py:31` (extend `database` import)
- Modify: `mt5_readonly_service/main.py:33` (add `economic_calendar` import)
- Modify: `mt5_readonly_service/main.py:2449` (insert 3 endpoints before the "System Configuration endpoints" section)

- [ ] **Step 1: Extend imports**

Current line 31:

```python
from database import DecisionJournal, GoldProAnalysis, MT5OpenPosition, MT5TradeHistory, SessionLocal, StrategySignal, SystemConfig, TelegramSubscriber, TripleFirewallSignal, get_db, init_db
```

Change to:

```python
from database import DecisionJournal, EconomicNewsEvent, GoldProAnalysis, MT5OpenPosition, MT5TradeHistory, SessionLocal, StrategySignal, SystemConfig, TelegramSubscriber, TripleFirewallSignal, get_db, init_db
```

Current line 33:

```python
from mt5_trade_sync import run_mt5_trade_sync, sync_mt5_trades_once
```

Add a new line directly after it:

```python
from mt5_trade_sync import run_mt5_trade_sync, sync_mt5_trades_once
from economic_calendar import compute_status, is_in_risk_window, run_news_radar_sync, sync_calendar_events
```

- [ ] **Step 2: Insert the 3 endpoints**

Insert immediately before the `# System Configuration endpoints` section comment (currently starting at line 2451 in `main.py`, right after `api_trade_history_summary` ends):

```python
# ---------------------------------------------------------------------------
# News Radar endpoints (organized semi-dynamic economic calendar)
# Read-only -- no external API, no live news feed, no Telegram (Phase 1).
# ---------------------------------------------------------------------------

@app.get("/api/news-radar/events")
def api_news_radar_events(
    impact: str | None = Query(default=None),
    currency: str | None = Query(default=None),
    symbol: str | None = Query(default=None),
    days_ahead: int = Query(default=7, ge=1, le=14),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """
    قائمة الأحداث الاقتصادية المنظمة (شبه ديناميكية) ضمن نافذة زمنية.
    الحالة (status) تُحسب ديناميكياً عند كل قراءة. قراءة فقط -- ليست توصية مالية.
    """
    now_utc = datetime.now(timezone.utc)
    window_start = now_utc - timedelta(days=1)
    window_end = now_utc + timedelta(days=days_ahead)

    query = db.query(EconomicNewsEvent).filter(
        EconomicNewsEvent.event_time_utc >= window_start,
        EconomicNewsEvent.event_time_utc <= window_end,
    )
    if impact:
        query = query.filter(EconomicNewsEvent.impact == impact)
    if currency:
        query = query.filter(EconomicNewsEvent.currency == currency)

    rows = query.order_by(EconomicNewsEvent.event_time_utc.asc()).all()

    events: list[dict] = []
    for row in rows:
        data = row.to_dict()
        if symbol and symbol not in data["affectedSymbols"]:
            continue
        data["status"] = compute_status(row.event_time_utc, now_utc)
        data["secondsToEvent"] = (row.event_time_utc - now_utc).total_seconds()
        events.append(data)

    return Utf8JsonResponse(content={"ok": True, "total": len(events), "events": events})


@app.post("/api/news-radar/refresh-now")
def api_news_radar_refresh_now(db: Session = Depends(get_db)) -> JSONResponse:
    """
    تشغيل دورة تحديث فورية للتقويم الاقتصادي المنظم (يدوي/تشخيصي) -- نفس
    منطق الحلقة الخلفية. لا يتصل بأي مصدر خارجي، فقط يولّد/يحدّث الصفوف
    من القوالب الثابتة. قراءة/تحليل فقط.
    """
    now_utc = datetime.now(timezone.utc)
    sync_calendar_events(db, now_utc=now_utc)

    window_end = now_utc + timedelta(days=7)
    rows = (
        db.query(EconomicNewsEvent)
        .filter(EconomicNewsEvent.event_time_utc >= now_utc - timedelta(days=1))
        .filter(EconomicNewsEvent.event_time_utc <= window_end)
        .order_by(EconomicNewsEvent.event_time_utc.asc())
        .all()
    )

    events: list[dict] = []
    for row in rows:
        data = row.to_dict()
        data["status"] = compute_status(row.event_time_utc, now_utc)
        data["secondsToEvent"] = (row.event_time_utc - now_utc).total_seconds()
        events.append(data)

    return Utf8JsonResponse(content={
        "ok": True,
        "lastUpdated": now_utc.isoformat(),
        "lastUpdatedBaghdad": (now_utc + timedelta(hours=3)).isoformat(),
        "total": len(events),
        "events": events,
    })


@app.get("/api/news-radar/top-bar")
def api_news_radar_top_bar(db: Session = Depends(get_db)) -> JSONResponse:
    """
    شريط "ساعات الأخبار المهمة": أقرب حدث قادم + هل نحن داخل منطقة خطر
    خبرية الآن (خبر عالي التأثير ضمن -5/+15 دقيقة). قراءة فقط.
    """
    now_utc = datetime.now(timezone.utc)

    next_row = (
        db.query(EconomicNewsEvent)
        .filter(EconomicNewsEvent.event_time_utc >= now_utc)
        .order_by(EconomicNewsEvent.event_time_utc.asc())
        .first()
    )
    next_event: dict | None = None
    if next_row is not None:
        next_event = next_row.to_dict()
        next_event["status"] = compute_status(next_row.event_time_utc, now_utc)
        next_event["secondsToEvent"] = (next_row.event_time_utc - now_utc).total_seconds()

    high_impact_rows = (
        db.query(EconomicNewsEvent)
        .filter(EconomicNewsEvent.impact == "high")
        .filter(EconomicNewsEvent.event_time_utc >= now_utc - timedelta(hours=1))
        .filter(EconomicNewsEvent.event_time_utc <= now_utc + timedelta(hours=1))
        .all()
    )

    risk_events: list[dict] = []
    for row in high_impact_rows:
        if is_in_risk_window(row.event_time_utc, now_utc, row.impact):
            data = row.to_dict()
            data["status"] = compute_status(row.event_time_utc, now_utc)
            data["secondsToEvent"] = (row.event_time_utc - now_utc).total_seconds()
            risk_events.append(data)

    in_risk_window = len(risk_events) > 0
    risk_warning: str | None = None
    if in_risk_window:
        first = risk_events[0]
        assets = " أو ".join(first["affectedSymbols"]) if first["affectedSymbols"] else "الأصول المرتبطة"
        risk_warning = (
            f"تحذير: يوجد خبر عالي التأثير قريب/جارٍ ({first['title']}). "
            f"يفضل الحذر من فتح صفقات جديدة على {assets} حتى انتهاء فترة الخبر."
        )

    return Utf8JsonResponse(content={
        "ok": True,
        "nextEvent": next_event,
        "inRiskWindow": in_risk_window,
        "riskWarning": risk_warning,
        "riskEvents": risk_events,
    })


```

- [ ] **Step 3: Verify**

```bash
cd mt5_readonly_service
python -m py_compile main.py
```

Expected: no output, exit code 0.

---

## Task 4: Register `run_news_radar_sync()` in `_startup()`

**Files:**
- Modify: `mt5_readonly_service/main.py:818`

- [ ] **Step 1: Add the background task registration**

Current `_startup()` (lines 808-818):

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

Add one line after `run_mt5_trade_sync()`:

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
    asyncio.create_task(run_news_radar_sync())
```

- [ ] **Step 2: Verify**

```bash
cd mt5_readonly_service
python -m py_compile main.py database.py economic_calendar.py
```

Expected: no output, exit code 0 for all three.

```bash
python -c "import ast; ast.parse(open('main.py', encoding='utf-8').read()); print('main.py syntax ok')"
```

Expected: `main.py syntax ok`.

- [ ] **Step 3: Commit**

```bash
git add mt5_readonly_service/main.py
git commit -m "feat: add News Radar endpoints and background sync task"
```

> Manual smoke test (requires the service running -- `uvicorn main:app --host 127.0.0.1 --port 8010 --reload`):
> ```bash
> curl -s -X POST http://127.0.0.1:8010/api/news-radar/refresh-now
> curl -s "http://127.0.0.1:8010/api/news-radar/events?days_ahead=7"
> curl -s http://127.0.0.1:8010/api/news-radar/top-bar
> ```
> Each should return `"ok": true` with non-empty `events`/`nextEvent`.

---

## Task 5: Create 3 Next.js proxy routes

**Files:**
- Create: `src/app/api/news-radar/events/route.ts`
- Create: `src/app/api/news-radar/refresh-now/route.ts`
- Create: `src/app/api/news-radar/top-bar/route.ts`

These follow the exact pattern of `src/app/api/trade-history/closed/route.ts` (GET, query passthrough) and `src/app/api/trade-history/sync-now/route.ts` (POST).

- [ ] **Step 1: `src/app/api/news-radar/events/route.ts`**

```ts
/**
 * Read-only proxy for the organized economic calendar (News Radar).
 * Proxies GET http://127.0.0.1:8010/api/news-radar/events
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
  const u = new URL(`${MT5_SERVICE_BASE}/api/news-radar/events`);
  for (const key of ["impact", "currency", "symbol", "days_ahead"] as const) {
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
      { ok: false, total: 0, events: [], error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها" },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 2: `src/app/api/news-radar/refresh-now/route.ts`**

```ts
/**
 * Triggers one immediate organized-calendar refresh cycle (News Radar).
 * Read-only / analysis-only -- does not place, close, or modify any order.
 * Proxies POST http://127.0.0.1:8010/api/news-radar/refresh-now
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
    const res = await fetch(`${MT5_SERVICE_BASE}/api/news-radar/refresh-now`, {
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
      { ok: false, total: 0, events: [], error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها" },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 3: `src/app/api/news-radar/top-bar/route.ts`**

```ts
/**
 * Read-only proxy for the News Radar "important news hours" top bar.
 * Proxies GET http://127.0.0.1:8010/api/news-radar/top-bar
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
    const res = await fetch(`${MT5_SERVICE_BASE}/api/news-radar/top-bar`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { ok: false, nextEvent: null, inRiskWindow: false, riskWarning: null, riskEvents: [], error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها" },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 4: Verify**

```bash
pnpm exec tsc --noEmit
```

Expected: `EXIT:0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/news-radar
git commit -m "feat: add News Radar proxy routes (events, refresh-now, top-bar)"
```

---

## Task 6: Rebuild `src/app/(dashboard)/reports/page.tsx`

**Files:**
- Modify: `src/app/(dashboard)/reports/page.tsx` (full rewrite, 462 -> ~330 lines)

This replaces the static `DEMO_EVENTS` page with one driven by the 3 endpoints from Task 5: a top "important news hours" bar with a live client-side countdown, a risk-zone warning banner, a manual refresh button with "last updated" timestamp, currency/asset filters, and a table.

- [ ] **Step 1: Write the full page**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock, FileText, RefreshCw } from "lucide-react";

interface NewsEvent {
  id: number;
  source: string;
  eventId: string;
  title: string;
  currency: string;
  impact: string; // high | medium | low
  eventTimeUtc: string;
  eventTimeBaghdad: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  affectedSymbols: string[];
  status: string; // upcoming | imminent | released | risk_ended
  secondsToEvent: number;
}

interface EventsResponse {
  ok: boolean;
  total: number;
  events: NewsEvent[];
  error?: string;
}

interface RefreshResponse extends EventsResponse {
  lastUpdated?: string;
  lastUpdatedBaghdad?: string;
}

interface TopBarResponse {
  ok: boolean;
  nextEvent: NewsEvent | null;
  inRiskWindow: boolean;
  riskWarning: string | null;
  riskEvents: NewsEvent[];
  error?: string;
}

type FilterKey = "all" | "high" | "USD" | "EUR" | "GBP" | "XAUUSD" | "crypto";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "high", label: "أخبار عالية التأثير" },
  { key: "USD", label: "USD" },
  { key: "EUR", label: "EUR" },
  { key: "GBP", label: "GBP" },
  { key: "XAUUSD", label: "XAUUSD" },
  { key: "crypto", label: "Crypto" },
];

const IMPACT_META: Record<string, { label: string; className: string }> = {
  high:   { label: "عالي",   className: "border-red-700 bg-red-950/40 text-red-300" },
  medium: { label: "متوسط",  className: "border-amber-700 bg-amber-950/40 text-amber-300" },
  low:    { label: "منخفض",  className: "border-slate-700 bg-slate-800 text-slate-400" },
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  upcoming:   { label: "قادم",            className: "border-slate-700 bg-slate-800 text-slate-300" },
  imminent:   { label: "قريب جدًا",        className: "border-amber-700 bg-amber-950/40 text-amber-300" },
  released:   { label: "صدر",             className: "border-blue-700 bg-blue-950/40 text-blue-300" },
  risk_ended: { label: "انتهت فترة الخطر", className: "border-green-800 bg-green-950/30 text-green-400" },
};

function formatBaghdad(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}

function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function isCryptoEvent(ev: NewsEvent): boolean {
  return ev.affectedSymbols.some((s) => s.endsWith("-USDT") || s.startsWith("BTC") || s.startsWith("ETH"));
}

function ImpactBadge({ impact }: { impact: string }) {
  const meta = IMPACT_META[impact] ?? IMPACT_META.low;
  return (
    <span className={`rounded border px-2 py-0.5 text-xs ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.upcoming;
  return (
    <span className={`rounded border px-2 py-0.5 text-xs ${meta.className}`}>
      {meta.label}
    </span>
  );
}

export default function NewsRadarPage() {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [topBar, setTopBar] = useState<TopBarResponse | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventsRes, topBarRes] = await Promise.all([
        fetch("/api/news-radar/events?days_ahead=7", { cache: "no-store" }),
        fetch("/api/news-radar/top-bar", { cache: "no-store" }),
      ]);
      const [eventsBody, topBarBody]: [EventsResponse, TopBarResponse] = await Promise.all([
        eventsRes.json(),
        topBarRes.json(),
      ]);
      if (!eventsBody.ok || !topBarBody.ok) {
        setError(eventsBody.error ?? topBarBody.error ?? "تعذّر تحميل رادار الأخبار");
      }
      setEvents(eventsBody.events ?? []);
      setTopBar(topBarBody);
      setLoadedAt(Date.now());
    } catch {
      setError("تعذّر الاتصال بخدمة MT5 المحلية");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Live countdown tick -- client-side only, no extra API calls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Adaptive auto-refresh: 60s if in a risk window or a high-impact event
  // is within 30 minutes, otherwise 300s.
  useEffect(() => {
    const next = topBar?.nextEvent;
    const highImpactSoon =
      !!next && next.impact === "high" && next.secondsToEvent >= 0 && next.secondsToEvent <= 1800;
    const intervalMs = topBar?.inRiskWindow || highImpactSoon ? 60_000 : 300_000;
    const id = setInterval(() => {
      loadAll();
    }, intervalMs);
    return () => clearInterval(id);
  }, [topBar, loadAll]);

  const syncNow = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/news-radar/refresh-now", { method: "POST", cache: "no-store" });
      const body: RefreshResponse = await res.json();
      if (!body.ok) {
        setError(body.error ?? "تعذّر تحديث الأخبار");
        return;
      }
      setEvents(body.events ?? []);
      if (body.lastUpdatedBaghdad) setLastUpdated(body.lastUpdatedBaghdad);

      const topBarRes = await fetch("/api/news-radar/top-bar", { cache: "no-store" });
      const topBarBody: TopBarResponse = await topBarRes.json();
      setTopBar(topBarBody);
      setLoadedAt(Date.now());
    } catch {
      setError("تعذّر الاتصال بخدمة MT5 المحلية");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const filteredEvents = events.filter((ev) => {
    switch (filter) {
      case "all":
        return true;
      case "high":
        return ev.impact === "high";
      case "USD":
      case "EUR":
      case "GBP":
        return ev.currency === filter;
      case "XAUUSD":
        return ev.affectedSymbols.includes("XAUUSD");
      case "crypto":
        return isCryptoEvent(ev);
      default:
        return true;
    }
  });

  const nextEvent = topBar?.nextEvent ?? null;
  const remainingSeconds = nextEvent
    ? Math.max(0, nextEvent.secondsToEvent - (now - loadedAt) / 1000)
    : null;

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/25">
            <FileText className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">رادار الأخبار الاقتصادية</h1>
            <p className="text-xs text-muted-foreground">
              تقويم اقتصادي منظم لأهم الأخبار المؤثرة على الذهب والدولار والعملات الرقمية
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950 p-2 text-xs text-red-400">
            ⚠️ {error}
          </div>
        )}

        {/* Top bar: next important news event */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-700 pb-2">
            <p className="text-xs uppercase tracking-widest text-slate-500">الخبر القادم</p>
            <Clock className="h-4 w-4 text-slate-500" />
          </div>

          {nextEvent ? (
            <div className="grid gap-3 grid-cols-2 md:grid-cols-5 text-sm">
              <div className="col-span-2 md:col-span-2">
                <p className="text-slate-200 font-bold">{nextEvent.title}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {formatBaghdad(nextEvent.eventTimeBaghdad)} (بتوقيت بغداد)
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">المتبقي</p>
                <p className="font-mono text-amber-300 text-lg">
                  {remainingSeconds !== null ? formatCountdown(remainingSeconds) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">التأثير</p>
                <ImpactBadge impact={nextEvent.impact} />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">الأصول المتأثرة</p>
                <p className="text-slate-300 text-xs">{nextEvent.affectedSymbols.join(" / ")}</p>
              </div>
            </div>
          ) : (
            <p className="text-center text-sm text-slate-500 py-4">لا توجد أخبار قادمة ضمن الأيام القادمة</p>
          )}
        </div>

        {/* Semi-dynamic calendar disclaimer */}
        <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-300">
          ⚠️ تقويم أخبار منظم تجريبي/شبه ديناميكي، وليس مصدر أخبار اقتصادي مباشر. سيتم ربط مصدر أخبار حقيقي لاحقًا.
        </div>

        {/* Risk-zone warning banner */}
        {topBar?.inRiskWindow && topBar.riskWarning && (
          <div className="flex items-start gap-2 rounded-lg border border-red-700 bg-red-950/40 p-3 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{topBar.riskWarning}</p>
          </div>
        )}

        {/* Refresh bar */}
        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-900 p-3">
          <button
            onClick={syncNow}
            disabled={refreshing}
            className="flex items-center gap-1 rounded border border-amber-700 px-3 py-1 text-xs text-amber-300 hover:bg-amber-950 disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" />
            {refreshing ? "جاري التحديث..." : "تحديث الأخبار الآن"}
          </button>
          <p className="text-xs text-slate-500">
            آخر تحديث: {lastUpdated ? formatBaghdad(lastUpdated) : "—"} (بتوقيت بغداد)
            {loading && " — جاري التحميل..."}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded border px-3 py-1 text-xs transition-colors ${
                filter === f.key
                  ? "border-amber-600 bg-amber-950/40 text-amber-300"
                  : "border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Events table */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-2">
            <p className="text-xs uppercase tracking-widest text-slate-500">
              الأحداث الاقتصادية (الأيام السبعة القادمة)
            </p>
          </div>

          {filteredEvents.length === 0 && !loading && (
            <p className="text-center text-sm text-slate-500 py-6">لا توجد أحداث مطابقة للفلتر المحدد</p>
          )}

          {filteredEvents.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-500">
                    <th className="p-2 text-right">الوقت (بغداد)</th>
                    <th className="p-2 text-right">العملة</th>
                    <th className="p-2 text-right">الخبر</th>
                    <th className="p-2 text-right">التأثير</th>
                    <th className="p-2 text-right">السابق</th>
                    <th className="p-2 text-right">المتوقع</th>
                    <th className="p-2 text-right">الفعلي</th>
                    <th className="p-2 text-right">الحالة</th>
                    <th className="p-2 text-right">الأصول المتأثرة</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((ev) => (
                    <tr key={ev.eventId} className="border-b border-slate-800">
                      <td className="p-2 text-slate-400 whitespace-nowrap">{formatBaghdad(ev.eventTimeBaghdad)}</td>
                      <td className="p-2 font-bold text-slate-200">{ev.currency}</td>
                      <td className="p-2 text-slate-200">{ev.title}</td>
                      <td className="p-2"><ImpactBadge impact={ev.impact} /></td>
                      <td className="p-2 text-slate-400">{ev.previous ?? "—"}</td>
                      <td className="p-2 text-slate-400">{ev.forecast ?? "—"}</td>
                      <td className="p-2 text-slate-500" title="غير متاح — يتطلب مصدر بيانات حي">
                        {ev.actual ?? "—"}
                      </td>
                      <td className="p-2"><StatusBadge status={ev.status} /></td>
                      <td className="p-2 text-slate-400">{ev.affectedSymbols.join(" / ")}</td>
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

- [ ] **Step 2: Verify**

```bash
pnpm exec tsc --noEmit
```

Expected: `EXIT:0`.

```bash
pnpm run build
```

Expected: successful build, `/reports` and `/api/news-radar/*` listed among the routes.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/reports/page.tsx"
git commit -m "feat: rebuild /reports page with News Radar top bar, risk warning, and filters"
```

---

## Task 7: Document the Phase 2 `getNewsRiskContext` contract (design only -- no implementation)

**Files:**
- No code changes. This task only confirms the contract is documented for Phase 2; it already exists in `docs/superpowers/specs/2026-06-12-news-radar-phase-1-design.md` section 8.

- [ ] **Step 1: Confirm the contract is present**

The design doc (section 8) already specifies the future function signature and return shape:

```python
def get_news_risk_context(symbol: str, timeframe: str, db: Session,
                           now_utc: datetime | None = None) -> dict:
    """
    Returns:
    {
        "symbol": str,
        "timeframe": str,
        "hasNearbyNews": bool,
        "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "EXTREME",
        "nextEvent": dict | None,
        "minutesToEvent": float | None,
        "affectedSymbols": list[str],
        "shouldReduceConfidence": bool,
        "shouldForceWait": bool,
        "arabicExplanation": str,
    }
    """
```

No new file (`mt5_readonly_service/news_risk.py`) is created in Phase 1. This task is a confirmation checkpoint only -- Phase 1 delivers exactly the data (`economic_news_events`) this function will query in Phase 2, with no code written against it yet.

- [ ] **Step 2: No commit** (no files changed in this task)

---

## Final Verification (all tasks)

Run from the repository root after Tasks 1-6 are complete:

```bash
cd mt5_readonly_service
python -m py_compile main.py database.py economic_calendar.py
cd ..
pnpm exec tsc --noEmit
pnpm run build
```

All four must succeed (`py_compile` silent / exit 0, `tsc --noEmit` -> `EXIT:0`, `pnpm run build` -> success including `/reports` and `/api/news-radar/*`).

Safety greps (must return no matches in any new/modified file):

```bash
git diff --name-only | xargs grep -nE "order_send|order_close|order_modify|order_check|OrderSend" 2>/dev/null
git status --short -- convex/
```

Expected: first command prints nothing; second command prints nothing (no Convex changes).

Manual checks on `/reports`:
1. Top bar shows the next event with title, Baghdad time, a live countdown ticking every second, impact badge, and affected assets.
2. The semi-dynamic-calendar disclaimer is visible directly under the top bar.
3. "تحديث الأخبار الآن" updates the table and "آخر تحديث" timestamp without a full page reload.
4. Filters (الكل / عالي التأثير / USD / EUR / GBP / XAUUSD / Crypto) correctly narrow the table client-side.
5. If any event is currently within its risk window, the red risk banner appears with the Arabic warning text from `topBar.riskWarning`.
6. The "الفعلي" column always shows "—".

---

## What Remains for Phase 2 (not in this plan)

- Create `mt5_readonly_service/news_risk.py` implementing `get_news_risk_context(symbol, timeframe, db, now_utc=None)` per the contract in Task 7 / design doc section 8.
- Add `news: dict | None = None` to `CouncilVerdict` (agents.py:426-448) and call `get_news_risk_context()` from `CouncilEngine.analyze_market`.
- "Reduce confidence" / "force WAIT" logic when a weak recommendation coincides with a nearby high-impact event.
- A "news impact" section in the recommendation card (frontend).
- A "news impact" paragraph in the Telegram message, with its own per-(symbol, event_id) throttling to avoid duplicate alerts.
- No changes to `convex/` in either phase.
