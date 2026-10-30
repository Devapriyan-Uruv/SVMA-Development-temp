-- Bootstrap the first SVMA Super Admin after creating that user in Supabase Authentication.
-- 1) Replace the email in the final SELECT.
-- 2) Run this file in Supabase SQL Editor.
create or replace function public.bootstrap_first_super_admin(target_email text)
returns void language plpgsql security definer set search_path=public,auth as $$
declare u uuid;
begin
  select id into u from auth.users where lower(email)=lower(target_email) limit 1;
  if u is null then raise exception 'No Supabase Auth user found for %',target_email; end if;
  insert into public.profiles(id,email,full_name)
  select id,email,coalesce(raw_user_meta_data->>'full_name',email) from auth.users where id=u
  on conflict(id) do update set email=excluded.email;
  insert into public.user_roles(user_id,role) values(u,'super_admin'::public.app_role)
  on conflict(user_id,role) do nothing;
end $$;

-- EXAMPLE - CHANGE THIS EMAIL BEFORE RUNNING:
-- select public.bootstrap_first_super_admin('your-admin@svma.com');
