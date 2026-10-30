-- V8.6.6: shorter, readable ticket numbers. The previous format appended
-- the full 32-character entry UUID (SVMA-SOL-20260913-4b82f3cd0cfc401f9ca
-- 68fc8b713c9c6), which is unreadable on a ticket list or a phone screen.
-- This redefines the same function from 018 with only the ticket_no line
-- changed — a short random 6-character code instead of the full UUID.
create or replace function public.svma_process_deviation_entry(p_entry_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  ent record; p record; scope_name text; v_deviation_id uuid; fact text; ticket_worthy boolean;
begin
  select * into ent from public.parameter_entries where id=p_entry_id;
  if not found or ent.validation_status not in ('warning','critical') then return; end if;
  select pm.*,s.module,s.name section_name into p from public.parameter_master pm join public.parameter_sections s on s.id=pm.section_id where pm.id=ent.parameter_id;
  if not found or p.module not in ('solvent','boiler','quality') then return; end if;
  scope_name:=case when p.module='quality' then 'quality' else 'solvent' end;
  fact:=p.section_name||' · '||p.name||': actual '||coalesce(ent.value_numeric::text,ent.value_text,'')||'; target '||coalesce(ent.expected_target,'');

  select d.id into v_deviation_id from public.deviations d where d.entry_id=ent.id;
  if v_deviation_id is null then
    insert into public.deviations(entry_id,shift_session_id,parameter_id,severity,target_text,actual_text,status,observed_facts)
    values(ent.id,ent.shift_session_id,ent.parameter_id,ent.validation_status,ent.expected_target,coalesce(ent.value_numeric::text,ent.value_text,''),'open',jsonb_build_array(fact))
    returning id into v_deviation_id;
  end if;

  ticket_worthy:=coalesce(p.ticket_enabled,true) and (
    coalesce(p.ticket_severity_threshold,'warning')='warning'
    or (p.ticket_severity_threshold='critical' and ent.validation_status='critical')
  );
  if ticket_worthy and not exists(select 1 from public.deviation_tickets t where t.deviation_id=v_deviation_id) then
    insert into public.deviation_tickets(ticket_no,deviation_id,status,due_at)
    values('SVMA-'||case when scope_name='quality' then 'QC-' else 'SOL-' end||to_char(now(),'YYMMDD')||'-'||upper(substr(md5(random()::text||clock_timestamp()::text),1,6)),v_deviation_id,'open',now()+interval '2 hours');
  end if;

  if coalesce(p.alert_enabled,true) then
    insert into public.notifications(user_id,event_type,title,body,severity,entity_type,entity_id,dedupe_key)
    select recipients.user_id,scope_name||'_parameter_deviation',upper(ent.validation_status)||' • '||p.name,fact,ent.validation_status,'deviation',v_deviation_id::text,'deviation:'||ent.id::text||':'||recipients.user_id::text
    from (select ent.entered_by user_id union select ur.user_id from public.user_roles ur where ur.role::text in ('super_admin','admin','management','ceo','solvent_head') or (scope_name='quality' and ur.role::text='quality_head')) recipients
    where recipients.user_id is not null on conflict(dedupe_key) do nothing;
  end if;
end $$;
revoke all on function public.svma_process_deviation_entry(uuid) from public;
