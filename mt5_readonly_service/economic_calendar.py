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
