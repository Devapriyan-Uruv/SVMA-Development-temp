-- SVMA AI Intelligence Platform V2.4
-- Product-aware Solvent + Quality capture and intelligence.
-- Run ONCE after V2.3/V2.3.1. Safe to re-run.
-- Finance reconciliation tables and logic are intentionally untouched.

alter table public.shift_sessions
  add column if not exists active_products jsonb not null default '[]'::jsonb;

alter table public.parameter_master
  add column if not exists product_code text,
  add column if not exists sample_frequency text,
  add column if not exists result_latency_minutes int,
  add column if not exists source_file text;

alter table public.parameter_entries
  add column if not exists product_code text not null default 'PLANT';

do $$ begin
  alter table public.parameter_entries
    add constraint parameter_entries_product_code_chk
    check (product_code in ('PLANT','RB','COPRA','PK'));
exception when duplicate_object then null; end $$;

alter table public.parameter_entries
  drop constraint if exists parameter_entries_shift_session_id_parameter_id_slot_start_key;
drop index if exists public.parameter_entries_shift_session_id_parameter_id_slot_start_key;
create unique index if not exists parameter_entries_product_slot_uq
  on public.parameter_entries(shift_session_id,parameter_id,slot_start,product_code);

create unique index if not exists parameter_product_identity_uq
  on public.parameter_master(section_id,product_code,source_group,name);

update public.parameter_master pm
set active=false
from public.parameter_sections ps
where pm.section_id=ps.id and ps.module='quality'
  and coalesce(pm.source_file,'') <> 'LAB REPORTS -AI(1).xlsx';

update public.parameter_sections
set active=false
where module='quality' and name='E) LAB ANALYSING REPORT';

insert into public.parameter_sections(module,name,sort_order,active)
values ('quality','PROCESS LAB REPORT',10,true)
on conflict(module,name) do update set sort_order=excluded.sort_order,active=true;

