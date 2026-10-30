-- V8.7.1: register the four Import/Export roles on the app_role enum.
-- sql/036 added the import_operator/import_manager/export_operator/
-- export_manager roles everywhere in application code (lib/authorize.ts,
-- /api/me, /api/admin/users, the HR "Add employee" role list) but never
-- extended the actual Postgres enum user_roles.role is typed as — caught
-- live when creating one of these roles, and separately the trade
-- SLA-sweep notification query, both failed with "invalid input value for
-- enum app_role". Same fix shape as sql/008 (quality roles) and sql/025
-- (hr_admin) before it.
do $$ begin
  alter type public.app_role add value if not exists 'import_operator';
exception when duplicate_object then null; end $$;
do $$ begin
  alter type public.app_role add value if not exists 'import_manager';
exception when duplicate_object then null; end $$;
do $$ begin
  alter type public.app_role add value if not exists 'export_operator';
exception when duplicate_object then null; end $$;
do $$ begin
  alter type public.app_role add value if not exists 'export_manager';
exception when duplicate_object then null; end $$;
