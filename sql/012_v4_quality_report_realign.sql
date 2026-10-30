-- SVMA AI Intelligence Platform V4 -- QC Data Entry realignment
-- Generated from the three newly-attached PDF lab report forms
-- (PK_LAB_REPORTS.pdf, COPRA_LAB_REPORTS.pdf, RB_LAB_REPORTS.pdf, Shift I
-- block, hand-transcribed -- see QUALITY_MAPPING.md 'V4 realignment' for
-- the full row-by-row rationale). This supersedes the 011 import (itself
-- derived from LAB REPORTS AI 1.xlsx) -- it does NOT reuse 011's targets.
-- Run ONCE after 010/011. Safe to re-run.

-- Supersede the prior programmatic Quality import: deactivate every existing
-- 'PROCESS LAB REPORT' parameter so only this PDF-faithful set is active.
-- Nothing is deleted -- history/audit trail on already-submitted entries is
-- preserved (parameter_entries keeps its own parameter_id FK), and any
-- parameter this file also defines is reactivated by the upsert below.
update public.parameter_master pm
set active=false
from public.parameter_sections ps
where pm.section_id=ps.id and ps.module='quality' and ps.name='PROCESS LAB REPORT';

with src(product_code,source_group,source_serial,name,target_text,input_type,frequency,sample_frequency,result_latency_minutes,unit,options,sort_order,source_review_required) as (
values
('PK','PALM KERNAL CAKE','1','% MOISTURE','5 - 8','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,1,false),
('PK','PALM KERNAL CAKE','2','% OIL','15','number','every_4_hours','Every 4 hr.',150,'%','[]'::jsonb,2,true),
('PK','PALM KERNAL CAKE','3','% FFA','5 - 25','number','every_4_hours','Every 4 hr.',150,'%','[]'::jsonb,3,false),
('PK','PALM KERNAL CAKE','4','IV','15 - 25','number','every_4_hours','Every 4 hr.',90,null,'[]'::jsonb,4,false),
('PK','PALM KERNAL CAKE','5','SHELL CONTENT','< 1.5','number','every_4_hours','Every 4 hr.',60,'%','[]'::jsonb,5,false),
('PK','PALM KERNAL CAKE','6','MILLING DEFECTS','< 1','number','every_4_hours','Every 4 hr.',60,'%','[]'::jsonb,6,false),
('PK','PK DT','7','% MOISTURE','< 7','number','hourly','Every Hour',90,'%','[]'::jsonb,7,false),
('PK','PK DT','8','DT FLASH',null,'select','hourly','Every Hour',3,null,'["NIL","PRESENT"]'::jsonb,8,false),
('PK','PK DT','9','% OIL','< 0.35','number','hourly','Every Hour',90,'%','[]'::jsonb,9,false),
('PK','PK DT','10','SHELL CONTENT','< 1.5','number','hourly','Every Hour',30,'%','[]'::jsonb,10,false),
('PK','PK DT','11','MILLING DEFECTS','< 1','number','hourly','Every Hour',30,'%','[]'::jsonb,11,false),
('PK','PK - CHIPS','12','% MOISTURE','10 - 11','number','hourly','Every Hour',90,'%','[]'::jsonb,12,false),
('PK','PK - CHIPS','13','% S&S','< 2','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,13,false),
('PK','PK - CHIPS','14','% FIBER','30','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,14,true),
('PK','PK - CHIPS','15','% PROTEIN','10 - 12','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,15,false),
('PK','NICE- 1','16','% MOISTURE','6','number','hourly','EVERY HOUR',90,'%','[]'::jsonb,16,true),
('PK','NICE- 1','17','% S&S','2','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,17,true),
('PK','NICE- 1','18','% FIBER','< 20','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,18,false),
('PK','NICE- 1','19','% PROTEIN','10 - 12','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,19,false),
('PK','NICE - 2','20','% MOISTURE','6','number','hourly','EVERY HOUR',90,'%','[]'::jsonb,20,true),
('PK','NICE - 2','21','% S&S','2','number','once_per_shift','ONCE IN A SHIFT',180,'%','[]'::jsonb,21,true),
('PK','NICE - 2','22','% FIBER','< 20','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,22,false),
('PK','NICE - 2','23','% PROTEIN','10 - 12','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,23,false),
('PK','PK OIL','24','% FFA','5 - 25','number','every_4_hours','Every 4 hr.',30,'%','[]'::jsonb,24,false),
('PK','PK OIL','25','% MOISTURE','0.20','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,25,true),
('PK','PK OIL','26','IV (IODINE VALUE)','15 - 24','number','every_4_hours','Every 4 hr.',90,null,'[]'::jsonb,26,false),
('PK','PK OIL','27','FLASH POINT','< 120* NIL','number','every_4_hours','Every 4 hr.',150,'°C','[]'::jsonb,27,true),
('PK','PK OIL','28','% OIL IN MISCELLA','12 - 15','number','every_two_hours','Every 2 hr.',30,'%','[]'::jsonb,28,false),
('PK','PK OIL','29','SEDIMENTS %','0.50','number','once_per_shift','ONCE IN A SHIFT',60,'%','[]'::jsonb,29,true),
('PK','RECUPERATION HOT OIL','30','HOT OIL MOISTURE','1.5','number','once_per_shift','ONCE IN A SHIFT',90,'%','[]'::jsonb,30,true),
('PK','RECUPERATION OIL COLD','31','COLD OIL MOISTURE','2.5','number','once_per_shift','ONCE IN A SHIFT',90,'%','[]'::jsonb,31,true),
('PK','MOISTURE DIFFERENCE','32','LIMIT < 1 %','1.0','number','once_per_shift','ONCE IN A SHIFT',null,null,'[]'::jsonb,32,true),
('COPRA','EDIBLE COPRA CAKE','1','% MOISTURE','< 7','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,1,false),
('COPRA','NON-EDIBLE COPRA CAKE','2','% OIL','7 - 15','number','every_4_hours','Every 4 hr.',150,'%','[]'::jsonb,2,false),
('COPRA','NON-EDIBLE COPRA CAKE','3','% FFA','3 - 15','number','every_4_hours','Every 4 hr.',150,'%','[]'::jsonb,3,false),
('COPRA','NON-EDIBLE COPRA CAKE','4','SHELL CONTENT','< 1','number','every_4_hours','Every 4 hr.',60,'%','[]'::jsonb,4,false),
('COPRA','NON-EDIBLE COPRA CAKE','5','MILLING DEFECTS','< 1','number','every_4_hours','Every 4 hr.',60,'%','[]'::jsonb,5,false),
('COPRA','COPRA DT','6','% MOISTURE','< 10','number','hourly','Every Hour',90,'%','[]'::jsonb,6,false),
('COPRA','COPRA DT','7','% OIL','< 0.40','number','hourly','Every Hour',90,'%','[]'::jsonb,7,false),
('COPRA','COPRA DT','8','SHELL CONTENT','< 1','number','hourly','Every Hour',30,'%','[]'::jsonb,8,false),
('COPRA','COPRA DT','9','MILLING DEFECTS','< 1','number','hourly','Every Hour',30,'%','[]'::jsonb,9,false),
('COPRA','COPRA DT','10','DT FLASH',null,'select','hourly','Every Hour',2,null,'["NIL","PRESENT"]'::jsonb,10,false),
('COPRA','COPRA DOC - CHIPS','11','% MOISTURE','< 10','number','hourly','Every Hour',90,'%','[]'::jsonb,11,false),
('COPRA','COPRA DOC - CHIPS','12','% S&S','< 2','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,12,false),
('COPRA','COPRA DOC - CHIPS','13','% FIBER','< 12','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,13,false),
('COPRA','COPRA DOC - CHIPS','14','% PROTEIN','> 23','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,14,false),
('COPRA','NICE - 1','15','% MOISTURE','< 7','number','hourly','Every Hour',90,'%','[]'::jsonb,15,false),
('COPRA','NICE - 1','16','% S&S','< 2','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,16,false),
('COPRA','NICE - 1','17','% FIBER','< 10','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,17,false),
('COPRA','NICE - 1','18','% PROTEIN','> 20','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,18,false),
('COPRA','NICE - 2','19','% MOISTURE','< 7','number','hourly','Every Hour',90,'%','[]'::jsonb,19,false),
('COPRA','NICE - 2','20','% S&S','< 2','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,20,false),
('COPRA','NICE - 2','21','% FIBER','< 10','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,21,false),
('COPRA','NICE - 2','22','% PROTEIN','> 20','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,22,false),
('COPRA','COPRA OIL','23','% FFA','3 - 15','number','every_4_hours','Every 4 hr.',30,'%','[]'::jsonb,23,false),
('COPRA','COPRA OIL','24','% MOISTURE','< 0.25','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,24,false),
('COPRA','COPRA OIL','25','IV','8 - 15','number','every_4_hours','Every 4 hr.',90,null,'[]'::jsonb,25,false),
('COPRA','COPRA OIL','26','FLASH POINT','> 120* NIL','number','every_4_hours','Every 4 hr.',150,'°C','[]'::jsonb,26,true),
('COPRA','COPRA OIL','27','% OIL IN MISCELLA','< 15','number','every_two_hours','Every 2 hr.',30,'%','[]'::jsonb,27,false),
('COPRA','COPRA OIL','28','SEDIMENTS','< 0.50','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,28,false),
('COPRA','COPRA OIL','29','COLOUR (IN 1/2" CELL)','< 70 UNITS','number','every_4_hours','Every 4 hr.',150,'UNITS','[]'::jsonb,29,false),
('COPRA','RECUPERATION HOT OIL','30','HOT OIL MOISTURE','1.5','number','once_per_shift','ONCE IN A SHIFT',90,'%','[]'::jsonb,30,true),
('COPRA','RECUPERATION COLD OIL','31','COLD OIL MOISTURE','2.5','number','once_per_shift','ONCE IN A SHIFT',90,'%','[]'::jsonb,31,true),
('COPRA','MOISTURE DIFFERENCE','32','LIMIT < 1 %','1','number','once_per_shift','ONCE IN A SHIFT',480,null,'[]'::jsonb,32,true),
('RB','RICE BRAN (FEEDING)','1','% MOISTURE','8 - 10','number','every_two_hours','EVERY-2 hrs.',90,'%','[]'::jsonb,1,false),
('RB','RICE BRAN (FEEDING)','2','% OIL','15 - 25','number','every_two_hours','EVERY-2 hrs.',150,'%','[]'::jsonb,2,false),
('RB','RICE BRAN (FEEDING)','3','% FFA','4 - 30','number','every_two_hours','EVERY-2 hrs.',150,'%','[]'::jsonb,3,false),
('RB','DORB','4','% MOISTURE','10.5 - 12','number','hourly','Every Hour',90,'%','[]'::jsonb,4,false),
('RB','DORB','5','% OIL','< 0.40','number','hourly','Every Hour',90,'%','[]'::jsonb,5,false),
('RB','DORB','6','% S&S','< 5','number','every_two_hours','EVERY-2 hrs.',330,'%','[]'::jsonb,6,false),
('RB','DORB','7','% FIBER','10 - 14','number','every_two_hours','EVERY-2 hrs.',330,'%','[]'::jsonb,7,false),
('RB','DORB','8','% PROTEIN','14.5 - 16','number','every_4_hours','Every 4 hrs.',330,'%','[]'::jsonb,8,false),
('RB','DORB','9','DT FLASH TEST',null,'select','hourly','Every Hour',2,null,'["NIL","PRESENT"]'::jsonb,9,false),
('RB','RB OIL','10','% FFA','4 - 30','number','every_4_hours','Every 4 Hr.',30,'%','[]'::jsonb,10,false),
('RB','RB OIL','11','% MOISTURE & IMPURITIES','< 0.20','number','every_4_hours','Every 4 Hr.',90,'%','[]'::jsonb,11,false),
('RB','RB OIL','12','FLASH POINT','> 120* NIL','number','every_4_hours','Every 4 Hr.',90,'°C','[]'::jsonb,12,true),
('RB','RB OIL','13','% OIL IN MISCELLA','16 - 18','number','every_4_hours','Every 4 Hr.',30,'%','[]'::jsonb,13,false),
('RB','RB OIL','14','COLOUR (IN 1/4" CELL)','> 40 UNITS','number','every_two_hours','Every 2 Hr.',150,'UNITS','[]'::jsonb,14,false),
('RB','RB OIL','15','% WAX','2.5 - 3.5','number','once_per_shift','ONCE IN A SHIFT',150,'%','[]'::jsonb,15,false),
('RB','RB OIL','16','% GUM','1 - 1.5','number','once_per_shift','ONCE IN A SHIFT',45,'%','[]'::jsonb,16,false),
('RB','RECUPERATION HOT OIL','17','HOT OIL MOISTURE','1.5','number','once_per_shift','ONCE IN A SHIFT',90,'%','[]'::jsonb,17,true),
('RB','RECUPERATION COLD OIL','18','COLD OIL MOISTURE','2.5','number','once_per_shift','ONCE IN A SHIFT',90,'%','[]'::jsonb,18,true),
('RB','MOISTURE DIFFERENCE','19','LIMIT < 1 %','1','number','once_per_shift','ONCE IN A SHIFT',480,null,'[]'::jsonb,19,true)
)
insert into public.parameter_master(
  section_id,source_ref,source_file,source_serial,source_group,source_text,
  product_code,name,unit,target_text,input_type,frequency,sample_frequency,
  result_latency_minutes,mandatory,alert_enabled,ticket_enabled,options,
  sort_order,active,source_review_required
)
select
  ps.id,
  case src.product_code
    when 'PK' then 'PK_LAB_REPORTS.pdf'
    when 'COPRA' then 'COPRA_LAB_REPORTS.pdf'
    else 'RB_LAB_REPORTS.pdf' end,
  case src.product_code
    when 'PK' then 'PK_LAB_REPORTS.pdf'
    when 'COPRA' then 'COPRA_LAB_REPORTS.pdf'
    else 'RB_LAB_REPORTS.pdf' end,
  src.source_serial,src.source_group,
  src.product_code||' / '||src.source_group||' / '||src.name,
  src.product_code,src.name,src.unit,src.target_text,src.input_type,src.frequency,
  src.sample_frequency,src.result_latency_minutes,true,true,true,src.options,
  src.sort_order,true,src.source_review_required
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

