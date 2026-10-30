-- SVMA AI Intelligence Platform V3 -- Full Quality parameter import
-- Generated PROGRAMMATICALLY from the attached workbook 'LAB REPORTS -AI(1).xlsx'
-- (openpyxl, data_only=True) -- see QUALITY_MAPPING.md for the exact method,
-- confirmed column mapping (E & NE COPRA=K, RB=O, PK-=K) and every defensive-
-- parsing rule applied. This supersedes the partial, hand-typed Quality list
-- added by 009_v2_4_product_intelligence.sql with the complete, faithfully-
-- parsed set from the actual workbook -- it does NOT reuse the old assumptions.
-- Run ONCE after 010_v3_operational_intelligence.sql. Safe to re-run.

-- Supersede the prior hand-typed Quality import: deactivate every existing
-- 'PROCESS LAB REPORT' parameter so only this programmatic, workbook-faithful
-- set is active. Nothing is deleted -- history/audit trail is preserved, and
-- any parameter this file also defines is reactivated by the upsert below.
update public.parameter_master pm
set active=false
from public.parameter_sections ps
where pm.section_id=ps.id and ps.module='quality' and ps.name='PROCESS LAB REPORT';

with src(product_code,source_group,source_serial,name,target_text,input_type,frequency,sample_frequency,result_latency_minutes,unit,options,sort_order,source_review_required) as (
values
('COPRA','EDIBLE COPRA CAKE','1','% MOISTURE','BELOW - 7 %','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,1,false),
('COPRA','NON-EDIBLE COPRA CAKE','2','% OIL','7 - 15  %','number','every_4_hours','Every 4 hr.',150,'%','[]'::jsonb,2,false),
('COPRA','NON-EDIBLE COPRA CAKE','3','% FFA','E - B 5 % & NE -AB.-10 %','number','every_4_hours','Every 4 hr.',150,'%','[]'::jsonb,3,true),
('COPRA','NON-EDIBLE COPRA CAKE','4','SHELL CONTENT','BELOW - 1%','number','every_4_hours','Every 4 hr.',60,'%','[]'::jsonb,4,false),
('COPRA','NON-EDIBLE COPRA CAKE','5','MILLING DEFECTS','BELOW - 1%','number','every_4_hours','Every 4 hr.',60,'%','[]'::jsonb,5,false),
('COPRA','COPRA DT','6','% MOISTURE',null,'number','hourly','Every Hour',90,'%','[]'::jsonb,6,true),
('COPRA','COPRA DT','7','% OIL','Max. - 0.40 %','number','hourly','Every Hour',90,'%','[]'::jsonb,7,false),
('COPRA','COPRA DT','8','SHELL CONTENT','BELOW - 1%','number','hourly','Every Hour',30,'%','[]'::jsonb,8,false),
('COPRA','COPRA DT','9','MILLING DEFECTS','BELOW - 1%','number','hourly','Every Hour',30,'%','[]'::jsonb,9,false),
('COPRA','COPRA DT','10','DT FLASH',null,'select','hourly','Every Hour',5,null,'["NIL","PRESENT"]'::jsonb,10,false),
('COPRA','COPRA DOC - CHIPS','11','% MOISTURE',null,'number','hourly','Every Hour',90,'%','[]'::jsonb,11,true),
('COPRA','COPRA DOC - CHIPS','12','% S&S','MAX. - 2 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,12,false),
('COPRA','COPRA DOC - CHIPS','13','% FIBER','8 - 12 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,13,false),
('COPRA','COPRA DOC - CHIPS','14','% PROTEIN','20 - 23 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,14,false),
('COPRA','NICE - 1','15','% MOISTURE',null,'number','hourly','Every Hour',90,'%','[]'::jsonb,15,true),
('COPRA','NICE - 1','16','% S&S','MAX. - 2 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,16,false),
('COPRA','NICE - 1','17','% FIBER','6 -8 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,17,false),
('COPRA','NICE - 1','18','% PROTEIN','20 - 23 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,18,false),
('COPRA','NICE - 2','19','% MOISTURE',null,'number','hourly','Every Hour',90,'%','[]'::jsonb,19,true),
('COPRA','NICE - 2','20','% S&S','MAX. - 2 %','number','once_per_shift','ONCE IN A SHIFT',180,'%','[]'::jsonb,20,false),
('COPRA','NICE - 2','21','% FIBER','6 -8 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,21,false),
('COPRA','NICE - 2','22','% PROTEIN','20 - 23 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,22,false),
('COPRA','COPRA OIL','23','% FFA','E- B 5 % & NE -AB.-10 %','number','every_4_hours','Every 4 hr.',30,'%','[]'::jsonb,23,true),
('COPRA','COPRA OIL','24','% MOISTURE','MAX. 0.25 %','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,24,false),
('COPRA','COPRA OIL','25','IV','E-8-10 & NE-AB.-10','number','every_4_hours','Every 4 hr.',90,null,'[]'::jsonb,25,true),
('COPRA','COPRA OIL','26','FLASH POINT ( UPTO 120* )',null,'select','every_4_hours','Every 4 hr.',150,null,'["NIL","PRESENT"]'::jsonb,26,false),
('COPRA','COPRA OIL','27','% OIL IN MISCELLA',null,'number','every_two_hours','Every 2 hr.',30,'%','[]'::jsonb,27,true),
('COPRA','COPRA OIL','28','SEDIMENTS',null,'select','every_4_hours','Every 4 hr.',90,null,'["NIL","PRESENT"]'::jsonb,28,false),
('COPRA','COPRA OIL','29','COLOUR',null,'number','every_4_hours','Every 4 hr.',150,null,'[]'::jsonb,29,true),
('COPRA','RECUPERATION HOT & COLD OIL','30','HOT OIL MOISTURE','MAX. 2 %','number','once_per_shift','ONCE FOR SHIFT',90,'%','[]'::jsonb,30,false),
('COPRA','RECUPERATION HOT & COLD OIL','31','COLD OIL MOISTURE','MAX - 1 %','number','once_per_shift','ONCE FOR SHIFT',90,'%','[]'::jsonb,31,false),
('RB','RICE BRAN (FEEDING)','1','% MOISTURE','9.5 - 10 %','number','every_two_hours','EVERY-2 hrs.',90,'%','[]'::jsonb,1,false),
('RB','RICE BRAN (FEEDING)','2','% OIL','OOS','number','every_two_hours','EVERY-2 hrs.',150,'%','[]'::jsonb,2,true),
('RB','RICE BRAN (FEEDING)','3','% FFA','OOS','number','every_two_hours','EVERY-2 hrs.',150,'%','[]'::jsonb,3,true),
('RB','DORB','4','% MOISTURE','10.5% - 11.5 %','number','hourly','Every Hour',90,'%','[]'::jsonb,4,false),
('RB','DORB','5','% OIL','0.004','number','hourly','Every Hour',90,'%','[]'::jsonb,5,true),
('RB','DORB','6','% S&S','BELOW 5 %','number','every_two_hours','EVERY-2 hrs.',330,'%','[]'::jsonb,6,false),
('RB','DORB','7','% FIBER','10.5 % - 13.5 %','number','every_two_hours','EVERY-2 hrs.',330,'%','[]'::jsonb,7,false),
('RB','DORB','8','% PROTEIN','14.5 % - 16 %','number','every_4_hours','Every 4 hr. Hour',330,'%','[]'::jsonb,8,false),
('RB','DORB','9','DT FLAME TEST',null,'select','hourly','Every Hour',5,null,'["NIL","PRESENT"]'::jsonb,9,false),
('RB','RB OIL','10','% FFA','OOS','number','every_4_hours','Every 4 Hr.',30,'%','[]'::jsonb,10,true),
('RB','RB OIL','11','% MOISTURE & IMPURITIES','BELOW - 0.50 %','number','every_4_hours','Every 4 Hr.',90,'%','[]'::jsonb,11,false),
('RB','RB OIL','12','FLASH POINT ( UPTO 120* )',null,'select','every_4_hours','Every 4 Hr.',90,null,'["NIL","PRESENT"]'::jsonb,12,false),
('RB','RB OIL','13','% OIL IN MISCELLA','OOS','number','every_4_hours','Every 4 Hr.',30,'%','[]'::jsonb,13,true),
('RB','RB OIL','14','COLOUR','MAX.- 40 Units','number','every_two_hours','Every 2 Hr.',150,null,'[]'::jsonb,14,false),
('RB','RB OIL','15','% WAX','MAX - 3 %','number','once_per_shift','ONCE IN A SHIFT',150,'%','[]'::jsonb,15,false),
('RB','RB OIL','16','% GUM','MAX - 2.5 %','number','once_per_shift','ONCE IN A SHIFT',45,'%','[]'::jsonb,16,false),
('RB','RECUPERATION HOT & COLD OIL','17','HOT OIL MOISTURE','MAX - 2 %','number','once_per_shift','ONCE FOR SHIFT',90,'%','[]'::jsonb,17,false),
('RB','RECUPERATION HOT & COLD OIL','18','COLD OIL MOISTURE','MAX - 1 %','number','once_per_shift','ONCE FOR SHIFT',90,'%','[]'::jsonb,18,false),
('PK','PALM KERNAL CAKE','1','% MOISTURE','5 - 10 %','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,1,false),
('PK','PALM KERNAL CAKE','2','% OIL','7 - 14 %','number','every_4_hours','Every 4 hr.',150,'%','[]'::jsonb,2,false),
('PK','PALM KERNAL CAKE','3','% FFA','BELOW 5 %','number','every_4_hours','Every 4 hr.',150,'%','[]'::jsonb,3,false),
('PK','PALM KERNAL CAKE','4','SHELL CONTENT','BELOW - 1 %','number','every_4_hours','Every 4 hr.',60,'%','[]'::jsonb,4,false),
('PK','PALM KERNAL CAKE','5','MILLING DEFECTS','BELOW - 1 %','number','every_4_hours','Every 4 hr.',60,'%','[]'::jsonb,5,false),
('PK','PK DT','6','% MOISTURE','BELOW - 5 %','number','hourly','Every Hour',90,'%','[]'::jsonb,6,false),
('PK','PK DT','7','DT FLASH',null,'select','hourly','Every Hour',5,null,'["NIL","PRESENT"]'::jsonb,7,false),
('PK','PK DT','8','% OIL','MAX. - 0.40 %','number','hourly','Every Hour',90,'%','[]'::jsonb,8,false),
('PK','PK DT','9','SHELL CONTENT','BELOW - 1 %','number','hourly','Every Hour',30,'%','[]'::jsonb,9,false),
('PK','PK DT','10','MILLING DEFECTS','BELOW - 1 %','number','hourly','Every Hour',30,'%','[]'::jsonb,10,false),
('PK','PK - CHIPS','11','% MOISTURE','MAX - 10 11 % %','number','hourly','EVERY HOUR',90,'%','[]'::jsonb,11,true),
('PK','PK - CHIPS','12','% S&S','MAX - 2 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,12,false),
('PK','PK - CHIPS','13','% FIBER','MAX.40%','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,13,false),
('PK','PK - CHIPS','14','% PROTEIN','MAX -15 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,14,false),
('PK','NICE- 1','15','% MOISTURE','MAX - 6 %','number','hourly','EVERY HOUR',90,'%','[]'::jsonb,15,false),
('PK','NICE- 1','16','% S&S','MAX - 2 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,16,false),
('PK','NICE- 1','17','% FIBER','MAX. -20%','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,17,false),
('PK','NICE- 1','18','% PROTEIN','MAX -15 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,18,false),
('PK','NICE - 2','19','% MOISTURE','MAX - 6 %','number','hourly','EVERY HOUR',90,'%','[]'::jsonb,19,false),
('PK','NICE - 2','20','% S&S','MAX - 2 %','number','once_per_shift','ONCE IN A SHIFT',180,'%','[]'::jsonb,20,false),
('PK','NICE - 2','21','% FIBER','MAX. -20%','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,21,false),
('PK','NICE - 2','22','% PROTEIN','MAX -15 %','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,22,false),
('PK','PK OIL','23','% FFA','MAX. 6 %','number','every_4_hours','Every 4 hr.',30,'%','[]'::jsonb,23,false),
('PK','PK OIL','24','% MOISTURE & IMPURITIES','MAX.0.50 %','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,24,false),
('PK','PK OIL','25','IV','15 - 24 %','number','every_4_hours','Every 4 hr.',90,null,'[]'::jsonb,25,false),
('PK','PK OIL','26','FLASH POINT ( UPTO 120* )',null,'select','every_4_hours','Every 4 hr.',150,null,'["NIL","PRESENT"]'::jsonb,26,false),
('PK','PK OIL','27','% OIL IN MISCELLA',null,'number','every_two_hours','Every 2 hr.',30,'%','[]'::jsonb,27,true),
('PK','PK OIL','28','SEDIMENTS',null,'select','every_4_hours','Every 4 hr.',60,null,'["NIL","PRESENT"]'::jsonb,28,false),
('PK','RECUPERATION HOT & COLD OIL','29','HOT OIL MOISTURE','MAX - 2 %','number','once_per_shift','ONCE IN A SHIFT SHIFT',90,'%','[]'::jsonb,29,false),
('PK','RECUPERATION HOT & COLD OIL','30','COLD OIL MOISTURE','MAX - 1 %','number','once_per_shift','ONCE IN A SHIFT SHIFT',90,'%','[]'::jsonb,30,false)
)
insert into public.parameter_master(
  section_id,source_ref,source_file,source_serial,source_group,source_text,
  product_code,name,unit,target_text,input_type,frequency,sample_frequency,
  result_latency_minutes,mandatory,alert_enabled,ticket_enabled,options,
  sort_order,active,source_review_required
)
select
  ps.id,'LAB REPORTS -AI(1).xlsx','LAB REPORTS -AI(1).xlsx',
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

