# Telegram Subscribers Management Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/telegram-subscribers` dashboard page where the owner can see how many people are subscribed to bot recommendations (active / blocked / total), view their details, and block/unblock specific subscribers — blocking also prevents `/start` from re-subscribing them until unblocked.

**Architecture:** One new SQLite column (`is_blocked`) added to the existing `telegram_subscribers` table via a safe `ALTER TABLE` migration guard in `init_db()`. Two new helper functions in `telegram_subscribers.py` plus a guard in the `/start` handler. Three new read/management FastAPI endpoints in `main.py`. Three new Next.js proxy routes (Clerk-authenticated) and one new client page + nav entry.

**Tech Stack:** FastAPI, SQLAlchemy/SQLite, Next.js App Router, Clerk auth, Tailwind, lucide-react.

**Reference spec:** `docs/superpowers/specs/2026-06-11-telegram-subscribers-management-design.md`

---

## Pre-flight verification (already done — recorded for the record)

Before this plan, the base subscriber system was verified working:
- `mt5_readonly_service/telegram_subscribers.py` exists (15.4 KB, contains `upsert_subscriber`, `deactivate_subscriber`, `get_active_subscribers`, `format_recommendation_message`, `broadcast_recommendation`, `_handle_update`, `_poll_once`, `run_telegram_bot_polling`).
- `main.py:32` imports `run_telegram_bot_polling`; `main.py:780` calls `asyncio.create_task(run_telegram_bot_polling())` in `_startup()`.
- `agents.py:1178-1182` calls `broadcast_recommendation(winner, db)` after `_send_telegram_alert(winner)` inside `if send_alert:`.
- `_poll_once` uses `requests.get(f"https://api.telegram.org/bot{token}/getUpdates", ...)` — polling, not webhook.
- `/start` handler (`_handle_update`, command `"/start"`) calls `upsert_subscriber(...)` (sets `is_active=1`, stores `telegram_user_id`, `chat_id`, `username`, `first_name`, `last_name`) and replies with `_START_TEXT` (Arabic welcome).
- `local_quant.db` already contains 4 real active subscriber rows from a live `/start` test — confirms the end-to-end flow works.

No further base-system work is needed. This plan only adds the management page.

---

### Task 1: Add `is_blocked` column + safe SQLite migration

**Files:**
- Modify: `mt5_readonly_service/database.py`

- [ ] **Step 1: Add the column to the model**

In `mt5_readonly_service/database.py`, find the `TelegramSubscriber` class (line 320) and the `is_active` column (line 338):

```python
    is_active         = Column(Integer, nullable=False, default=1)  # 0/1 boolean
```

Add a new line directly after it:

```python
    is_active         = Column(Integer, nullable=False, default=1)  # 0/1 boolean
    is_blocked        = Column(Integer, nullable=False, default=0)  # 0/1 boolean
```

- [ ] **Step 2: Add `isBlocked` to `to_dict()`**

Find `to_dict()` in the same class (line 343-355):

```python
    def to_dict(self) -> dict:
        return {
            "id":              self.id,
            "telegramUserId":  self.telegram_user_id,
            "chatId":          self.chat_id,
            "username":        self.username,
            "firstName":       self.first_name,
            "lastName":        self.last_name,
            "isActive":        bool(self.is_active),
            "createdAt":       self.created_at.isoformat() if self.created_at else None,
            "updatedAt":       self.updated_at.isoformat() if self.updated_at else None,
            "lastStartAt":     self.last_start_at.isoformat() if self.last_start_at else None,
        }
```

Add `"isBlocked"` after `"isActive"`:

```python
    def to_dict(self) -> dict:
        return {
            "id":              self.id,
            "telegramUserId":  self.telegram_user_id,
            "chatId":          self.chat_id,
            "username":        self.username,
            "firstName":       self.first_name,
            "lastName":        self.last_name,
            "isActive":        bool(self.is_active),
            "isBlocked":       bool(self.is_blocked),
            "createdAt":       self.created_at.isoformat() if self.created_at else None,
            "updatedAt":       self.updated_at.isoformat() if self.updated_at else None,
            "lastStartAt":     self.last_start_at.isoformat() if self.last_start_at else None,
        }
```

