# Notification Flow — Capture → Lock → Validate → Alert → Act → Interpret

This is the guiding principle for the whole round, stated explicitly in the brief: **CAPTURE FACT → LOCK FACT → VALIDATE FACT → ALERT → ACT → INTERPRET WITH AI** — not "capture, then wait for AI, then maybe alert." This document traces that pipeline end to end through the actual code.

## 1. Capture

An operator submits a reading through `ParameterEntryBoard.tsx` → `POST /api/entries`. The payload is the raw captured fact: parameter, value, product, slot, timestamp. Nothing about severity or notification happens yet.

## 2. Lock

`POST /api/entries` writes the row with an atomic, race-safe `INSERT ... ON CONFLICT DO NOTHING` (`.upsert(payload,{onConflict:'shift_session_id,parameter_id,slot_start,product_code',ignoreDuplicates:true})`). If a row for that exact slot already exists, the insert returns nothing and the route responds `409 ENTRY_LOCKED` — the fact is locked the instant it is first captured, before validation even runs. See `ENTRY_IMMUTABILITY.md` for the full mechanism, including the database-level trigger that backs this up independently of the API.

## 3. Validate (deterministic, synchronous, in the same request)

`validation(param, value)` in `app/api/entries/route.ts` runs **in the same request**, before the response is sent — never deferred to a background job or to AI:

1. Empty value → `missing`.
2. No target text **and** no numeric warning/critical bounds configured → `unconfigured` (Section G's TARGET_MISSING) — **not** silently `normal`.
3. Numeric parameters: explicit `critical_low/high` and `warning_low/high` columns on `parameter_master` are checked first (Super-Admin-configured, highest priority); if none are configured, the parsed `target_text` bound (`lib/targetParser.ts`) is used as a fallback warning-level check.
4. Categorical (`check`/`select`) parameters: an explicit table of known bad values (`X`, `ABNORMAL`, `LEAK`, `PRESENT` when NIL is expected, `OPEN` when CLOSED is expected, etc.) drives `critical`/`warning`/`normal`.

Severity is **never** decided by AI (Sections I/J/N/AJ) — this function is the single source of truth, and it is pure deterministic logic over Super-Admin-configured thresholds and workbook-sourced target text.

## 4. Alert (synchronous, before the HTTP response returns)

Still inside the same `POST /api/entries` request, one of two notification branches fires, both writing directly to the `notifications` table via `notifyRecipients()`:

- **`validationStatus === 'unconfigured'`** → every recipient in `notifyRolesFor(scope)` (Dept Head, CEO, Super Admin, management) is notified with event type `${scope}_target_missing`, severity `warning`. This is the fix for the bug where a missing target was previously invisible — it is now surfaced immediately, every time, with no AI involved.
- **`v.severity` is set (warning/critical) and the parameter has alerts enabled`** → a `deviations` row is created or updated (idempotent — one deviation per entry, found via `entry_id`), a ticket is opened if `ticketWorthy` (see §5), and the same recipient set is notified with event type `${scope}_parameter_deviation`.

Every notification write goes through `notifyRecipients()`, which builds one row per recipient with a **deterministic `dedupe_key`** (e.g. `deviation:${entry.id}:${uid}`, `target_missing:${entry.id}:${uid}`) and writes with `.upsert(rows,{onConflict:'dedupe_key',ignoreDuplicates:true})` against a partial unique index (`notifications_dedupe_uq` on `dedupe_key where dedupe_key is not null`). A retried or offline-queued submission can never produce a duplicate notification for the same fact and the same recipient (Section L).

Separately, the Quality SLA sweep (`GET /api/quality/sla-sweep`, polled every 60s by the Quality workspace) uses the identical dedupe pattern (`${kind}:${task.id}:${uid}`) for `sample_overdue`/`result_overdue` events, so repeated sweeps never re-notify for the same overdue task.

## 5. Act

- **Action Tickets** — `parameter_master.ticket_severity_threshold` (`'warning'` | `'critical'` | `'none'`, Super-Admin-configurable, default `'warning'`) decides whether a Warning-level deviation also opens a ticket; Critical always does unless the threshold is `'none'`. One deviation → at most one open ticket (checked via `deviation_tickets.deviation_id` before inserting) — no duplicate tickets for the same underlying fact, per Section M.
- **Delivery to the recipient** — `components/NotificationBell.tsx` subscribes to Supabase Realtime (`postgres_changes`, `event: 'INSERT'`, `table: 'notifications'`, filtered server-side by RLS to `user_id = auth.uid()`) so a new row appears in the bell **the moment it's written**, with no polling delay for the common case. A 45-second poll remains as an explicit fallback (per the brief's own allowance) for the rare case a Realtime event is missed (e.g. brief network drop).
- **Sound + vibration** (`lib/alerts.ts`) — a Web-Audio-synthesised beep (no external asset, no network dependency) plays for Warning (1 beep) and Critical (3 beeps); `navigator.vibrate()` fires the same distinction on supporting devices. Browsers block audio playback until a user gesture, so `unlockAlertSound()` must be called once from a click handler — the bell exposes an explicit "Enable Operational Alert Sound" toggle for this, persisted both to `localStorage` (instant UI state) and server-side (`PUT /api/notifications`, `notification_preferences.sound_enabled`) so the preference follows the user across devices.
- **Critical persistence** — a Critical notification opens a full-screen overlay that **stays on screen until explicitly acknowledged** (`PATCH /api/notifications {id, acknowledge:true}` sets `acknowledged_at`/`acknowledged_by`); it is not dismissed by a timeout or by navigating away, per Section K.

## 6. Interpret with AI (last, asynchronous, never blocking, never deciding severity)

`app/api/reports/route.ts` (unchanged in mechanism this round; fixed for reliability in round 4) computes the deterministic report first and only asks OpenAI for narrative commentary **on top of** results that already exist — target validation, deviation counts, and now TARGET_MISSING counts are all deterministic and already computed before any AI call. If the OpenAI call is slow or fails, the deterministic report is still returned. AI is never in the critical path of capture, lock, validate, or alert — it only narrates what already happened, after the fact, and never decides what counts as a deviation or how severe it is.

## End-to-end summary

```
operator submits reading
        │
        ▼
  POST /api/entries
        │  atomic INSERT ... ON CONFLICT DO NOTHING
        ▼
  LOCKED (or 409 if already locked)
        │
        ▼
  validation() — deterministic, synchronous
        │
        ├── unconfigured ──► notify Dept Head + CEO + Super Admin (TARGET_MISSING)
        │
        └── severity set ──► deviation row ──► ticket (if threshold met) ──► notify recipients
        │
        ▼
  notifications row(s) written (deduplicated by dedupe_key)
        │
        ▼
  Realtime push ──► NotificationBell: sound/vibration, critical overlay (ack required)
        │
        ▼  (separately, async, on demand)
  AI narrative report — reads already-computed deterministic results, never decides them
```
