-- ERP Intelligence Phase 1: register the erp_operator role on the app_role
-- enum. Same isolated-file shape as sql/008/025/037 — a newly added enum
-- value cannot be referenced (e.g. by an RLS policy calling has_role())
-- inside the same transaction it was added in, so this stays its own file,
-- applied before sql/040+ which reference it.
do $$ begin
  alter type public.app_role add value if not exists 'erp_operator';
exception when duplicate_object then null; end $$;
