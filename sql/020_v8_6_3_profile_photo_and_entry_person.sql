-- V8.6.3: self-service profile fields (avatar) + shift-start entry-person
-- capture (the physical person entering data, distinct from the logged-in
-- account, plus their optional photo). Additive only.
-- Storage buckets (avatars, shift-entry-photos) are created separately via
-- the Storage API (service role), not here — bucket creation is not a
-- schema DDL statement and does not need the SQL Editor.

alter table public.profiles add column if not exists avatar_url text;

alter table public.shift_sessions add column if not exists entry_person_name text;
alter table public.shift_sessions add column if not exists entry_person_photo_url text;