with src(product_code,source_group,source_serial,name,target_text,input_type,frequency,sample_frequency,result_latency_minutes,options,sort_order,source_review_required) as (
values
('RB','RICE BRAN (FEEDING)','1','% MOISTURE',null,'number','every_two_hours','EVERY-2 hrs.',90,'[]'::jsonb,1,true),
('RB','RICE BRAN (FEEDING)','2','% OIL',null,'number','every_two_hours','EVERY-2 hrs.',150,'[]'::jsonb,2,true),
('RB','RICE BRAN (FEEDING)','3','% FFA',null,'number','every_two_hours','EVERY-2 hrs.',150,'[]'::jsonb,3,true),
('RB','DORB','1','% MOISTURE','11-12','number','hourly','Every Hour',90,'[]'::jsonb,4,false),
('RB','DORB','2','% OIL','0.40','number','hourly','Every Hour',90,'[]'::jsonb,5,false),
('RB','DORB','3','% S&S','4-5','number','every_two_hours','EVERY-2 hrs.',330,'[]'::jsonb,6,false),
('RB','DORB','4','% FIBER','12-13','number','every_4_hours','Every 4 Hrs.',330,'[]'::jsonb,7,false),
('RB','DORB','5','% PROTEIN','14-15','number','hourly','Every Hour',330,'[]'::jsonb,8,false),
('RB','DORB','6','DT FLAME TEST','NIL','select','hourly','Every Hour',5,'["NIL", "PRESENT"]'::jsonb,9,false),
('RB','RB OIL','1','% FFA','4-20','number','every_4_hours','Every 4 Hr.',30,'[]'::jsonb,10,false),
('RB','RB OIL','2','% MOISTURE','0.20','number','every_4_hours','Every 4 Hr.',90,'[]'::jsonb,11,false),
('RB','RB OIL','3','FLASH POINT ( UPTO 120* )','>120°C','number','every_4_hours','Every 4 Hr.',90,'[]'::jsonb,12,false),
('RB','RB OIL','4','% OIL IN MISCELLA','15-18','number','every_4_hours','Every 4 Hr.',150,'[]'::jsonb,13,false),
('RB','RB OIL','5','COLOUR','RED & YELLOW','select','every_4_hours','Every 4 Hr.',150,'["RED & YELLOW", "OTHER"]'::jsonb,14,false),
('RB','RB OIL','6','% WAX','3-3.5','number','every_4_hours','Every 4 Hr.',150,'[]'::jsonb,15,false),
('RB','RB OIL','7','% GUM','1-1.5','number','once_per_shift','ONCE IN A SHIFT',150,'[]'::jsonb,16,false),
('RB','RECUPERATION HOT & COLD OIL','1','HOT OIL MOISTURE',null,'number','once_per_shift','ONCE IN A SHIFT',45,'[]'::jsonb,17,true),
('RB','RECUPERATION HOT & COLD OIL','2','COLD OIL MOISTURE',null,'number','once_per_shift','ONCE FOR SHIFT',90,'[]'::jsonb,18,true),
('RB','RB OIL','8','SEDIMENTS','0.50','number','every_two_hours','Every 2 Hr.',30,'[]'::jsonb,19,false),
('RB','RB OIL','9','IV','8-120','number','every_4_hours','Every 4 Hr.',90,'[]'::jsonb,20,false),
('COPRA','EDIBLE COPRA CAKE','1','% MOISTURE',null,'number','every_4_hours','Every 4 hr.',90,'[]'::jsonb,1,true),
('COPRA','NON-EDIBLE COPRA CAKE','1','% OIL',null,'number','every_4_hours','Every 4 hr.',150,'[]'::jsonb,2,true),
('COPRA','NON-EDIBLE COPRA CAKE','2','% FFA',null,'number','every_4_hours','Every 4 hr.',150,'[]'::jsonb,3,true),
('COPRA','NON-EDIBLE COPRA CAKE','3','SHELL CONTENT',null,'number','every_4_hours','Every 4 hr.',60,'[]'::jsonb,4,true),
('COPRA','NON-EDIBLE COPRA CAKE','4','MILLING DEFECTS',null,'number','every_4_hours','Every 4 hr.',60,'[]'::jsonb,5,true),
('COPRA','COPRA DT','1','% MOISTURE',null,'number','hourly','Every Hour',90,'[]'::jsonb,6,true),
('COPRA','COPRA DT','2','% OIL','0.40','number','hourly','Every Hour',null,'[]'::jsonb,7,false),
('COPRA','COPRA DT','3','SHELL CONTENT',null,'number','once_per_shift',null,null,'[]'::jsonb,8,true),
('COPRA','COPRA DT','4','MILLING DEFECTS',null,'number','once_per_shift',null,null,'[]'::jsonb,9,true),
('COPRA','COPRA DOC - CHIPS','1','% MOISTURE',null,'number','hourly','Every Hour',90,'[]'::jsonb,10,true),
('COPRA','COPRA DOC - CHIPS','2','% OIL','0.40','number','hourly','Every Hour',90,'[]'::jsonb,11,false),
('COPRA','COPRA DOC - CHIPS','3','% S&S',null,'number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,12,true),
('COPRA','COPRA DOC - CHIPS','4','% FIBER','<10','number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,13,false),
('COPRA','COPRA DOC - CHIPS','5','% PROTEIN','22-24','number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,14,false),
('COPRA','NICE - 1','1','% MOISTURE',null,'number','hourly','Every Hour',90,'[]'::jsonb,15,true),
('COPRA','NICE - 1','2','% OIL',null,'number','hourly','Every Hour',90,'[]'::jsonb,16,true),
('COPRA','NICE - 1','3','% S&S',null,'number','once_per_shift','ONCE IN A SHIFT',180,'[]'::jsonb,17,true),
('COPRA','NICE - 1','4','% FIBER',null,'number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,18,true),
('COPRA','NICE - 1','5','% PROTEIN',null,'number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,19,true),
('COPRA','NICE - 2','1','% MOISTURE',null,'number','hourly','Every Hour',90,'[]'::jsonb,20,true),
('COPRA','NICE - 2','2','% OIL',null,'number','hourly','Every Hour',90,'[]'::jsonb,21,true),
('COPRA','NICE - 2','3','% S&S',null,'number','once_per_shift','ONCE IN A SHIFT',180,'[]'::jsonb,22,true),
('COPRA','NICE - 2','4','% FIBER',null,'number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,23,true),
('COPRA','NICE - 2','5','% PROTEIN',null,'number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,24,true),
('COPRA','COPRA OIL','1','% FFA','4-20','number','every_4_hours','Every 4 hr.',30,'[]'::jsonb,25,false),
('COPRA','COPRA OIL','2','% MOISTURE','0.20','number','every_4_hours','Every 4 hr.',90,'[]'::jsonb,26,false),
('COPRA','COPRA OIL','3','IV','8-120','number','every_4_hours','Every 4 hr.',90,'[]'::jsonb,27,false),
('COPRA','COPRA OIL','4','FLASH POINT ( UPTO 120* )','>120°C','number','every_4_hours','Every 4 hr.',150,'[]'::jsonb,28,false),
('COPRA','COPRA OIL','5','% OIL IN MISCELLA','15-18','number','every_two_hours','Every 2 hr.',30,'[]'::jsonb,29,false),
('COPRA','COPRA OIL','6','SEDIMENTS','0.50','number','every_4_hours','Every 4 hr.',45,'[]'::jsonb,30,false),
('COPRA','COPRA OIL','7','COLOUR','RED & YELLOW','select','every_4_hours','Every 4 hr.',150,'["RED & YELLOW", "OTHER"]'::jsonb,31,false),
('COPRA','RECUPERATION HOT & COLD OIL','1','HOT OIL MOISTURE',null,'number','once_per_shift','ONCE FOR SHIFT',90,'[]'::jsonb,32,true),
('COPRA','RECUPERATION HOT & COLD OIL','2','COLD OIL MOISTURE',null,'number','once_per_shift','ONCE FOR SHIFT',90,'[]'::jsonb,33,true),
('COPRA','NICE - 2','6','SHELL CONTENT',null,'number','hourly','Every Hour',30,'[]'::jsonb,34,true),
('COPRA','NICE - 2','7','MILLING DEFECTS',null,'number','hourly','Every Hour',30,'[]'::jsonb,35,true),
('COPRA','NICE - 2','8','DT FLASH',null,'select','hourly','Every Hour',5,'["NIL", "PRESENT"]'::jsonb,36,true),
('PK','PALM KERNEL CAKE','1','% MOISTURE',null,'number','every_4_hours','Every 4 hr.',90,'[]'::jsonb,1,true),
('PK','PALM KERNEL CAKE','2','% OIL',null,'number','every_4_hours','Every 4 hr.',150,'[]'::jsonb,2,true),
('PK','PALM KERNEL CAKE','3','% FFA',null,'number','every_4_hours','Every 4 hr.',150,'[]'::jsonb,3,true),
('PK','PALM KERNEL CAKE','4','SHELL CONTENT',null,'number','every_4_hours','Every 4 hr.',60,'[]'::jsonb,4,true),
('PK','PALM KERNEL CAKE','5','MILLING DEFECTS',null,'number','every_4_hours','Every 4 hr.',60,'[]'::jsonb,5,true),
('PK','PK DT','1','% MOISTURE',null,'number','hourly','Every Hour',90,'[]'::jsonb,6,true),
('PK','PK DT','2','DT FLASH','NIL','select','hourly','Every Hour',5,'["NIL", "PRESENT"]'::jsonb,7,false),
('PK','PK DT','3','% OIL','0.40','number','hourly','Every Hour',90,'[]'::jsonb,8,false),
('PK','PK DT','4','SHELL CONTENT',null,'number','hourly','Every Hour',60,'[]'::jsonb,9,true),
('PK','PK DT','5','MILLING DEFECTS',null,'number','hourly','Every Hour',60,'[]'::jsonb,10,true),
('PK','PK - CHIPS','1','% S&S',null,'number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,11,true),
('PK','PK - CHIPS','2','% FIBER',null,'number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,12,true),
('PK','PK - CHIPS','3','% PROTEIN','15-16','number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,13,false),
('PK','NICE - 1','1','% S&S',null,'number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,14,true),
('PK','NICE - 1','2','% FIBER',null,'number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,15,true),
('PK','NICE - 1','3','% PROTEIN',null,'number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,16,true),
('PK','NICE - 2','1','% S&S',null,'number','once_per_shift','ONCE IN A SHIFT',180,'[]'::jsonb,17,true),
('PK','NICE - 2','2','% FIBER',null,'number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,18,true),
('PK','NICE - 2','3','% PROTEIN',null,'number','once_per_shift','ONCE IN A SHIFT',330,'[]'::jsonb,19,true),
('PK','PK OIL','1','% FFA','4-20','number','every_4_hours','Every 4 hr.',30,'[]'::jsonb,20,false),
('PK','PK OIL','2','% MOISTURE','0.20','number','every_4_hours','Every 4 hr.',90,'[]'::jsonb,21,false),
('PK','PK OIL','3','IV','8-120','number','every_4_hours','Every 4 hr.',90,'[]'::jsonb,22,false),
('PK','PK OIL','4','FLASH POINT ( UPTO 120* )','>120°C','number','every_4_hours','Every 4 hr.',150,'[]'::jsonb,23,false),
('PK','PK OIL','5','% OIL IN MISCELLA','15-18','number','every_two_hours','Every 2 hr.',30,'[]'::jsonb,24,false),
('PK','PK OIL','6','SEDIMENTS','0.50','number','every_4_hours','Every 4 hr.',45,'[]'::jsonb,25,false),
('PK','PK OIL','7','COLOUR','RED & YELLOW','select','every_4_hours','Every 4 hr.',150,'["RED & YELLOW", "OTHER"]'::jsonb,26,false),
('PK','RECUPERATION HOT & COLD OIL','1','HOT OIL MOISTURE',null,'number','once_per_shift','ONCE FOR SHIFT',90,'[]'::jsonb,27,true),
('PK','RECUPERATION HOT & COLD OIL','2','COLD OIL MOISTURE',null,'number','once_per_shift','ONCE FOR SHIFT',90,'[]'::jsonb,28,true),
('PK','PK - CHIPS','4','% MOISTURE',null,'number','hourly','Every Hour',90,'[]'::jsonb,29,true),
('PK','NICE - 1','4','% MOISTURE',null,'number','hourly','Every Hour',90,'[]'::jsonb,30,true),
('PK','NICE - 2','4','% MOISTURE',null,'number','hourly','Every Hour',90,'[]'::jsonb,31,true)
)
insert into public.parameter_master(
  section_id,source_ref,source_file,source_page,source_serial,source_group,source_text,
  product_code,name,unit,target_text,input_type,frequency,sample_frequency,
  result_latency_minutes,mandatory,alert_enabled,ticket_enabled,options,
  sort_order,active,source_review_required
)
select
  ps.id,'LAB REPORTS -AI(1).xlsx','LAB REPORTS -AI(1).xlsx',null,
  src.source_serial,src.source_group,
  src.product_code||' / '||src.source_group||' / '||src.name,
  src.product_code,src.name,
  case
    when upper(src.name) like '%MOISTURE%' or upper(src.name) like '%OIL%' or upper(src.name) like '%FFA%'
      or upper(src.name) like '%FIBER%' or upper(src.name) like '%PROTEIN%' or upper(src.name) like '%S&S%'
      or upper(src.name) like '%WAX%' or upper(src.name) like '%GUM%' or upper(src.name) like '%SEDIMENT%'
      then '%'
    when upper(src.name) like '%FLASH%' then '°C'
    else null
  end,
  src.target_text,src.input_type,src.frequency,src.sample_frequency,
  src.result_latency_minutes,true,true,true,src.options,src.sort_order,true,src.source_review_required
from src
join public.parameter_sections ps on ps.module='quality' and ps.name='PROCESS LAB REPORT'
on conflict(section_id,product_code,source_group,name)
do update set
  source_ref=excluded.source_ref,source_file=excluded.source_file,
  source_serial=excluded.source_serial,source_text=excluded.source_text,
  unit=excluded.unit,target_text=excluded.target_text,input_type=excluded.input_type,
  frequency=excluded.frequency,sample_frequency=excluded.sample_frequency,
  result_latency_minutes=excluded.result_latency_minutes,options=excluded.options,
  sort_order=excluded.sort_order,active=true,source_review_required=excluded.source_review_required;

update public.parameter_entries set product_code='PLANT'
where product_code is null or btrim(product_code)='';

insert into public.user_module_access(user_id,module,can_view)
select ur.user_id,m.module,true
from public.user_roles ur
cross join (values
 ('ceo'),('solvent_management'),('quality_management'),
 ('finance_transaction'),('finance_vendor_payment'),
 ('input'),('quality_input')
) as m(module)
where ur.role='super_admin'
on conflict(user_id,module) do update set can_view=true;
