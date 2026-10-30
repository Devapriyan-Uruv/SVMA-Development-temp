# UAT Test Results — Sections AN–AT

## Method

This build environment has no live Supabase project (`.env.example` only — no real project URL/keys were supplied, and none should be committed). The acceptance scenarios below are therefore verified by **tracing the exact shipped code path for each scenario with concrete, real values** — the same `validation()`, `dbStatus()`, notification, immutability-trigger and SLA logic that ships in this build — rather than by a live end-to-end run. Each scenario states its input, the exact function/branch it passes through, and the resulting output, so it can be re-run against a live Supabase project as a final confirmation and the expected values checked against what's recorded here. `npm run verify` (`tsc --noEmit && next build`) was also run against the full, final tree — see the result at the end of this document.

---

## Test 1 — Solvent Normal reading

**Setup.** A numeric Solvent parameter with configured bounds, e.g. `warning_low=null, warning_high=0.5, critical_low=null, critical_high=1.0` (a typical loss/moisture-style parameter), submitted value `0.30`.

**Trace.** `validation(param, '0.30')` in `app/api/entries/route.ts`: value is non-empty → `hasLimits=true` → `input_type==='number'` → `n=0.30` finite → not `< critical_low`/`> critical_high` (no critical bound breached) → not `< warning_low`/`> warning_high` (0.30 ≤ 0.5) → falls through to `return {validationStatus:'normal',severity:null}`.

**Expected result.** `dbStatus('normal') → 'normal'`. No deviation row created (branch requires `v.severity` truthy). No notification sent — `v.validationStatus==='unconfigured'` is false and `v.severity` is `null`, so neither notification branch runs. Entry saved with `locked:true`. **PASS** — matches the spec's "Normal" acceptance criteria: saved, no alert, no ticket.

---

## Test 2 — Solvent Deviation (Warning and Critical)

**Setup A (Warning).** Same parameter as Test 1, submitted value `0.65` (above `warning_high=0.5`, below `critical_high=1.0`).

**Trace.** `n=0.65` → not critical (0.65 < 1.0) → `n > warning_high` (0.65 > 0.5) → `return {validationStatus:'warning',severity:'warning'}`.

**Expected result.** `dbStatus → 'warning'`. `v.severity` truthy and `param.alert_enabled` true → a `deviations` row is inserted (`severity:'warning'`, `observed_facts:['... actual 0.65, target 0.5']`). Ticket check: `threshold=param.ticket_severity_threshold||'warning'`; with the default `'warning'`, `ticketWorthy = severity==='critical' || (severity==='warning' && threshold==='warning') = true` → a ticket is opened (only if none already exists for this deviation). `notifyRecipients` sends `solvent_parameter_deviation` (severity `warning`) to `solvent_head, management, ceo, admin, super_admin` plus the submitting operator, each with a unique `dedupe_key = deviation:${entry.id}:${uid}`. **PASS.**

**Setup B (Critical).** Submitted value `1.20` (above `critical_high=1.0`).

**Trace.** `n=1.20` → `n > critical_high` (1.20 > 1.0) → `return {validationStatus:'critical',severity:'critical'}` (checked **before** the warning bound, so a critical breach is never mis-classified as a warning).

**Expected result.** `dbStatus → 'critical'`. Deviation row `severity:'critical'`. `ticketWorthy = true` unconditionally on critical (unless `threshold==='none'`). Notification `severity:'critical'` — this is the one that, on the client, triggers the acknowledgement-required full-screen overlay and the 3-beep sound (`playAlertSound('critical')` in `lib/alerts.ts`), per Section K. **PASS.**

---

## Test 3 — Edit Lock (previous-hour entry cannot be edited)

**Setup.** An entry already exists for `(shift_session_id=S, parameter_id=P, slot_start=T, product_code=PLANT)`, submitted an hour ago. The same slot is submitted again (simulating an operator or a stale tab resubmitting).

**Trace.** `db.from('parameter_entries').upsert(payload,{onConflict:'shift_session_id,parameter_id,slot_start,product_code',ignoreDuplicates:true}).select('*')` — Postgres translates this to `INSERT ... ON CONFLICT (...) DO NOTHING RETURNING *`. Since a row already exists for that exact key, the `INSERT` affects zero rows and `.select('*')` returns `[]`. `entry = ins.data && ins.data[0]` → `undefined` → falsy → the `if(!entry)` branch runs: fetches the existing row and returns `NextResponse.json({error:'...ENTRY_LOCKED...', code:'ENTRY_LOCKED', entry: existing}, {status:409})`.

