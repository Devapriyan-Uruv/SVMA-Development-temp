-- Consolidate a REPEATING deviation on the same parameter, within the same
-- shift, into the ONE already-open ticket instead of raising a fresh
-- ticket + pop-up notification every time the same out-of-target reading
-- recurs (e.g. 06:00-07:00 and 07:00-08:00 both breach the same target on
-- the same parameter). Confirmed with the user: the existing ticket should
-- stay open and simply log the additional time it recurred; a brand new
-- ticket/alert is only warranted when severity actually changes (e.g.
-- warning -> critical) or the previous one has already been closed.
--
-- Non-destructive: adds two columns and replaces the existing
-- svma_process_deviation_entry function (sql/018) with the same signature
-- and the same "never fails the triggering save" guarantee.

alter table public.deviations
  add column if not exists occurrence_count int not null default 1,
  add column if not exists last_observed_at timestamptz not null default now();

create or replace function public.svma_process_deviation_entry(p_entry_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  ent record; p record; scope_name text; v_deviation_id uuid; fact text; ticket_worthy boolean; v_is_repeat boolean;
begin
  select * into ent from public.parameter_entries where id=p_entry_id;
  if not found or ent.validation_status not in ('warning','critical') then return; end if;
  select pm.*,s.module,s.name section_name into p from public.parameter_master pm join public.parameter_sections s on s.id=pm.section_id where pm.id=ent.parameter_id;
  if not found or p.module not in ('solvent','boiler','quality') then return; end if;
  scope_name:=case when p.module='quality' then 'quality' else 'solvent' end;
  fact:=coalesce(to_char(ent.slot_start,'HH24:MI'),to_char(now(),'HH24:MI'))||' — '||p.section_name||' · '||p.name||': actual '||coalesce(ent.value_numeric::text,ent.value_text,'')||'; target '||coalesce(ent.expected_target,'');

  -- Same parameter, same shift, same severity, still open -> this is the
  -- SAME ongoing issue recurring, not a new one. Extend it instead of
  -- creating a sibling deviation/ticket/notification.
  select d.id into v_deviation_id from public.deviations d
   where d.shift_session_id=ent.shift_session_id and d.parameter_id=ent.parameter_id
     and d.severity=ent.validation_status and d.status='open'
   order by d.created_at desc limit 1;

  if v_deviation_id is not null then
    v_is_repeat:=true;
    update public.deviations
      set observed_facts=observed_facts || jsonb_build_array(fact),
          actual_text=coalesce(ent.value_numeric::text,ent.value_text,''),
          occurrence_count=occurrence_count+1,
          last_observed_at=now()
      where id=v_deviation_id;
  else
    v_is_repeat:=false;
    insert into public.deviations(entry_id,shift_session_id,parameter_id,severity,target_text,actual_text,status,observed_facts)
    values(ent.id,ent.shift_session_id,ent.parameter_id,ent.validation_status,ent.expected_target,coalesce(ent.value_numeric::text,ent.value_text,''),'open',jsonb_build_array(fact))
    returning id into v_deviation_id;
  end if;

  -- A repeat never gets its own ticket or pop-up — the existing open
  -- ticket for this deviation already covers it (occurrence_count/
  -- last_observed_at on the deviation itself is the visible "still
  -- happening" record). Everything below this point is therefore skipped
  -- entirely for a repeat.
  if v_is_repeat then return; end if;

  -- Per-parameter admin control (Sections M/AL): 'none' never tickets,
  -- 'critical' tickets only a critical reading, otherwise (default
  -- 'warning') every deviation tickets — restores the configurable
  -- threshold the UI already exposes but neither the app layer nor the
  -- original trigger actually honoured.
  ticket_worthy:=coalesce(p.ticket_enabled,true) and (
    coalesce(p.ticket_severity_threshold,'warning')='warning'
    or (p.ticket_severity_threshold='critical' and ent.validation_status='critical')
  );
  if ticket_worthy and not exists(select 1 from public.deviation_tickets t where t.deviation_id=v_deviation_id) then
    insert into public.deviation_tickets(ticket_no,deviation_id,status,due_at)
    values('SVMA-'||case when scope_name='quality' then 'QC-' else 'SOL-' end||to_char(now(),'YYYYMMDD')||'-'||replace(ent.id::text,'-',''),v_deviation_id,'open',now()+interval '2 hours');
  end if;

  if coalesce(p.alert_enabled,true) then
    insert into public.notifications(user_id,event_type,title,body,severity,entity_type,entity_id,dedupe_key)
    select recipients.user_id,scope_name||'_parameter_deviation',upper(ent.validation_status)||' • '||p.name,fact,ent.validation_status,'deviation',v_deviation_id::text,'deviation:'||ent.id::text||':'||recipients.user_id::text
    from (select ent.entered_by user_id union select ur.user_id from public.user_roles ur where ur.role::text in ('super_admin','admin','management','ceo','solvent_head') or (scope_name='quality' and ur.role::text='quality_head')) recipients
    where recipients.user_id is not null on conflict(dedupe_key) do nothing;
  end if;
end $$;
revoke all on function public.svma_process_deviation_entry(uuid) from public;