- [ ] **Step 3: Add `inspect` and `text` to the SQLAlchemy import**

Find the import block (lines 22-33):

```python
from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
)
```

Add `inspect` and `text`:

```python
from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
    inspect,
    text,
)
```

- [ ] **Step 4: Add the migration guard function and call it from `init_db()`**

Find `init_db()` (lines 439-445):

```python
def init_db() -> None:
    """
    Create all tables that do not yet exist.
    Idempotent: safe to call on every service startup.
    Existing data is never dropped or altered.
    """
    Base.metadata.create_all(bind=engine)
```

Replace with:

```python
def _ensure_telegram_subscriber_columns() -> None:
    """
    Base.metadata.create_all() only creates missing TABLES, not missing
    COLUMNS on tables that already exist. telegram_subscribers was created
    by an earlier stage and already has rows, so a new column added to the
    model needs an explicit ALTER TABLE here. Idempotent and additive --
    existing rows get the column's DEFAULT value, nothing is dropped.
    """
    inspector = inspect(engine)
    if "telegram_subscribers" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("telegram_subscribers")}
    if "is_blocked" not in columns:
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE telegram_subscribers ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0"
            ))


def init_db() -> None:
    """
    Create all tables that do not yet exist.
    Idempotent: safe to call on every service startup.
    Existing data is never dropped or altered.
    """
    Base.metadata.create_all(bind=engine)
    _ensure_telegram_subscriber_columns()
```

- [ ] **Step 5: Compile-check**

```bash
cd mt5_readonly_service
PY="C:/Users/Lenovo/AppData/Local/Programs/Python/Python312/python.exe"
"$PY" -m py_compile database.py
```
Expected: no output.

- [ ] **Step 6: Verify the migration runs against the existing DB and is idempotent**