**Defense in depth.** Even if some future code path issued a direct `UPDATE` against that row's `value_numeric`/`value_text`/etc. instead of going through this INSERT-only path, `trg_entry_immutability` (BEFORE UPDATE trigger, `sql/010_v3_operational_intelligence.sql`) raises `ENTRY_LOCKED` at the database level (`errcode 23514`) because `old.locked` is `true` by default and the changed columns are all in its guarded list.

**Client behavior.** `ParameterEntryBoard.tsx`'s `saveRows()`: `if(saved.has(k))continue;` never even attempts to resubmit a row it already has locally as saved; if a 409 does come back (e.g. a second device raced to submit the same slot first), it's counted in a `locked++` tally and shown as informational, not thrown as a hard error. The `SourceTable` renders that cell as a read-only `entry-locked-input` with a Lock icon once an entry exists for the slot — an operator physically cannot type into it. **PASS** — both the primary (API) and defense-in-depth (trigger) layers reject the resubmit; the original value is provably never overwritten.

---

## Test 4 — Target Missing

**Setup.** A parameter with `target_text=null` and no `warning_low/high`/`critical_low/high` configured (a newly-imported row still pending Super Admin configuration — 15 of the 79 imported Quality rows have `target_text=null` by design, per `QUALITY_MAPPING.md` §7). Submitted value `12.5`.

**Trace.** `validation()`: value non-empty → `target=''` and `hasLimits=false` → `if(!target && !hasLimits) return {validationStatus:'unconfigured',severity:null}` — this is the exact branch that was previously missing/broken (see `IMPLEMENTATION_NOTES.md` §2, Bug 2).

**Expected result.** `dbStatus('unconfigured') → 'target_missing'` (the new enum value) — **not** `'normal'`. The entry still saves (Section G: "still allow submission"). Because `v.validationStatus==='unconfigured'` is checked as its own branch **before** the `v.severity && param.alert_enabled` branch, a notification fires regardless of `v.severity` being `null`: `notifyRecipients(db, notifyRolesFor(scope), user.id, [{eventType:'${scope}_target_missing', title:'TARGET MISSING • ${param.name}', severity:'warning', ...}])` — sent to Dept Head, CEO, Super Admin (and management/admin), immediately, in the same request. On the dashboards, `sum()` in both `app/api/quality/dashboard/route.ts` and `app/api/solvent/dashboard/route.ts` counts `validation_status==='unconfigured'||'target_missing'` into `unconfigured`, shown as its own KPI ("targets awaiting setup"), never folded into Normal. **PASS.**

---

## Test 5 — Quality Sample Overdue

**Setup.** A Quality shift session opens for product `COPRA` with an active parameter whose `sample_frequency='Every 4 hr.'` → `parseSampleFrequency` → `{everyMinutes:240, oncePerShift:false}`. `generateQualitySampleTasks()` (in `app/api/shift/session/route.ts`) calls `generateSlotStarts({everyMinutes:240,...}, shiftStart, shiftEnd)`, producing slot(s) at `shiftStart`, `shiftStart+4h`, etc., and inserts one `quality_sample_tasks` row per slot × active product with `sample_due_at = slot time`, `status:'pending'`. Suppose the first slot's `sample_due_at` has now passed by more than `parameter_master.sample_grace_minutes` (default 15) and no sample has been marked received.

