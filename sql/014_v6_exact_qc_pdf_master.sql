-- SVMA V6 -- Exact Quality QC master from the three approved PDF lab reports.
-- Source of truth: RB - LAB REPORTS.pdf, PK LAB REPORTS.pdf, COPRA LAB REPORTS.pdf.
-- The same parameter/target master applies to Shift I/II/III; only the 8 hour columns differ.
-- Frequency remains source/reference metadata. Operational Quality entry exposes all 8 hours for every parameter.
-- Existing historical entries are never deleted.

update public.parameter_master pm
set active=false
from public.parameter_sections ps
where pm.section_id=ps.id and ps.module='quality' and ps.name='PROCESS LAB REPORT';

with src(product_code,source_group,source_serial,name,target_text,input_type,frequency,sample_frequency,result_latency_minutes,unit,options,sort_order,source_file) as (
values
('RB','RICE BRAN (FEEDING)','1','% MOISTURE','8 - 10','number','every_two_hours','EVERY-2 hrs.',90,'%','[]'::jsonb,1,'RB - LAB REPORTS.pdf'),
('RB','RICE BRAN (FEEDING)','2','% OIL','15 - 25','number','every_two_hours','EVERY-2 hrs.',150,'%','[]'::jsonb,2,'RB - LAB REPORTS.pdf'),
('RB','RICE BRAN (FEEDING)','3','% FFA','4 - 30','number','every_two_hours','EVERY-2 hrs.',150,'%','[]'::jsonb,3,'RB - LAB REPORTS.pdf'),
('RB','DORB','4','% MOISTURE','10.5 - 12','number','hourly','Every Hour',90,'%','[]'::jsonb,4,'RB - LAB REPORTS.pdf'),
('RB','DORB','5','% OIL','< 0.40','number','hourly','Every Hour',90,'%','[]'::jsonb,5,'RB - LAB REPORTS.pdf'),
('RB','DORB','6','% S&S','< 5','number','every_two_hours','EVERY-2 hrs.',330,'%','[]'::jsonb,6,'RB - LAB REPORTS.pdf'),
('RB','DORB','7','% FIBER','10 - 14','number','every_two_hours','EVERY-2 hrs.',330,'%','[]'::jsonb,7,'RB - LAB REPORTS.pdf'),
('RB','DORB','8','% PROTEIN','14.5 - 16','number','every_4_hours','Every 4 hrs.',330,'%','[]'::jsonb,8,'RB - LAB REPORTS.pdf'),
('RB','DORB','9','DT FLASH TEST','NIL','select','hourly','Every Hour',2,null,'["NIL","PRESENT"]'::jsonb,9,'RB - LAB REPORTS.pdf'),
('RB','RB OIL','10','% FFA','4 - 30','number','every_4_hours','Every 4 Hr.',30,'%','[]'::jsonb,10,'RB - LAB REPORTS.pdf'),
('RB','RB OIL','11','% MOISTURE & IMPURITIES','< 0.20','number','every_4_hours','Every 4 Hr.',90,'%','[]'::jsonb,11,'RB - LAB REPORTS.pdf'),
('RB','RB OIL','12','FLASH POINT > 120*','NIL','select','every_4_hours','Every 4 Hr.',90,null,'["NIL","PRESENT"]'::jsonb,12,'RB - LAB REPORTS.pdf'),
('RB','RB OIL','13','% OIL IN MISCELLA','16 - 18','number','every_4_hours','Every 4 Hr.',30,'%','[]'::jsonb,13,'RB - LAB REPORTS.pdf'),
('RB','RB OIL','14','COLOUR (IN 1/4" CELL)','> 40 UNITS','number','every_two_hours','Every 2 Hr.',150,'UNITS','[]'::jsonb,14,'RB - LAB REPORTS.pdf'),
('RB','RB OIL','15','% WAX','2.5 - 3.5','number','once_per_shift','ONCE IN A SHIFT',150,'%','[]'::jsonb,15,'RB - LAB REPORTS.pdf'),
('RB','RB OIL','16','% GUM','1 - 1.5','number','once_per_shift','ONCE IN A SHIFT',45,'%','[]'::jsonb,16,'RB - LAB REPORTS.pdf'),
('RB','RECUPERATION HOT OIL','17','HOT OIL MOISTURE','1.5','number','once_per_shift','ONCE IN A SHIFT',90,'%','[]'::jsonb,17,'RB - LAB REPORTS.pdf'),
('RB','RECUPERATION COLD OIL','18','COLD OIL MOISTURE','2.5','number','once_per_shift','ONCE IN A SHIFT',90,'%','[]'::jsonb,18,'RB - LAB REPORTS.pdf'),
('RB','MOISTURE DIFFERENCE','19','LIMIT < 1 %','1','number','once_per_shift','ONCE IN A SHIFT',480,'%','[]'::jsonb,19,'RB - LAB REPORTS.pdf'),
('PK','PALM KERNAL CAKE','1','% MOISTURE','5 - 8','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,1,'PK LAB REPORTS.pdf'),
('PK','PALM KERNAL CAKE','2','% OIL','15','number','every_4_hours','Every 4 hr.',150,'%','[]'::jsonb,2,'PK LAB REPORTS.pdf'),
('PK','PALM KERNAL CAKE','3','% FFA','5 - 25','number','every_4_hours','Every 4 hr.',150,'%','[]'::jsonb,3,'PK LAB REPORTS.pdf'),
('PK','PALM KERNAL CAKE','4','IV','15 - 25','number','every_4_hours','Every 4 hr.',90,null,'[]'::jsonb,4,'PK LAB REPORTS.pdf'),
('PK','PALM KERNAL CAKE','5','SHELL CONTENT','< 1.5','number','every_4_hours','Every 4 hr.',60,'%','[]'::jsonb,5,'PK LAB REPORTS.pdf'),
('PK','PALM KERNAL CAKE','6','MILLING DEFECTS','< 1','number','every_4_hours','Every 4 hr.',60,'%','[]'::jsonb,6,'PK LAB REPORTS.pdf'),
('PK','PK DT','7','% MOISTURE','< 7','number','hourly','Every Hour',90,'%','[]'::jsonb,7,'PK LAB REPORTS.pdf'),
('PK','PK DT','8','DT FLASH','NIL','select','hourly','Every Hour',3,null,'["NIL","PRESENT"]'::jsonb,8,'PK LAB REPORTS.pdf'),
('PK','PK DT','9','% OIL','< 0.35','number','hourly','Every Hour',90,'%','[]'::jsonb,9,'PK LAB REPORTS.pdf'),
('PK','PK DT','10','SHELL CONTENT','< 1.5','number','hourly','Every Hour',30,'%','[]'::jsonb,10,'PK LAB REPORTS.pdf'),
('PK','PK DT','11','MILLING DEFECTS','< 1','number','hourly','Every Hour',30,'%','[]'::jsonb,11,'PK LAB REPORTS.pdf'),
('PK','PK - CHIPS','12','% MOISTURE','10 - 11','number','hourly','Every Hour',90,'%','[]'::jsonb,12,'PK LAB REPORTS.pdf'),
('PK','PK - CHIPS','13','% S&S','< 2','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,13,'PK LAB REPORTS.pdf'),
('PK','PK - CHIPS','14','% FIBER','30','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,14,'PK LAB REPORTS.pdf'),
('PK','PK - CHIPS','15','% PROTEIN','10 - 12','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,15,'PK LAB REPORTS.pdf'),
('PK','NICE- 1','16','% MOISTURE','6','number','hourly','EVERY HOUR',90,'%','[]'::jsonb,16,'PK LAB REPORTS.pdf'),
('PK','NICE- 1','17','% S&S','2','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,17,'PK LAB REPORTS.pdf'),
('PK','NICE- 1','18','% FIBER','< 20','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,18,'PK LAB REPORTS.pdf'),
('PK','NICE- 1','19','% PROTEIN','10 - 12','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,19,'PK LAB REPORTS.pdf'),
('PK','NICE - 2','20','% MOISTURE','6','number','hourly','EVERY HOUR',90,'%','[]'::jsonb,20,'PK LAB REPORTS.pdf'),
('PK','NICE - 2','21','% S&S','2','number','once_per_shift','ONCE IN A SHIFT',180,'%','[]'::jsonb,21,'PK LAB REPORTS.pdf'),
('PK','NICE - 2','22','% FIBER','< 20','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,22,'PK LAB REPORTS.pdf'),
('PK','NICE - 2','23','% PROTEIN','10 - 12','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,23,'PK LAB REPORTS.pdf'),
('PK','PK OIL','24','% FFA','5 - 25','number','every_4_hours','Every 4 hr.',30,'%','[]'::jsonb,24,'PK LAB REPORTS.pdf'),
('PK','PK OIL','25','% MOISTURE','0.20','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,25,'PK LAB REPORTS.pdf'),
('PK','PK OIL','26','IV (IODINE VALUE)','15 - 24','number','every_4_hours','Every 4 hr.',90,null,'[]'::jsonb,26,'PK LAB REPORTS.pdf'),
('PK','PK OIL','27','FLASH POINT < 120*','NIL','select','every_4_hours','Every 4 hr.',150,null,'["NIL","PRESENT"]'::jsonb,27,'PK LAB REPORTS.pdf'),
('PK','PK OIL','28','% OIL IN MISCELLA','12 - 15','number','every_two_hours','Every 2 hr.',30,'%','[]'::jsonb,28,'PK LAB REPORTS.pdf'),
('PK','PK OIL','29','SEDIMENTS %','0.50','number','once_per_shift','ONCE IN A SHIFT',60,'%','[]'::jsonb,29,'PK LAB REPORTS.pdf'),
('PK','RECUPERATION HOT OIL','30','HOT OIL MOISTURE','1.5','number','once_per_shift','ONCE IN A SHIFT',90,'%','[]'::jsonb,30,'PK LAB REPORTS.pdf'),
('PK','RECUPERATION OIL COLD','31','COLD OIL MOISTURE','2.5','number','once_per_shift','ONCE IN A SHIFT',90,'%','[]'::jsonb,31,'PK LAB REPORTS.pdf'),
('PK','MOISTURE DIFFERENCE','32','LIMIT < 1 %','1.0','number','once_per_shift','ONCE IN A SHIFT',480,'%','[]'::jsonb,32,'PK LAB REPORTS.pdf'),
('COPRA','EDIBLE COPRA CAKE','1','% MOISTURE','< 7','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,1,'COPRA LAB REPORTS.pdf'),
('COPRA','NON-EDIBLE COPRA CAKE','2','% OIL','7 - 15','number','every_4_hours','Every 4 hr.',150,'%','[]'::jsonb,2,'COPRA LAB REPORTS.pdf'),
('COPRA','NON-EDIBLE COPRA CAKE','3','% FFA','3 - 15','number','every_4_hours','Every 4 hr.',150,'%','[]'::jsonb,3,'COPRA LAB REPORTS.pdf'),
('COPRA','NON-EDIBLE COPRA CAKE','4','SHELL CONTENT','< 1','number','every_4_hours','Every 4 hr.',60,'%','[]'::jsonb,4,'COPRA LAB REPORTS.pdf'),
('COPRA','NON-EDIBLE COPRA CAKE','5','MILLING DEFECTS','< 1','number','every_4_hours','Every 4 hr.',60,'%','[]'::jsonb,5,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA DT','6','% MOISTURE','< 10','number','hourly','Every Hour',90,'%','[]'::jsonb,6,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA DT','7','% OIL','< 0.40','number','hourly','Every Hour',90,'%','[]'::jsonb,7,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA DT','8','SHELL CONTENT','< 1','number','hourly','Every Hour',30,'%','[]'::jsonb,8,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA DT','9','MILLING DEFECTS','< 1','number','hourly','Every Hour',30,'%','[]'::jsonb,9,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA DT','10','DT FLASH','NIL','select','hourly','Every Hour',2,null,'["NIL","PRESENT"]'::jsonb,10,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA DOC - CHIPS','11','% MOISTURE','< 10','number','hourly','Every Hour',90,'%','[]'::jsonb,11,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA DOC - CHIPS','12','% S&S','< 2','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,12,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA DOC - CHIPS','13','% FIBER','< 12','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,13,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA DOC - CHIPS','14','% PROTEIN','> 23','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,14,'COPRA LAB REPORTS.pdf'),
('COPRA','NICE - 1','15','% MOISTURE','< 7','number','hourly','Every Hour',90,'%','[]'::jsonb,15,'COPRA LAB REPORTS.pdf'),
('COPRA','NICE - 1','16','% S&S','< 2','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,16,'COPRA LAB REPORTS.pdf'),
('COPRA','NICE - 1','17','% FIBER','< 10','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,17,'COPRA LAB REPORTS.pdf'),
('COPRA','NICE - 1','18','% PROTEIN','> 20','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,18,'COPRA LAB REPORTS.pdf'),
('COPRA','NICE - 2','19','% MOISTURE','< 7','number','hourly','Every Hour',90,'%','[]'::jsonb,19,'COPRA LAB REPORTS.pdf'),
('COPRA','NICE - 2','20','% S&S','< 2','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,20,'COPRA LAB REPORTS.pdf'),
('COPRA','NICE - 2','21','% FIBER','< 10','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,21,'COPRA LAB REPORTS.pdf'),
('COPRA','NICE - 2','22','% PROTEIN','> 20','number','once_per_shift','ONCE IN A SHIFT',330,'%','[]'::jsonb,22,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA OIL','23','% FFA','3 - 15','number','every_4_hours','Every 4 hr.',30,'%','[]'::jsonb,23,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA OIL','24','% MOISTURE','< 0.25','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,24,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA OIL','25','IV','8 - 15','number','every_4_hours','Every 4 hr.',90,null,'[]'::jsonb,25,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA OIL','26','FLASH POINT > 120*','NIL','select','every_4_hours','Every 4 hr.',150,null,'["NIL","PRESENT"]'::jsonb,26,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA OIL','27','% OIL IN MISCELLA','< 15','number','every_two_hours','Every 2 hr.',30,'%','[]'::jsonb,27,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA OIL','28','SEDIMENTS','< 0.50','number','every_4_hours','Every 4 hr.',90,'%','[]'::jsonb,28,'COPRA LAB REPORTS.pdf'),
('COPRA','COPRA OIL','29','COLOUR (IN 1/2" CELL)','< 70 UNITS','number','every_4_hours','Every 4 hr.',150,'UNITS','[]'::jsonb,29,'COPRA LAB REPORTS.pdf'),
('COPRA','RECUPERATION HOT OIL','30','HOT OIL MOISTURE','1.5','number','once_per_shift','ONCE IN A SHIFT',90,'%','[]'::jsonb,30,'COPRA LAB REPORTS.pdf'),
('COPRA','RECUPERATION COLD OIL','31','COLD OIL MOISTURE','2.5','number','once_per_shift','ONCE IN A SHIFT',90,'%','[]'::jsonb,31,'COPRA LAB REPORTS.pdf'),
('COPRA','MOISTURE DIFFERENCE','32','LIMIT < 1 %','1','number','once_per_shift','ONCE IN A SHIFT',480,'%','[]'::jsonb,32,'COPRA LAB REPORTS.pdf')
)
insert into public.parameter_master(
 section_id,source_ref,source_file,source_serial,source_group,source_text,
 product_code,name,unit,target_text,input_type,frequency,sample_frequency,
 result_latency_minutes,mandatory,alert_enabled,ticket_enabled,options,
 sort_order,active,source_review_required
)
select
 ps.id,src.source_file,src.source_file,src.source_serial,src.source_group,
 src.product_code||' / '||src.source_group||' / '||src.name||' / TARGET '||src.target_text,
 src.product_code,src.name,src.unit,src.target_text,src.input_type,src.frequency,
 src.sample_frequency,src.result_latency_minutes,true,true,true,src.options,
 src.sort_order,true,false
from src
join public.parameter_sections ps on ps.module='quality' and ps.name='PROCESS LAB REPORT'
on conflict(section_id,product_code,source_group,name)
do update set
 source_ref=excluded.source_ref,source_file=excluded.source_file,
 source_serial=excluded.source_serial,source_text=excluded.source_text,
 unit=excluded.unit,target_text=excluded.target_text,input_type=excluded.input_type,
 frequency=excluded.frequency,sample_frequency=excluded.sample_frequency,
 result_latency_minutes=excluded.result_latency_minutes,options=excluded.options,
 sort_order=excluded.sort_order,mandatory=true,alert_enabled=true,ticket_enabled=true,
 active=true,source_review_required=false;

-- Any older Quality rows not present in these approved PDF masters remain inactive for audit/history.
-- There must be exactly 83 active Quality parameter rows after this migration.
do $$
declare c int;
begin
 select count(*) into c from public.parameter_master pm join public.parameter_sections ps on ps.id=pm.section_id where ps.module='quality' and ps.name='PROCESS LAB REPORT' and pm.active=true;
 if c <> 83 then raise exception 'V6 Quality master integrity failed: expected 83 active rows, found %',c; end if;
end $$;
