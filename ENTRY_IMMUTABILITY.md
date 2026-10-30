# Entry Immutability — Section C

## The problem this replaces

Before this round, `app/api/entries/route.ts` saved a reading with a plain Supabase `.upsert(payload,{onConflict:'shift_session_id,parameter_id,slot_start,product_code'})`. Without `ignoreDuplicates:true`, Postgres upsert is `INSERT ... ON CONFLICT (...) DO UPDATE` — so resubmitting the same slot (accidentally, by a second operator, or by a stale browser tab) silently **overwrote** the original captured value. There was no server-side lock; the previous hour's readings were editable because nothing actually prevented it.

## The fix: two independent layers

### Layer 1 — API: atomic insert-or-reject

```ts
const ins = await db.from('parameter_entries')
  .upsert(payload, {onConflict:'shift_session_id,parameter_id,slot_start,product_code', ignoreDuplicates:true})
  .select('*');
```

`ignoreDuplicates:true` turns this into `INSERT ... ON CONFLICT DO NOTHING`. If the row already exists, the insert affects zero rows and `.select('*')` returns an empty array. The route detects this (`if(!entry)`), fetches the existing row for context, and responds:

```json
HTTP 409
{ "error": "This reading was already submitted and is locked. Use the amendment workflow for a genuine correction.",
  "code": "ENTRY_LOCKED",
  "entry": { ...existing row... } }
```

This is atomic and race-safe at the database level — two simultaneous submissions for the same slot can never both "win" and overwrite each other; exactly one insert succeeds, the other gets 409.

### Layer 2 — Database: a trigger that blocks it even if the API layer is bypassed

`sql/010_v3_operational_intelligence.sql` adds a `locked boolean not null default true` column to `parameter_entries` and this trigger:

```sql
create or replace function public.enforce_entry_immutability() returns trigger
language plpgsql as $$
begin
  if old.locked and (
    new.value_numeric is distinct from old.value_numeric or
    new.value_text is distinct from old.value_text or
    new.expected_target is distinct from old.expected_target or
    new.status is distinct from old.status or
    new.validation_status is distinct from old.validation_status or
    new.parameter_id is distinct from old.parameter_id or
    new.shift_session_id is distinct from old.shift_session_id or
    new.slot_start is distinct from old.slot_start or
    new.product_code is distinct from old.product_code or
    new.entered_by is distinct from old.entered_by or
    new.server_timestamp is distinct from old.server_timestamp
  ) then
    raise exception 'ENTRY_LOCKED: submitted parameter entries are immutable; use the amendment workflow' using errcode='23514';
  end if;
  return new;
end $$;
create trigger trg_entry_immutability before update on public.parameter_entries
  for each row execute procedure public.enforce_entry_immutability();
```

This runs on **every** UPDATE to `parameter_entries`, regardless of which code path issues it — including a direct service-role call, a future engineer's code, or a manual SQL statement run against the database. It blocks any change to the captured facts (value, target, status, identity columns, timestamp) once `locked` is true (the default for every row). It does **not** block changes to `amended_value_numeric`, `amended_value_text`, `amended_at`, `amended_by`, `amendment_id` — the designated, non-destructive overlay columns — nor to best-effort SLA-linkage columns the deterministic pipeline itself sets once (see `app/api/entries/route.ts`'s quality-sample-task linkage block). The original captured fact is never overwritten; a correction is layered on top of it, never in place of it.

## The amendment workflow — the only path to a correction

`POST /api/entries/amend` (restricted to `SOLVENT_MANAGEMENT_ROLES ∪ QUALITY_MANAGEMENT_ROLES ∪ SUPER_ADMIN_ROLES`, and further checked so a Solvent Head cannot amend a Quality entry or vice versa — only Super Admin can amend either):

1. Requires both a non-empty `correctedValue` and a non-empty `reason` — a correction with no stated reason is rejected outright, because the reason becomes part of the permanent audit trail.
2. Inserts a row into `entry_amendments` recording `original_value_numeric/text` (copied from the still-untouched `parameter_entries` row), `corrected_value_numeric/text`, `reason`, `requested_by`, `approved_by` (the same user — only an authorised role can call this endpoint at all, so the request and the approval are the same authorised act), `status: 'approved'`, `approved_at`.
3. Updates `parameter_entries` — but **only** the overlay columns: `amended_value_numeric`, `amended_value_text`, `amended_at`, `amended_by`, `amendment_id`. The trigger in Layer 2 permits exactly this and nothing else.
4. Writes a full before/after row to `audit_logs` (`action: 'AMEND_ENTRY'`).

`GET /api/entries/amend?entryId=...` or `?shiftSessionId=...` lists the amendment history for review — every past correction to every entry is permanently retained in `entry_amendments`, never deleted or overwritten.

## What the operator/reviewer sees

`ParameterEntryBoard.tsx`'s `SourceTable`: once an entry exists for a slot, the cell renders as a read-only `entry-locked-input` (a Lock icon + the saved value) instead of an editable input — the UI reflects the same rule the server enforces, it doesn't invent a separate one. If the entry carries an amendment (`amended_value_numeric ?? amended_value_text` is set), the amended value is shown with an "Amended" badge; the original value is never hidden, only superseded in display, and the full history remains queryable via `GET /api/entries/amend`. A "Request correction" link appears only for users whose role (`canAmend`, fetched from `/api/me`) is actually authorised — this is a UX convenience, not the enforcement boundary; the real boundary is the server-side role check in the amend route plus the database trigger (Section AH: server-side authorization, not hidden buttons).

## Net effect

- A resubmit of an already-captured slot: **rejected** (`409 ENTRY_LOCKED`), original value intact — verified in `UAT_TEST_RESULTS.md`.
- A direct UPDATE attempt against a locked row's captured columns, from any code path: **rejected by the database itself** (`23514`), independent of the API.
- A genuine correction: possible only through the audited amendment path, restricted to the correct authorised roles, always with a reason, always leaving the original value queryable.
