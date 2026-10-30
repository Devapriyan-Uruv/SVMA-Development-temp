-- Optional rollback only. Never run as part of installation.
begin;
update public.parameter_master set active=false where source_ref like 'AGRO_SAFETY_V83:%';
update public.parameter_master p set active=b.was_active from public.safety_v83_migration_state b where p.id=b.parameter_id;
commit;
-- No entries or parameter identities are deleted.
