# Telegram Subscribers Management Page — Design

> Builds on `docs/superpowers/specs/2026-06-11-telegram-subscribers-design.md` (subscriber
> opt-in system, already implemented in `mt5_readonly_service/telegram_subscribers.py`).

## 1. Goal

Give the system owner a dedicated page in the dashboard, `/telegram-subscribers`, to:

1. See how many people are subscribed to bot recommendations (active / blocked / total).
2. See per-subscriber details (name, username, Telegram user id, last `/start`, status).
3. Block a specific subscriber so they stop receiving recommendations AND cannot
   re-subscribe via `/start` until the owner unblocks them.
4. Unblock a previously blocked subscriber (they must send `/start` again to
   reactivate after being unblocked).

This is read/management tooling only — it does not touch trading logic, MT5, or OKX.

## 2. Data model change

### `mt5_readonly_service/database.py` — `TelegramSubscriber`

Add one column:

```python
is_blocked = Column(Integer, nullable=False, default=0)  # 0/1 boolean
```

Placed after `is_active`. Included in `to_dict()` as `"isBlocked": bool(self.is_blocked)`.

`is_active` and `is_blocked` are independent:

| is_active | is_blocked | meaning |
|---|---|---|
| 1 | 0 | subscribed, receives recommendations |
| 0 | 0 | unsubscribed via `/stop`, can `/start` again freely |
| 0 | 1 | blocked by owner — `/start` is rejected until unblocked |
| 1 | 1 | not reachable in practice (`block_subscriber` always sets `is_active=0`); if it ever occurs, broadcast still only checks `is_active`, so blocking takes effect immediately by virtue of also clearing `is_active` |

This table is additive (SQLite `ALTER TABLE` via `Base.metadata.create_all` does NOT add
columns to existing tables — see §6 for migration handling).

## 3. `mt5_readonly_service/telegram_subscribers.py` changes

New functions:

```python
def block_subscriber(db: Session, chat_id: str) -> None:
    """Block a subscriber: stop broadcasts and reject future /start."""
    # sets is_blocked=1, is_active=0, updated_at=now

def unblock_subscriber(db: Session, chat_id: str) -> None:
    """Allow a subscriber to /start again. Does not reactivate by itself."""
    # sets is_blocked=0, updated_at=now (is_active stays 0)
```

Both: no-op if `chat_id` not found (mirrors `deactivate_subscriber`).

### `/start` handler change

In `_handle_update`, before calling `upsert_subscriber` for `/start`:

```python
elif command == "/start":
    existing = db.query(TelegramSubscriber).filter(TelegramSubscriber.chat_id == chat_id).first()
    if existing is not None and existing.is_blocked:
        _send_message(token, chat_id, _BLOCKED_TEXT, proxy_url)
        return
    upsert_subscriber(...)
    _send_message(token, chat_id, _START_TEXT, proxy_url)
```

New message constant:

```python
_BLOCKED_TEXT = (
    "تم تقييد وصولك إلى هذا البوت من قبل الإدارة.\n"
    "لإعادة التفعيل يرجى التواصل مع المسؤول."
)
```

No other command changes. `/stop`, `/help`, `/status`, `/subscribers` unchanged.
`broadcast_recommendation` unchanged — it already filters on `is_active=1`, and
`block_subscriber` clears `is_active`, so a blocked subscriber stops receiving
recommendations immediately without any broadcast-side change.

## 4. `mt5_readonly_service/main.py` — new endpoints

All three are read/management only, no trading, no `db` writes beyond the subscriber
table. Follow the existing `Utf8JsonResponse` + `Depends(get_db)` pattern used by
`/api/telegram/test`.

### `GET /api/telegram/subscribers`

Returns **all** subscribers (active, inactive, blocked) plus counters:

```json
{
  "ok": true,
  "total": 5,
  "active": 3,
  "blocked": 1,
  "subscribers": [
    {
      "id": 1,
      "telegramUserId": "1649508399",
      "chatId": "1649508399",
      "username": "vnr_20",
      "firstName": "Hussein",
      "lastName": "Ahmed",
      "isActive": true,
      "isBlocked": false,
      "createdAt": "2026-06-11T18:32:42.161126",
      "updatedAt": "2026-06-11T18:32:42.785420",
      "lastStartAt": "2026-06-11T18:32:42.785420"
    }
  ]
}
```

Implementation: `db.query(TelegramSubscriber).order_by(TelegramSubscriber.updated_at.desc()).all()`,
counters computed in Python from the same list (table is small — subscriber counts
are never large enough to need pagination, unlike `mt5Candles` etc.).

### `POST /api/telegram/subscribers/block`

Request body: `{"chatId": "123456"}`. Calls `block_subscriber(db, chat_id)`.
Response: `{"ok": true}` or `{"ok": false, "detail": "subscriber not found"}` (404).

### `POST /api/telegram/subscribers/unblock`

Request body: `{"chatId": "123456"}`. Calls `unblock_subscriber(db, chat_id)`.
Response: `{"ok": true}` or `{"ok": false, "detail": "subscriber not found"}` (404).

