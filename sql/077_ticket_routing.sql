-- Tickets module: who is intimated, who reports to the MD office and who may close a ticket, per plant area
-- (source: "Plant Safety | Reporting and Ticket Closure" tracker). Safe to re-run.
--
-- Run order: create the users first (scripts/create-ticket-users.mjs), then this file — the people below are looked up by e-mail.
-- Mr. Jagadeesan of the tracker is the existing account jegadeesh@svma.app.
-- Nothing here changes how tickets are raised; a separate trigger only adds notifications for the routed people.

create table if not exists public.ticket_route_areas(
 id bigserial primary key,
 area text not null unique,
 scope text not null check (scope in ('solvent','quality','both')),
 sort_order int not null default 0
);
create table if not exists public.ticket_route_sections(
 area_id bigint not null references public.ticket_route_areas(id) on delete cascade,
 section_id bigint not null unique references public.parameter_sections(id) on delete cascade,
 primary key(area_id,section_id)
);
create table if not exists public.ticket_route_people(
 area_id bigint not null references public.ticket_route_areas(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 role text not null check (role in ('intimate','md','closer')),
 primary key(area_id,user_id,role)
);
create index if not exists idx_ticket_route_people_user on public.ticket_route_people(user_id);

-- MD Office tracking columns of the tracker (reported to JMD, dates, remarks).
create table if not exists public.ticket_md_followup(
 ticket_id uuid primary key references public.deviation_tickets(id) on delete cascade,
 reported_to_jmd boolean not null default false,
 jmd_report_date date,
 target_closure date,
 md_remarks text,
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now()
);
-- Every status change made in the Tickets module (reopened tickets are counted from here).
create table if not exists public.ticket_events(
 id bigserial primary key,
 ticket_id uuid not null references public.deviation_tickets(id) on delete cascade,
 event text not null,
 from_status text,
 to_status text,
 note text,
 by_user uuid references public.profiles(id),
 at timestamptz not null default now()
);
create index if not exists idx_ticket_events_ticket on public.ticket_events(ticket_id,at desc);

alter table public.ticket_route_areas enable row level security;
alter table public.ticket_route_sections enable row level security;
alter table public.ticket_route_people enable row level security;
alter table public.ticket_md_followup enable row level security;
alter table public.ticket_events enable row level security;

-- ---------------------------------------------------------------------------------------------------------------
-- Notify the routed people when a ticket is raised. Separate AFTER INSERT trigger: the function that raises tickets is
-- not touched, and a failure here can never block a ticket (the exception is swallowed).
create or replace function public.ticket_route_notify() returns trigger language plpgsql security definer set search_path=public as $$
declare v_area bigint; v_area_name text; v_param text; v_sev text; v_fact text;
begin
 select a.id,a.area,p.name,d.severity,coalesce(d.actual_text,'')||case when d.target_text is not null then ' (target '||d.target_text||')' else '' end
   into v_area,v_area_name,v_param,v_sev,v_fact
 from public.deviations d
 join public.parameter_master p on p.id=d.parameter_id
 join public.ticket_route_sections s on s.section_id=p.section_id
 join public.ticket_route_areas a on a.id=s.area_id
 where d.id=new.deviation_id;
 if v_area is null then return new; end if;
 insert into public.notifications(user_id,event_type,title,body,severity,entity_type,entity_id,dedupe_key)
 select r.user_id,'ticket_routed',
        'Ticket '||new.ticket_no||' • '||v_area_name,
        v_param||' — '||v_fact||'. You are '||case min(case r.role when 'closer' then 1 when 'md' then 2 else 3 end) when 1 then 'the closer' when 2 then 'in the MD Office' else 'intimated' end||' for this area.',
        coalesce(v_sev,'warning'),'ticket',new.id::text,'ticket_route:'||new.id::text||':'||r.user_id::text
 from public.ticket_route_people r where r.area_id=v_area
 group by r.user_id
 on conflict(dedupe_key) do nothing;
 return new;
exception when others then
 return new;
end $$;
drop trigger if exists trg_ticket_route_notify on public.deviation_tickets;
create trigger trg_ticket_route_notify after insert on public.deviation_tickets for each row execute function public.ticket_route_notify();

-- ---------------------------------------------------------------------------------------------------------------
-- Routing data. People are looked up by e-mail; any who do not exist yet are skipped (re-run this file after creating them).
-- Sections: the checklist headings of the Solvent / Quality parameter sections that belong to each tracker area.
drop table if exists _areas;
create temp table _areas(area text,scope text,sort_order int,sections text[]);
insert into _areas values
 ('Lab Analysis Report','both',1,array['E) LAB ANALYSING REPORT','PROCESS LAB REPORT','Lab Analysing Report']),
 ('Extractor — First Floor','solvent',2,array['D) EXTRACTOR (1ST FLOOR)','Extractor']),
 ('RO Plant','solvent',3,array['RO']),
 ('Cooling Pond','solvent',4,array['C) COOLING POND','Cooling Pond']),
 ('Second Floor','solvent',5,array['E) SECOND FLOOR','Second Floor']),
 ('Workshop','solvent',6,array['WORKSHOP']),
 ('Packing Godown','solvent',7,array['H) PACKING GODOWN','Packing Godown']),
 ('Preparatory Section','solvent',8,array['F) PREPARATORY','Preparatory']),
 ('Raw Material Godown','solvent',9,array['G) RAW MATERIAL GODOWN','Raw Material Godown']),
 ('Refinery Plant','solvent',10,array['REFINERY PLANT SAFETY CHECKLIST']),
 ('Desolventiser-Toaster (DT)','solvent',11,array['B) DESOLVENDIZER TOSTER (DT)','Desolventizer Toaster (DT)']),
 ('CVL Boiler, Veesons Boiler and Softener','solvent',12,array['CVL BOILER','VESION BOILER','CVL Boiler','Vision Boiler','Boiler','SOFTNER']),
 ('Soya Bari Section','solvent',13,array[]::text[]),
 -- Not in the tracker: held by Mr. Jagadeesan (intimated, MD Office and closer) until their own routing is decided.
 ('Hexane Tank','solvent',14,array['A) HEXANE TANK','Hexane Tank']),
 ('Ground Floor','solvent',15,array['GROUND FLOOR','Ground Floor']),
 ('Palvarizer Godown','solvent',16,array['I) PALVARIZER GODOWN','Palvarizer Godown']),
 ('Factory General Safety','solvent',17,array['J) FACTORY GENERAL SAFETY','Factory General Safety']),
 ('ETP','solvent',18,array['ETP']),
 ('Thermic Fluid Boiler','solvent',19,array['THERMIC FLUID BOILER']);

insert into public.ticket_route_areas(area,scope,sort_order) select area,scope,sort_order from _areas
on conflict(area) do update set scope=excluded.scope,sort_order=excluded.sort_order;

insert into public.ticket_route_sections(area_id,section_id)
select a.id,ps.id from _areas x join public.ticket_route_areas a on a.area=x.area
join public.parameter_sections ps on ps.name=any(x.sections)
on conflict do nothing;

-- area | role | person (e-mail)
drop table if exists _people;
create temp table _people(area text,role text,email text);
insert into _people values
 -- Intimated (Persons to Be Intimated)
 ('Lab Analysis Report','intimate','mohan@svma.app'),('Lab Analysis Report','intimate','raghu@svma.app'),('Lab Analysis Report','intimate','leela@svma.app'),('Lab Analysis Report','intimate','sekar@svma.app'),('Lab Analysis Report','intimate','mamachan@svma.app'),('Lab Analysis Report','intimate','prabahar@svma.app'),
 ('Extractor — First Floor','intimate','mamachan@svma.app'),('Extractor — First Floor','intimate','prabahar@svma.app'),('Extractor — First Floor','intimate','subramani@svma.app'),
 ('RO Plant','intimate','pandiyaraj@svma.app'),('RO Plant','intimate','tamil@svma.app'),('RO Plant','intimate','prabahar@svma.app'),
 ('Cooling Pond','intimate','mamachan@svma.app'),('Cooling Pond','intimate','pandiyaraj@svma.app'),('Cooling Pond','intimate','prabahar@svma.app'),
 ('Second Floor','intimate','mamachan@svma.app'),('Second Floor','intimate','prabahar@svma.app'),('Second Floor','intimate','subramani@svma.app'),
 ('Workshop','intimate','subramani@svma.app'),('Workshop','intimate','tamil@svma.app'),('Workshop','intimate','prabahar@svma.app'),
 ('Packing Godown','intimate','murugasen.godown@svma.app'),('Packing Godown','intimate','mamachan@svma.app'),('Packing Godown','intimate','subramani@svma.app'),('Packing Godown','intimate','prabahar@svma.app'),
 ('Preparatory Section','intimate','mamachan@svma.app'),('Preparatory Section','intimate','murugasen.godown@svma.app'),('Preparatory Section','intimate','subramani@svma.app'),('Preparatory Section','intimate','prabahar@svma.app'),
 ('Raw Material Godown','intimate','murugasen.godown@svma.app'),('Raw Material Godown','intimate','subramani@svma.app'),('Raw Material Godown','intimate','mamachan@svma.app'),('Raw Material Godown','intimate','prabahar@svma.app'),
 ('Refinery Plant','intimate','tamil@svma.app'),('Refinery Plant','intimate','prabahar@svma.app'),
 ('Desolventiser-Toaster (DT)','intimate','mamachan@svma.app'),('Desolventiser-Toaster (DT)','intimate','subramani@svma.app'),('Desolventiser-Toaster (DT)','intimate','prabahar@svma.app'),
 ('CVL Boiler, Veesons Boiler and Softener','intimate','tamil@svma.app'),('CVL Boiler, Veesons Boiler and Softener','intimate','pandiyaraj@svma.app'),('CVL Boiler, Veesons Boiler and Softener','intimate','prabahar@svma.app'),
 ('Soya Bari Section','intimate','sahul@svma.app'),('Soya Bari Section','intimate','saravanan@svma.app'),('Soya Bari Section','intimate','prabahar@svma.app'),
 -- MD Office reporting
 ('Lab Analysis Report','md','jegadeesh@svma.app'),('Lab Analysis Report','md','murugesan@svma.app'),
 ('Extractor — First Floor','md','jegadeesh@svma.app'),('RO Plant','md','jegadeesh@svma.app'),('Cooling Pond','md','jegadeesh@svma.app'),('Second Floor','md','jegadeesh@svma.app'),
 ('Workshop','md','jegadeesh@svma.app'),('Packing Godown','md','jegadeesh@svma.app'),('Preparatory Section','md','jegadeesh@svma.app'),('Raw Material Godown','md','jegadeesh@svma.app'),
 ('Refinery Plant','md','jegadeesh@svma.app'),('Desolventiser-Toaster (DT)','md','jegadeesh@svma.app'),('CVL Boiler, Veesons Boiler and Softener','md','jegadeesh@svma.app'),('Soya Bari Section','md','jegadeesh@svma.app'),
 -- Ticket closed by
 ('Lab Analysis Report','closer','leela@svma.app'),
 ('Lab Analysis Report','closer','sekar@svma.app'),
 ('Extractor — First Floor','closer','mamachan@svma.app'),
 ('RO Plant','closer','pandiyaraj@svma.app'),
 ('Cooling Pond','closer','mamachan@svma.app'),
 ('Second Floor','closer','mamachan@svma.app'),
 ('Workshop','closer','subramani@svma.app'),
 ('Packing Godown','closer','murugasen.godown@svma.app'),
 ('Preparatory Section','closer','subramani@svma.app'),
 ('Raw Material Godown','closer','murugasen.godown@svma.app'),
 ('Refinery Plant','closer','tamil@svma.app'),
 ('Desolventiser-Toaster (DT)','closer','mamachan@svma.app'),
 ('CVL Boiler, Veesons Boiler and Softener','closer','pandiyaraj@svma.app'),
 ('Soya Bari Section','closer','sahul@svma.app'),
 -- Held by Mr. Jagadeesan for now
 ('Hexane Tank','intimate','jegadeesh@svma.app'),
 ('Hexane Tank','md','jegadeesh@svma.app'),
 ('Hexane Tank','closer','jegadeesh@svma.app'),
 ('Ground Floor','intimate','jegadeesh@svma.app'),
 ('Ground Floor','md','jegadeesh@svma.app'),
 ('Ground Floor','closer','jegadeesh@svma.app'),
 ('Palvarizer Godown','intimate','jegadeesh@svma.app'),
 ('Palvarizer Godown','md','jegadeesh@svma.app'),
 ('Palvarizer Godown','closer','jegadeesh@svma.app'),
 ('Factory General Safety','intimate','jegadeesh@svma.app'),
 ('Factory General Safety','md','jegadeesh@svma.app'),
 ('Factory General Safety','closer','jegadeesh@svma.app'),
 ('ETP','intimate','jegadeesh@svma.app'),
 ('ETP','md','jegadeesh@svma.app'),
 ('ETP','closer','jegadeesh@svma.app'),
 ('Thermic Fluid Boiler','intimate','jegadeesh@svma.app'),
 ('Thermic Fluid Boiler','md','jegadeesh@svma.app'),
 ('Thermic Fluid Boiler','closer','jegadeesh@svma.app');

insert into public.ticket_route_people(area_id,user_id,role)
select a.id,p.id,x.role from _people x
join public.ticket_route_areas a on a.area=x.area
join public.profiles p on lower(p.email)=x.email
on conflict do nothing;

-- Report what was routed and who could not be found yet.
select 'people not found yet' as note, string_agg(distinct x.email,', ') as emails
from _people x left join public.profiles p on lower(p.email)=x.email where p.id is null;
select a.area, count(distinct s.section_id) as sections, count(distinct r.user_id) filter (where r.role='closer') as closers
from public.ticket_route_areas a left join public.ticket_route_sections s on s.area_id=a.id left join public.ticket_route_people r on r.area_id=a.id
group by a.id,a.area,a.sort_order order by a.sort_order;

-- (the two temporary tables _areas and _people vanish when the session ends)