```bash
cd mt5_readonly_service
PY="C:/Users/Lenovo/AppData/Local/Programs/Python/Python312/python.exe"
"$PY" -c "
from database import init_db, SessionLocal, TelegramSubscriber
from sqlalchemy import inspect, text

# Run twice -- must not error the second time
init_db()
init_db()

with SessionLocal().bind.connect() as conn:
    cols = [c['name'] for c in inspect(conn).get_columns('telegram_subscribers')]
    print('columns:', cols)
    assert 'is_blocked' in cols

db = SessionLocal()
row = db.query(TelegramSubscriber).first()
print('existing row isBlocked:', row.to_dict()['isBlocked'])
db.close()
"
```
Expected:
```
columns: [..., 'is_blocked']
existing row isBlocked: False
```
(The existing row's `is_blocked` defaults to `0`/`False` -- no data loss.)

- [ ] **Step 7: Commit**

```bash
git add mt5_readonly_service/database.py
git commit -m "feat(telegram): add is_blocked column with safe SQLite migration"
```

---

### Task 2: `block_subscriber` / `unblock_subscriber` + `/start` blocked-check

**Files:**
- Modify: `mt5_readonly_service/telegram_subscribers.py`

- [ ] **Step 1: Add the two new functions after `deactivate_subscriber`**

In `mt5_readonly_service/telegram_subscribers.py`, find `deactivate_subscriber` (around line 107-114):

```python
def deactivate_subscriber(db: Session, chat_id: str) -> None:
    """Set is_active=0 for a subscriber. Never deletes the row."""
    row = db.query(TelegramSubscriber).filter(TelegramSubscriber.chat_id == chat_id).first()
    if row is None:
        return
    row.is_active = 0
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
```

Add immediately after it:

```python
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
```

- [ ] **Step 2: Add `_BLOCKED_TEXT` message constant**

Find `_STOP_TEXT` (around line 279):

```python
_STOP_TEXT = "تم إيقاف استقبال التوصيات. يمكنك الاشتراك مرة أخرى بإرسال /start"
```

Add after it:

```python
_BLOCKED_TEXT = (
    "تم تقييد وصولك إلى هذا البوت من قبل الإدارة.\n"
    "لإعادة التفعيل يرجى التواصل مع المسؤول."
)
```

- [ ] **Step 3: Reject `/start` for blocked subscribers in `_handle_update`**

Find the `/start` branch in `_handle_update` (around line 324-332):

```python
    if command == "/start":
        upsert_subscriber(
            db,
            telegram_user_id=user_id,
            chat_id=chat_id,
            username=from_user.get("username"),
            first_name=from_user.get("first_name"),
            last_name=from_user.get("last_name"),
        )
        _send_message(token, chat_id, _START_TEXT, proxy_url)
```

Replace with:

```python
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
```

- [ ] **Step 4: Compile-check**

```bash
cd mt5_readonly_service
PY="C:/Users/Lenovo/AppData/Local/Programs/Python/Python312/python.exe"
"$PY" -m py_compile telegram_subscribers.py
```
Expected: no output.

- [ ] **Step 5: Manual verification of block/unblock + blocked `/start`**

```bash
cd mt5_readonly_service
PY="C:/Users/Lenovo/AppData/Local/Programs/Python/Python312/python.exe"
PYTHONIOENCODING=utf-8 "$PY" -c "
from database import init_db, SessionLocal
import telegram_subscribers as ts

init_db()
db = SessionLocal()

sent = []
ts._send_message = lambda token, chat_id, text, proxy_url=None: sent.append((chat_id, text))

# subscribe via /start
ts._handle_update(db, {
    'update_id': 1,
    'message': {'text': '/start', 'chat': {'id': 555444}, 'from': {'id': 555444, 'username': 'blockme', 'first_name': 'B'}},
}, token='FAKE', proxy_url=None)
print('active after start:', db.query(ts.TelegramSubscriber).filter(ts.TelegramSubscriber.chat_id == '555444').first().is_active)

# block
ts.block_subscriber(db, '555444')
row = db.query(ts.TelegramSubscriber).filter(ts.TelegramSubscriber.chat_id == '555444').first()
print('after block: is_active=%s is_blocked=%s' % (row.is_active, row.is_blocked))

# blocked user tries /start again -- must NOT reactivate, must get _BLOCKED_TEXT
ts._handle_update(db, {
    'update_id': 2,
    'message': {'text': '/start', 'chat': {'id': 555444}, 'from': {'id': 555444, 'username': 'blockme', 'first_name': 'B'}},
}, token='FAKE', proxy_url=None)
row = db.query(ts.TelegramSubscriber).filter(ts.TelegramSubscriber.chat_id == '555444').first()
print('after blocked /start: is_active=%s is_blocked=%s' % (row.is_active, row.is_blocked))
print('last reply:', sent[-1][1])

# unblock
ts.unblock_subscriber(db, '555444')
row = db.query(ts.TelegramSubscriber).filter(ts.TelegramSubscriber.chat_id == '555444').first()
print('after unblock: is_active=%s is_blocked=%s' % (row.is_active, row.is_blocked))

# /start again after unblock -- must reactivate
ts._handle_update(db, {
    'update_id': 3,
    'message': {'text': '/start', 'chat': {'id': 555444}, 'from': {'id': 555444, 'username': 'blockme', 'first_name': 'B'}},
}, token='FAKE', proxy_url=None)
row = db.query(ts.TelegramSubscriber).filter(ts.TelegramSubscriber.chat_id == '555444').first()
print('after re-start: is_active=%s is_blocked=%s' % (row.is_active, row.is_blocked))

# cleanup
db.query(ts.TelegramSubscriber).filter(ts.TelegramSubscriber.chat_id == '555444').delete()
db.commit()
db.close()
"
```
Expected:
```
active after start: 1
after block: is_active=0 is_blocked=1
after blocked /start: is_active=0 is_blocked=1
last reply: تم تقييد وصولك إلى هذا البوت من قبل الإدارة.
لإعادة التفعيل يرجى التواصل مع المسؤول.
after unblock: is_active=0 is_blocked=0
after re-start: is_active=1 is_blocked=0
```

- [ ] **Step 6: Commit**

```bash
git add mt5_readonly_service/telegram_subscribers.py
git commit -m "feat(telegram): add block/unblock subscriber controls"
```

---

### Task 3: FastAPI endpoints — list, block, unblock

**Files:**
- Modify: `mt5_readonly_service/main.py`

- [ ] **Step 1: Add the import for the new helper functions**

Find the existing import (line 32):

```python
from telegram_subscribers import run_telegram_bot_polling
```

Replace with:

```python
from telegram_subscribers import block_subscriber, run_telegram_bot_polling, unblock_subscriber
```

- [ ] **Step 2: Add `TelegramSubscriber` to the `database` import**

Find line 31:

```python
from database import DecisionJournal, GoldProAnalysis, SessionLocal, StrategySignal, SystemConfig, TripleFirewallSignal, get_db, init_db
```

Replace with:

```python
from database import DecisionJournal, GoldProAnalysis, SessionLocal, StrategySignal, SystemConfig, TelegramSubscriber, TripleFirewallSignal, get_db, init_db
```

- [ ] **Step 3: Add the three endpoints after `api_telegram_test_connections`**

Find the end of `api_telegram_test_connections` (starts at line 2109). Read the file around there to find where the function ends (the next top-level `@app...` decorator), then insert the new endpoints right after that function's closing line, before the next route. Add:

```python
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
```

- [ ] **Step 4: Compile-check**

```bash
cd mt5_readonly_service
PY="C:/Users/Lenovo/AppData/Local/Programs/Python/Python312/python.exe"
"$PY" -m py_compile main.py
```
Expected: no output.

- [ ] **Step 5: Manual verification (in-process, no running server needed)**

```bash
cd mt5_readonly_service
PY="C:/Users/Lenovo/AppData/Local/Programs/Python/Python312/python.exe"
PYTHONIOENCODING=utf-8 "$PY" -c "
from fastapi.testclient import TestClient
from main import app
from database import init_db, SessionLocal
import telegram_subscribers as ts

init_db()
db = SessionLocal()
ts.upsert_subscriber(db, telegram_user_id='321999', chat_id='321999', username='apitest', first_name='Api', last_name='Test')
db.close()

client = TestClient(app)

r = client.get('/api/telegram/subscribers')
body = r.json()
print('GET status:', r.status_code, 'total>=1:', body['total'] >= 1, 'active>=1:', body['active'] >= 1)

r = client.post('/api/telegram/subscribers/block', json={'chatId': '321999'})
print('block status:', r.status_code, r.json())

r = client.get('/api/telegram/subscribers')
body = r.json()
row = next(s for s in body['subscribers'] if s['chatId'] == '321999')
print('after block: isActive=%s isBlocked=%s' % (row['isActive'], row['isBlocked']))

r = client.post('/api/telegram/subscribers/unblock', json={'chatId': '321999'})
print('unblock status:', r.status_code, r.json())

r = client.post('/api/telegram/subscribers/block', json={'chatId': 'does-not-exist'})
print('block missing status:', r.status_code, r.json())

# cleanup
db = SessionLocal()
db.query(ts.TelegramSubscriber).filter(ts.TelegramSubscriber.chat_id == '321999').delete()
db.commit()
db.close()
"
```
Expected:
```
GET status: 200 total>=1: True active>=1: True
block status: 200 {'ok': True}
after block: isActive=False isBlocked=True
unblock status: 200 {'ok': True}
block missing status: 404 {'ok': False, 'detail': 'subscriber not found'}
```

- [ ] **Step 6: Commit**

```bash
git add mt5_readonly_service/main.py
git commit -m "feat(telegram): add subscriber list/block/unblock API endpoints"
```

---

### Task 4: Next.js proxy routes

**Files:**
- Create: `src/app/api/telegram/subscribers/route.ts`
- Create: `src/app/api/telegram/subscribers/block/route.ts`
- Create: `src/app/api/telegram/subscribers/unblock/route.ts`

- [ ] **Step 1: Create the GET list proxy**

Create `src/app/api/telegram/subscribers/route.ts`:

```typescript
/**
 * Read-only proxy for the Telegram bot subscriber list.
 * Proxies GET http://127.0.0.1:8010/api/telegram/subscribers
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
    const res = await fetch(`${MT5_SERVICE_BASE}/api/telegram/subscribers`, {
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
        total: 0,
        active: 0,
        blocked: 0,
        subscribers: [],
        error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها",
      },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 2: Create the block proxy**

Create `src/app/api/telegram/subscribers/block/route.ts`:

```typescript
/**
 * Proxy for blocking a Telegram bot subscriber.
 * Proxies POST http://127.0.0.1:8010/api/telegram/subscribers/block
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const FETCH_TIMEOUT_MS = 8000;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const body = await req.json();
    const res = await fetch(`${MT5_SERVICE_BASE}/api/telegram/subscribers/block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    const result = await res.json();
    return NextResponse.json(result, { status: res.status });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { ok: false, error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها" },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 3: Create the unblock proxy**

Create `src/app/api/telegram/subscribers/unblock/route.ts` — identical to the block proxy but targeting `/api/telegram/subscribers/unblock`:

```typescript
/**
 * Proxy for unblocking a Telegram bot subscriber.
 * Proxies POST http://127.0.0.1:8010/api/telegram/subscribers/unblock
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const MT5_SERVICE_BASE = process.env.MT5_SERVICE_URL ?? "http://127.0.0.1:8010";
const FETCH_TIMEOUT_MS = 8000;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const body = await req.json();
    const res = await fetch(`${MT5_SERVICE_BASE}/api/telegram/subscribers/unblock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    const result = await res.json();
    return NextResponse.json(result, { status: res.status });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { ok: false, error: "خدمة MT5 المحلية غير متاحة — تأكد من تشغيلها" },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 4: Type-check**

```bash
cd e:/PROJACT-AHMED/MT5-gold-clone
pnpm exec tsc --noEmit
```
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/telegram/subscribers
git commit -m "feat(telegram): add subscriber management proxy routes"
```

---

### Task 5: `/telegram-subscribers` page + navigation entry

**Files:**
- Create: `src/app/(dashboard)/telegram-subscribers/page.tsx`
- Modify: `src/lib/constants/navigation.ts`

- [ ] **Step 1: Add the navigation entry**

In `src/lib/constants/navigation.ts`, find the import block (lines 1-10):

```typescript
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  FileText,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Settings,
  Shield,
} from "lucide-react";
```

Replace with:

```typescript
import type { LucideIcon } from "lucide-react";
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

Find the `"system"` group (lines 63-70):

```typescript
  {
    id:    "system",
    title: "النظام",
    icon:  Settings,
    items: [
      { label: "الإعدادات المحلية", href: "/settings", icon: Settings },
    ],
  },
```

Replace with:

```typescript
  {
    id:    "system",
    title: "النظام",
    icon:  Settings,
    items: [
      { label: "الإعدادات المحلية", href: "/settings", icon: Settings },
      { label: "مشتركو البوت", href: "/telegram-subscribers", icon: Users },
    ],
  },
```

- [ ] **Step 2: Create the page**

Create `src/app/(dashboard)/telegram-subscribers/page.tsx`:

```tsx
"use client";

import { useState, useCallback, useEffect } from "react";
import { Users, RefreshCw, Ban, CheckCircle2 } from "lucide-react";

interface Subscriber {
  id: number;
  telegramUserId: string;
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  isBlocked: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastStartAt: string | null;
}

interface SubscribersResponse {
  ok: boolean;
  total: number;
  active: number;
  blocked: number;
  subscribers: Subscriber[];
  error?: string;
}

function statusBadge(s: Subscriber) {
  if (s.isBlocked) {
    return <span className="rounded border border-red-800 bg-red-950 px-2 py-0.5 text-xs text-red-400">محظور</span>;
  }
  if (s.isActive) {
    return <span className="rounded border border-green-700 bg-green-950 px-2 py-0.5 text-xs text-green-400">نشط</span>;
  }
  return <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-400">متوقف</span>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function TelegramSubscribersPage() {
  const [data, setData] = useState<SubscribersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingChatId, setActingChatId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/subscribers", { cache: "no-store" });
      const body: SubscribersResponse = await res.json();
      if (!body.ok) {
        setError(body.error ?? "تعذر تحميل قائمة المشتركين");
      }
      setData(body);
    } catch {
      setError("تعذر الاتصال بخدمة MT5 المحلية");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleBlock = useCallback(async (s: Subscriber) => {
    setActingChatId(s.chatId);
    setError(null);
    try {
      const endpoint = s.isBlocked ? "/api/telegram/subscribers/unblock" : "/api/telegram/subscribers/block";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: s.chatId }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error ?? body.detail ?? "تعذر تنفيذ الإجراء");
        return;
      }
      await loadData();
    } catch {
      setError("تعذر الاتصال بخدمة MT5 المحلية");
    } finally {
      setActingChatId(null);
    }
  }, [loadData]);

  const subscribers = data?.subscribers ?? [];

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/25">
            <Users className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">مشتركو بوت التوصيات</h1>
            <p className="text-xs text-muted-foreground">
              إدارة المشتركين في إشعارات وتوصيات نظام الملك الهندسي عبر تيليجرام
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950 p-2 text-xs text-red-400">
            ⚠️ {error}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid gap-4 grid-cols-3">
          <div className="rounded-xl border border-green-800 bg-green-950/30 px-4 py-5 text-center">
            <p className="text-2xl font-bold text-green-400">{data?.active ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">نشط</p>
          </div>
          <div className="rounded-xl border border-red-800 bg-red-950/30 px-4 py-5 text-center">
            <p className="text-2xl font-bold text-red-400">{data?.blocked ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">محظور</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-5 text-center">
            <p className="text-2xl font-bold text-slate-200">{data?.total ?? 0}</p>
            <p className="mt-1 text-xs text-slate-400">الإجمالي</p>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-slate-700 pb-2">
            <p className="text-xs uppercase tracking-widest text-slate-500">قائمة المشتركين</p>
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1 rounded border border-slate-600 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" />
              {loading ? "جاري التحديث..." : "تحديث"}
            </button>
          </div>

          {subscribers.length === 0 && !loading && (
            <p className="text-center text-sm text-slate-500 py-6">
              لا يوجد مشتركون بعد — أرسل /start للبوت من حساب تيليجرام لتجربته
            </p>
          )}

          {subscribers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-500">
                    <th className="p-2 text-right">الاسم</th>
                    <th className="p-2 text-right">المعرف</th>
                    <th className="p-2 text-right">Telegram ID</th>
                    <th className="p-2 text-right">الحالة</th>
                    <th className="p-2 text-right">آخر تفعيل</th>
                    <th className="p-2 text-right">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {subscribers.map((s) => {
                    const fullName = [s.firstName, s.lastName].filter(Boolean).join(" ");
                    const acting = actingChatId === s.chatId;
                    return (
                      <tr key={s.chatId} className="border-b border-slate-800">
                        <td className="p-2 font-bold text-slate-200">{fullName || "—"}</td>
                        <td className="p-2 text-slate-400">{s.username ? `@${s.username}` : "—"}</td>
                        <td className="p-2 text-slate-400">{s.telegramUserId}</td>
                        <td className="p-2">{statusBadge(s)}</td>
                        <td className="p-2 text-slate-400">{formatDate(s.lastStartAt)}</td>
                        <td className="p-2">
                          <button
                            onClick={() => toggleBlock(s)}
                            disabled={acting}
                            className={
                              s.isBlocked
                                ? "flex items-center gap-1 rounded border border-green-700 px-2 py-1 text-green-400 hover:bg-green-950 disabled:opacity-50"
                                : "flex items-center gap-1 rounded border border-red-800 px-2 py-1 text-red-400 hover:bg-red-950 disabled:opacity-50"
                            }
                          >
                            {s.isBlocked ? <CheckCircle2 className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                            {acting ? "..." : s.isBlocked ? "إلغاء الحظر" : "حظر"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-600">
          ⚠️ هذه القائمة لإدارة الاشتراك في الإشعارات فقط وليست توصية مالية
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd e:/PROJACT-AHMED/MT5-gold-clone
pnpm exec tsc --noEmit
```
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/telegram-subscribers" src/lib/constants/navigation.ts
git commit -m "feat(telegram): add subscriber management page and nav entry"
```

---

### Task 6: Final verification + report

**Files:** none (verification only)

- [ ] **Step 1: Full Python compile check**

```bash
cd mt5_readonly_service
PY="C:/Users/Lenovo/AppData/Local/Programs/Python/Python312/python.exe"
"$PY" -m py_compile main.py agents.py database.py telegram_subscribers.py
```
Expected: no output.

- [ ] **Step 2: TypeScript + build**

```bash
cd e:/PROJACT-AHMED/MT5-gold-clone
pnpm exec tsc --noEmit
pnpm run build
```
Expected: `tsc` exits 0 with no output; `pnpm run build` completes successfully, listing `/telegram-subscribers` and the three new `/api/telegram/subscribers...` routes among the built routes.

- [ ] **Step 3: Manual UI test**

1. Start the FastAPI service: `cd mt5_readonly_service && uvicorn main:app --host 127.0.0.1 --port 8010 --reload`.
2. Start Next.js: `pnpm dev`.
3. Open `/telegram-subscribers`. Confirm the 3 stat cards show real counts and the table lists the real subscribers (from earlier `/start` testing), with status badges "نشط".
4. Click "حظر" on one subscriber. Confirm: status badge becomes "محظور", "نشط" count decreases by 1, "محظور" count increases by 1.
5. From that subscriber's real Telegram account, send `/start` again. Confirm the bot replies with the blocked message (`_BLOCKED_TEXT`) and the row in the page (after refresh) still shows "محظور" / `isActive: false`.
6. Click "إلغاء الحظر" on the same row. Confirm status becomes "متوقف" (not "نشط") and "محظور" count returns to 0.
7. From Telegram, send `/start` again. Confirm the welcome message returns and the page (after refresh) shows "نشط" again.

- [ ] **Step 4: git status check**

```bash
cd e:/PROJACT-AHMED/MT5-gold-clone
git status --short
```
Confirm only the files from Tasks 1-5 are modified/new, all already committed per-task.

---

## Self-review

**1. Spec coverage:**
- `is_blocked` column + `to_dict()` field → Task 1.
- Safe SQLite `ALTER TABLE` migration (explicit requirement from project owner) → Task 1, Step 4 + Step 6 (idempotency verified by running `init_db()` twice).
- `block_subscriber` / `unblock_subscriber` → Task 2.
- `/start` rejection while blocked + `_BLOCKED_TEXT` → Task 2, Step 3.
- `GET /api/telegram/subscribers` (all subscribers + counters) → Task 3.
- `POST /api/telegram/subscribers/block` / `/unblock` → Task 3.
- Proxy routes with Clerk auth → Task 4.
- `/telegram-subscribers` page (3 stat cards, table, block/unblock buttons, empty state, footer disclaimer) → Task 5.
- Navigation entry → Task 5, Step 1.
- No changes to `_send_telegram_alert`, `/help`, `/stop`, `/status`, `/subscribers`, `broadcast_recommendation` → confirmed not touched in any task.

**2. Placeholder scan:** none found — every step has complete code and exact commands.

**3. Type consistency:** `is_blocked`/`isBlocked` used consistently across `database.py` (Task 1), `telegram_subscribers.py` (Task 2), `main.py` (Task 3), and the TS `Subscriber` interface (Task 5). `chat_id`/`chatId` consistent across all layers. Function names `block_subscriber`/`unblock_subscriber` match between Task 2 (definition) and Task 3 (import + usage).