Both POST endpoints use a small Pydantic model:

```python
class TelegramSubscriberAction(BaseModel):
    chatId: str
```

## 5. Frontend

### Proxy routes (Clerk auth, same pattern as `src/app/api/lab/watchlist/route.ts`)

- `src/app/api/telegram/subscribers/route.ts` — `GET` only, proxies
  `GET {MT5_SERVICE_URL}/api/telegram/subscribers`.
- `src/app/api/telegram/subscribers/block/route.ts` — `POST` only, proxies
  `POST {MT5_SERVICE_URL}/api/telegram/subscribers/block` with the JSON body.
- `src/app/api/telegram/subscribers/unblock/route.ts` — `POST` only, proxies
  `POST {MT5_SERVICE_URL}/api/telegram/subscribers/unblock` with the JSON body.

### Page `src/app/(dashboard)/telegram-subscribers/page.tsx`

Client component, `dir="rtl"`, follows `reports/page.tsx` header style
(icon box + title + description, no "تجريبي" badge since this is real data).

- Header: icon `Users` (lucide-react), title "مشتركو بوت التوصيات", description
  "إدارة المشتركين في إشعارات وتوصيات نظام الملك الهندسي عبر تيليجرام".
- 3 stat cards in a row: "نشط" (active, green), "محظور" (blocked, red), "الإجمالي" (total, neutral).
- Refresh button (re-fetches `/api/telegram/subscribers`).
- Table columns: الاسم (firstName + lastName, "—" if both null), المعرف
  (`@username` or "—"), Telegram ID (`telegramUserId`), الحالة (badge: نشط/متوقف/محظور
  based on `isActive`/`isBlocked`), آخر تفعيل (`lastStartAt`, formatted or "—"),
  إجراء (button).
- Action button per row:
  - if `isBlocked === false` → "حظر" (red outline button) → `POST /api/telegram/subscribers/block { chatId }`
  - if `isBlocked === true` → "إلغاء الحظر" (green outline button) → `POST /api/telegram/subscribers/unblock { chatId }`
  - On click: optimistic disable + spinner text, then refetch the list on success;
    on failure show inline error text under the table (Arabic).
- Empty state: "لا يوجد مشتركون بعد — أرسل /start للبوت من حساب تيليجرام لتجربته"
  when `subscribers.length === 0`.
- Footer note (Rule 10 compliance): "هذه القائمة لإدارة الاشتراك في الإشعارات فقط
  وليست توصية مالية."

### Navigation

`src/lib/constants/navigation.ts` — add to the `"system"` group:

```ts
{ label: "مشتركو البوت", href: "/telegram-subscribers", icon: Users }
```

`Users` imported from `lucide-react` (added to the existing import list).

## 6. SQLite column-add migration for `is_blocked`

`Base.metadata.create_all()` (called by `init_db()` on every startup) only creates
**missing tables**, not missing columns on existing tables. Since
`telegram_subscribers` already exists in `local_quant.db` (created by the prior
stage and already has real rows), adding `is_blocked` to the model alone would cause
`sqlite3.OperationalError: no such column: telegram_subscribers.is_blocked` at
runtime.

Fix: in `init_db()` (or immediately after `Base.metadata.create_all()`), run a small
idempotent guard:

```python
from sqlalchemy import inspect, text

def _ensure_telegram_subscriber_columns() -> None:
    inspector = inspect(engine)
    if "telegram_subscribers" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("telegram_subscribers")}
    if "is_blocked" not in columns:
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE telegram_subscribers ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0"
            ))
```

Called from `init_db()` right after `Base.metadata.create_all(bind=engine)`. This is
the same additive, non-destructive pattern as table creation — existing rows get
`is_blocked=0` (not blocked) by the `DEFAULT 0` clause, no data loss.

## 7. Out of scope

- No bulk actions (block all, export list).
- No editing of subscriber profile fields from the UI.
- No separate "admin" auth layer beyond existing Clerk auth on the Next.js app
  (single-owner system, matches the rest of `/settings`).
- No changes to `/help`, `/stop`, `/status`, `/subscribers` Telegram commands.
- No changes to `_send_telegram_alert` or the legacy single-chat alert.

## 8. Verification plan

- `python -m py_compile` on `database.py`, `telegram_subscribers.py`, `main.py`.
- Manual DB check: confirm `is_blocked` column appears on a DB that already has the
  `telegram_subscribers` table (run `init_db()` against the existing `local_quant.db`
  and inspect via `PRAGMA table_info(telegram_subscribers)`).
- Manual function checks for `block_subscriber` / `unblock_subscriber` /
  `/start` rejection while blocked, using a temporary test chat_id (created and
  cleaned up, as in the previous stage).
- `pnpm exec tsc --noEmit` and `pnpm run build`.
- Manual UI check: open `/telegram-subscribers`, confirm counts and table render,
  click "حظر" on a test subscriber, confirm status badge updates and counts shift,
  click "إلغاء الحظر", confirm it returns to "متوقف" (not "نشط" — they must `/start`
  again).
