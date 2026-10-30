-- SVMA V7 — Solvent Production & Safety exact-master corrections
-- Source: DocScanner 3 Sept 2026 5-58 am.pdf (11 pages) + confirmed user corrections.
-- Additive/corrective migration. Does not touch Finance or corrected V6 Quality master.

-- 1) Solvent now owns plant/process/safety input only. Lab analysis is handled by Quality.
update public.parameter_sections set active=false
where module='solvent' and upper(name) in ('LAB ANALYSING REPORT','E) LAB ANALYSING REPORT');

update public.parameter_master p set active=false
from public.parameter_sections s
where p.section_id=s.id and s.module='solvent' and upper(s.name) in ('LAB ANALYSING REPORT','E) LAB ANALYSING REPORT');

-- Old expansion accidentally created boiler checklist copies under solvent. Keep the dedicated boiler module only.
update public.parameter_sections set active=false
where module='solvent' and upper(name) in ('VISION BOILER','VESION BOILER','CVL BOILER');
update public.parameter_master p set active=false
from public.parameter_sections s
where p.section_id=s.id and s.module='solvent' and upper(s.name) in ('VISION BOILER','VESION BOILER','CVL BOILER');

-- 2) Exact naming confirmed from the new scanned source/user review.
update public.parameter_master p set
 name='PLANT ENTRY REGISTER ONLY AUTHORISED PERSON',
 source_text='PLANT ENTRY REGISTER ONLY AUTHORISED PERSON',
 target_text='AUTHORISED PERSON',input_type='select',frequency='once_per_shift',
 options='["AUTHORISED PERSON","UNAUTHORISED PERSON"]'::jsonb,active=true
from public.parameter_sections s
where p.section_id=s.id and s.module='solvent' and upper(s.name)='GROUND FLOOR' and p.source_serial='1';

update public.parameter_master p set
 name='PLANT ENTRANCE GATE POSITION',source_text='PLANT ENTRANCE GATE POSITION',
 target_text='CLOSED',input_type='select',frequency='once_per_shift',options='["CLOSED","OPEN"]'::jsonb,active=true
from public.parameter_sections s
where p.section_id=s.id and s.module='solvent' and upper(s.name)='GROUND FLOOR' and p.source_serial='2';

-- Cooling Pond: targets are plain source values 65 and 55; AMS belongs in the parameter name, not appended to target.
update public.parameter_master p set target_text='65',name='COOLING TOWER PUMP -1 LOAD AMS CHECK',unit=null,active=true
from public.parameter_sections s where p.section_id=s.id and s.module='solvent' and upper(s.name) in ('C) COOLING POND','COOLING POND') and upper(p.name) like 'COOLING TOWER PUMP%1%LOAD%AMS%';
update public.parameter_master p set target_text='55',name='COOLING TOWER PUMP -2 LOAD AMS CHECK',unit=null,active=true
from public.parameter_sections s where p.section_id=s.id and s.module='solvent' and upper(s.name) in ('C) COOLING POND','COOLING POND') and upper(p.name) like 'COOLING TOWER PUMP%2%LOAD%AMS%';

-- 3) Second Floor exact hourly rows.
update public.parameter_master p set name='INCOMING CONVEYOR MOTOR LOAD',target_text='8.5 AMS',unit='AMS',input_type='number',frequency='hourly',active=true
from public.parameter_sections s where p.section_id=s.id and s.module='solvent' and upper(s.name) in ('E) SECOND FLOOR','SECOND FLOOR') and upper(p.name) like '%CONVEY%MOTOR LOAD%';

update public.parameter_master p set name='RECUPERATION MANOMETER VACUUM',target_text='-2 mm - +4 mm',unit='mm',input_type='number',frequency='hourly',active=true
from public.parameter_sections s where p.section_id=s.id and s.module='solvent' and upper(s.name) in ('E) SECOND FLOOR','SECOND FLOOR') and upper(p.name) like '%RECUP%MANOMETER%';

update public.parameter_master p set name='VACUUM ITEM 580 MM/KG',target_text='450',unit='MM/KG',input_type='number',frequency='hourly',active=true
from public.parameter_sections s where p.section_id=s.id and s.module='solvent' and upper(s.name) in ('E) SECOND FLOOR','SECOND FLOOR') and upper(p.name) like '%580%';
update public.parameter_master p set name='VACUUM ITEM 518 MM/KG',target_text='350',unit='MM/KG',input_type='number',frequency='hourly',active=true
from public.parameter_sections s where p.section_id=s.id and s.module='solvent' and upper(s.name) in ('E) SECOND FLOOR','SECOND FLOOR') and (upper(p.name) like '%518B%' or upper(p.name) like '%518 MM%');
update public.parameter_master p set name='VACUUM ITEM 5218 MM/KG',target_text='450',unit='MM/KG',input_type='number',frequency='hourly',active=true
from public.parameter_sections s where p.section_id=s.id and s.module='solvent' and upper(s.name) in ('E) SECOND FLOOR','SECOND FLOOR') and (upper(p.name) like '%521B%' or upper(p.name) like '%5218%');
update public.parameter_master p set name='VACUUM ITEM 5278 MM/KG',target_text='650',unit='MM/KG',input_type='number',frequency='hourly',active=true
from public.parameter_sections s where p.section_id=s.id and s.module='solvent' and upper(s.name) in ('E) SECOND FLOOR','SECOND FLOOR') and (upper(p.name) like '%522B%' or upper(p.name) like '%5278%');
update public.parameter_master p set name='VACUUM PUMP LOAD',target_text='20 AMS',unit='AMS',input_type='number',frequency='hourly',active=true
from public.parameter_sections s where p.section_id=s.id and s.module='solvent' and upper(s.name) in ('E) SECOND FLOOR','SECOND FLOOR') and upper(p.name) like '%VAC%PUMP LOAD%';

-- 4) Preparatory — source convention is AMS, not A.
update public.parameter_master p set name=replace(replace(upper(p.name),'PELLETAIZER','PELLETIZER'),'RUNNING A','RUNNING AMS'),target_text='80 AMS',unit='AMS',input_type='number',frequency='hourly',active=true
from public.parameter_sections s where p.section_id=s.id and s.module='solvent' and upper(s.name) in ('F) PREPARATORY','PREPARATORY') and upper(p.name) like '%PELLET%NO%RUNNING%';

-- 5) Exact user-confirmed spelling in navigation/source grouping.
-- Canonical seeded sections already use PALVARIZER and VESION; disable alternate spellings created by old upgrades.
update public.parameter_sections set active=false where module='solvent' and upper(name) in ('PULVERIZER GODOWN','PALVERIZER GODOWN');
update public.parameter_sections set active=true where module='solvent' and upper(name) in ('I) PALVARIZER GODOWN','PALVARIZER GODOWN');
update public.parameter_sections set active=true where module='boiler' and upper(name)='VESION BOILER';

-- 6) V7 non-negotiable: every deterministic Solvent/Boiler deviation creates an action ticket.
update public.parameter_master p set ticket_enabled=true,ticket_severity_threshold='warning',alert_enabled=true
from public.parameter_sections s where p.section_id=s.id and s.module in ('solvent','boiler') and p.active=true;

-- 7) Source trace label for corrected master rows.
update public.parameter_master p set source_ref='DocScanner 3 Sept 2026 5-58 am.pdf'
from public.parameter_sections s where p.section_id=s.id and s.module in ('solvent','boiler') and p.active=true;