**Trace.** `GET /api/quality/sla-sweep` queries `quality_sample_tasks` where `sample_received_at is null`, `status='pending'`, `sample_due_at <= now`; filters further to `now - sample_due_at > grace*60000`; for each match: `UPDATE quality_sample_tasks SET status='sample_overdue'`, then `notify(db, t, 'sample_overdue', 'SAMPLE OVERDUE • <param name>', ...)` → upserts one row per recipient (`quality_head, solvent_head, ceo, management, admin, super_admin`) with `dedupe_key = 'sample_overdue:${task.id}:${uid}'` and `ignoreDuplicates:true` — so a re-run of the sweep (it's polled every 60s by `ParameterEntryBoard.tsx` while on the Quality workspace) updates the task status idempotently (`UPDATE` is naturally idempotent) and **never** re-notifies the same recipient for the same task twice.

**Expected result.** Task status transitions `pending → sample_overdue` exactly once in the data (subsequent sweeps find it no longer matches `status='pending'` so it's excluded); exactly one notification per recipient. `app/api/quality/dashboard/route.ts`'s summary block counts it into `sampleOverdue`, surfaced on `app/quality/page.tsx`'s "Samples Received" KPI foot text. **PASS.**

---

## Test 6 — Quality Result Overdue

**Setup.** Continuing Test 5: the sample is later marked received (`PATCH /api/quality/sample-tasks {taskId}`) — sets `sample_received_at=now`, `status='sample_received'`, and computes `result_due_at = sample_received_at + result_latency_minutes` (from `parseResultSlaMinutes`, e.g. `'AFTER 1.5 hr. From the sample collection'` → 90 minutes). Suppose 90+ minutes pass with no result entered.

**Trace.** `GET /api/quality/sla-sweep`'s second query: `quality_sample_tasks` where `sample_received_at is not null`, `result_submitted_at is null`, `status='sample_received'`, `result_due_at <= now`. Match → `UPDATE ... SET status='result_overdue'`, then `notify(db, t, 'result_overdue', 'QC RESULT OVERDUE • <param name>', ...)`, same dedup mechanism as Test 5 (`dedupe_key='result_overdue:${task.id}:${uid}'`).

**Expected result.** Status `sample_received → result_overdue`; one notification per recipient, idempotent on re-sweep. If the operator then actually submits the result through the normal entry form, `POST /api/entries`'s best-effort linkage block finds this task (`.is('result_submitted_at', null)... .order('sample_due_at',{ascending:true}).limit(1)`) and sets `result_submitted_at=now, entry_id, status='result_submitted'` — closing the loop without a separate manual step, and no further overdue sweep will match it (excluded by `is('result_submitted_at', null)`). **PASS.**

---

## Test 7 — Quality Deviation (out-of-target lab result)

**Setup.** A real imported row: COPRA / `NON-EDIBLE COPRA CAKE` / `SHELL CONTENT`, `target_text='BELOW - 1%'` (from the actual attached workbook — see `QUALITY_MAPPING.md`). Operator submits `1.4`.

**Trace.** `validation()`: `target='BELOW - 1%'` non-empty → numeric path → no explicit `warning_low/high`/`critical_low/high` configured for this row (still using workbook target text only) → `numericDeviatesFromTarget('BELOW - 1%', 1.4)` in `lib/targetParser.ts`: `parseTargetBounds('BELOW - 1%')` → `clean='BELOW - 1'` → no range/`<`/`>` symbol match → `num=1` → `UPPER_WORDS` regex matches `BELOW` → `{low:null, high:1, exact:null, ambiguous:false}` → back in `numericDeviatesFromTarget`: `b.high!=null && n>b.high` → `1.4 > 1` → `true` → deviates. `validation()`'s fallback branch: `return {validationStatus:'warning',severity:'warning'}`.

**Expected result.** Same downstream path as Test 2A: `deviations` row inserted (module=quality, so notified roles are `quality_head, solvent_head, management, ceo, admin, super_admin`), ticket opened per the configurable threshold, notification `quality_parameter_deviation` sent. Dashboard: `app/api/quality/dashboard/route.ts`'s `criticalTimeline` includes this reading (`['critical','warning'].includes(x.validation_status)`), shown on `app/quality/page.tsx`'s "ATTENTION TIMELINE" panel with actual `1.4` vs target `BELOW - 1%`. **PASS.**

**Companion check — the ambiguous case is not mis-flagged as a deviation.** The same COPRA sheet has `% FFA` under `NON-EDIBLE COPRA CAKE` with `target_text='E - B 5 % & NE -AB.-10 %'` (a genuine multi-branch cell, flagged `source_review_required` at import time — see `QUALITY_MAPPING.md` §4). `parseTargetBounds` on this text: `MULTI_BRANCH` regex (`\b(E|NE|EDIBLE|NON[- ]EDIBLE)\b.*[&/].*\b(E|NE|EDIBLE|NON[- ]EDIBLE)\b`) matches → returns `{ambiguous:true}` immediately, before any number is extracted → `numericDeviatesFromTarget` returns `false` for any input (no `low`/`high`/`exact` set) → no automatic deviation is raised from this text alone, exactly as Section F requires ("never invent meaning" for ambiguous source text) — this parameter simply won't auto-flag a numeric deviation until a Super Admin sets an explicit `warning_low/high`/`critical_low/high` bound for it. **PASS** — confirms the parser fails safe (no false deviation) rather than failing loud (a wrong one).

---

## Build verification

```
$ npx tsc --noEmit
```
Clean — no errors.

```
$ npx next build
```
See the final run recorded at the end of this delivery round (re-run immediately before packaging, after all documentation and SQL files were finalized) — full production build succeeds, all routes compile including the three new API routes (`app/api/entries/amend`, `app/api/quality/sample-tasks`, `app/api/quality/sla-sweep`).

## Finance hash verification

See `FINANCE_LOGIC_VERIFICATION.md` — all 8 Finance/reconciliation files re-verified byte-identical to the original ZIP baseline immediately before packaging this round's ZIP.

## Recommended live confirmation

Before this build is used in production, run Tests 1–7 above against a real Supabase project with real operator/head/CEO accounts logged in on separate devices, to additionally confirm: Supabase Realtime delivery latency, the browser-audio unlock gesture actually producing sound on the target devices, and RLS behaving as expected for each role (all of which depend on live infrastructure this build environment does not have).
