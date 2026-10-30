-- SVMA V2 proper workflow upgrade. Safe to run after the earlier V1 SQL.
alter table public.reconciliation_runs add column if not exists reconciliation_type text not null default 'transaction';
alter table public.parameter_entries add column if not exists timeliness_status text;
alter table public.parameter_entries add column if not exists validation_status text;
alter table public.parameter_master add column if not exists source_review_required boolean not null default false;
alter table public.parameter_master add column if not exists source_text text;
create unique index if not exists uq_deviation_entry on public.deviations(entry_id) where entry_id is not null;
create index if not exists idx_parameter_frequency on public.parameter_master(frequency,active);
create index if not exists idx_shift_operator_status on public.shift_sessions(operator_id,status);
create index if not exists idx_recon_type_date on public.reconciliation_runs(reconciliation_type,reconciliation_date desc);

create or replace function public.increment_shift_focus_violation(p_shift_session_id uuid)
returns void language sql security definer set search_path=public as $$
  update public.shift_sessions set focus_violations=coalesce(focus_violations,0)+1 where id=p_shift_session_id;
$$;

grant execute on function public.increment_shift_focus_violation(uuid) to authenticated, service_role;

-- Allow authenticated users to read their own role for server-side route authorization.
drop policy if exists roles_self_read on public.user_roles;
create policy roles_self_read on public.user_roles for select to authenticated using(user_id=auth.uid());
-- Expanded Solvent/Boiler digital checklist from the supplied SOLVENT & BOILER source.
-- V1 numeric core parameters are retained; this file adds the shift-level visual/safety controls
-- that must NOT be mixed into the hourly numeric entry screen.

insert into public.parameter_sections(module,name,sort_order) values
('solvent','Ground Floor',5),('solvent','Hexane Tank',10),('solvent','Desolventizer Toaster (DT)',20),('solvent','Cooling Pond',30),('solvent','Extractor',40),('solvent','Lab Analysing Report',50),('solvent','Second Floor',60),('solvent','Preparatory',70),('solvent','Raw Material Godown',80),('solvent','Packing Godown',90),('solvent','Palvarizer Godown',100),('solvent','Factory General Safety',110),('solvent','Vision Boiler',120),('solvent','CVL Boiler',125)
on conflict(module,name) do update set sort_order=excluded.sort_order;

with v(section,source_ref,name,target_text,input_type,frequency,options,sort_order) as (values
('Ground Floor','PDF p1','Plant entry restricted only authorised person','AUTHORISED PERSON','select','once_per_shift','["AUTHORISED PERSON","UNAUTHORISED PERSON"]'::jsonb,1),
('Ground Floor','PDF p1','Plant entrance gate position','CLOSED','select','once_per_shift','["CLOSED","OPEN"]'::jsonb,2),
('Hexane Tank','PDF p1','Tank 1 dip nipple pipe cap open / close','CLOSED','select','once_per_shift','["CLOSED","OPEN"]'::jsonb,1),
('Hexane Tank','PDF p1','Tank 2 dip nipple pipe cap open / close','CLOSED','select','once_per_shift','["CLOSED","OPEN"]'::jsonb,2),
('Hexane Tank','PDF p1','Tank 3 dip nipple pipe cap open / close','CLOSED','select','once_per_shift','["CLOSED","OPEN"]'::jsonb,3),
('Hexane Tank','PDF p1','Ground level water lifting pump running','ONLY RAINING TIME NECESSARY','check','conditional','["NORMAL","ABNORMAL","NOT APPLICABLE"]'::jsonb,4),
('Hexane Tank','PDF p1','Summer sprinkler operation','ONLY SUMMER TIME NECESSARY','check','conditional','["NORMAL","ABNORMAL","NOT APPLICABLE"]'::jsonb,5),
('Hexane Tank','PDF p1','Hexane dip nipple operation uses wood hammer / manpower only','DO NOT RAISE FIRE SPARK','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,6),
('Hexane Tank','PDF p1','Solvent plant empty place housekeeping','HOUSE KEEPING DAILY MAINTAIN','check','once_per_shift','["CLEAN","NOT CLEAN"]'::jsonb,7),
('Hexane Tank','PDF p1','Pump and motor tray oil spillage','EVERYDAY CLEAN','check','once_per_shift','["CLEAN","NOT CLEAN"]'::jsonb,8),

('Desolventizer Toaster (DT)','PDF p1','DT outgoing conveyor hexane detector check','VAPOUR NIL','check','once_per_shift','["VAPOUR NIL","VAPOUR PRESENT"]'::jsonb,101),
('Desolventizer Toaster (DT)','PDF p1','DT outgoing conveyor running condition','SMOOTH RUNNING','check','once_per_shift','["SMOOTH RUNNING","ABNORMAL"]'::jsonb,102),
('Desolventizer Toaster (DT)','PDF p1','DT gear box and V belt grease / oil level check','GREASE APPLIED / OIL LEVEL CHECK','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,103),
('Desolventizer Toaster (DT)','PDF p2','DT fluid coupling oil level check','90 DEG POSITION LEVEL CHECK','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,104),
('Desolventizer Toaster (DT)','PDF p2','Plugoseal conveyor bearing check','SMOOTH RUNNING','check','once_per_shift','["SMOOTH RUNNING","ABNORMAL"]'::jsonb,105),
('Desolventizer Toaster (DT)','PDF p2','DT discharge float and bearing condition','VISIBLE','check','once_per_shift','["VISIBLE","ABNORMAL"]'::jsonb,106),
('Desolventizer Toaster (DT)','PDF p2','DT sample flash high/light','HEXANE NIL','check','once_per_shift','["HEXANE NIL","HEXANE PRESENT"]'::jsonb,107),
('Desolventizer Toaster (DT)','PDF p2','DT bottom gland rope check','VAPOUR LEAK NIL','check','once_per_shift','["VAPOUR NIL","VAPOUR LEAK"]'::jsonb,108),
('Desolventizer Toaster (DT)','PDF p2','Fire bucket sand and water check','DAILY MAINTAIN / HIGH LEVEL','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,109),
('Desolventizer Toaster (DT)','PDF p2','DT drive interlock check','MONITORING','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,110),
('Desolventizer Toaster (DT)','PDF p2','Outgoing conveyor safety interlock condition','MONITORING','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,111),
('Desolventizer Toaster (DT)','PDF p2','DT outlet steam trap / strainer bypass valve check','MONITORING','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,112),
('Desolventizer Toaster (DT)','PDF p2','DT condenser recovery pump pressure and function check','MONITORING','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,113),
('Desolventizer Toaster (DT)','PDF p2','DT steam automation system parameter check','MONITORING','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,114),
('Desolventizer Toaster (DT)','PDF p2','205 conveyor output material hexane test','HEXANE 20%-25% / MONITORING','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,115),
('Desolventizer Toaster (DT)','PDF p2','Plant stoppage discharge hopper sealing','BRAN FOR SEALING','check','conditional','["NORMAL","ABNORMAL","NOT APPLICABLE"]'::jsonb,116),

('Cooling Pond','PDF p3','Cooling tower fan 1 load check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,101),
('Cooling Pond','PDF p3','Cooling tower fan 2 load check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,102),
('Cooling Pond','PDF p3','Cooling tower fan 3 load check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,103),
('Cooling Pond','PDF p3','Cooling tower fan running condition','WIND SHOCKS ROTATION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,104),
('Cooling Pond','PDF p3','Cooling tower pump 1 gland rope leakage check','NO LEAK','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,105),
('Cooling Pond','PDF p3','Cooling tower pump 2 gland rope leakage check','NO LEAK','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,106),
('Cooling Pond','PDF p3','Spray pump seal / valves / flanges / steam leakage','NO LEAK','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,107),
('Cooling Pond','PDF p4','Earth pit and all motor check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,108),
('Cooling Pond','PDF p4','Plant condensate steam line leakage check','NIL','check','once_per_shift','["NIL","LEAK"]'::jsonb,109),
('Cooling Pond','PDF p4','Extractor spray pump oil seal check','HEXANE NO LEAKS','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,110),
('Cooling Pond','PDF p4','Miscella recovery pump seal check','HEXANE NO LEAK','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,111),
('Cooling Pond','PDF p4','Miscella distillation pump seal check','HEXANE NO LEAK','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,112),
('Cooling Pond','PDF p4','Condenser recovery pump leakage check','HEXANE NO LEAK','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,113),
('Cooling Pond','PDF p4','Safety boiler pump leakage check','HEXANE NO LEAK','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,114),
('Cooling Pond','PDF p4','Recuperation hot pump leakage check','HEXANE NO LEAK','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,115),
('Cooling Pond','PDF p4','Recuperation cold pump leakage check','HEXANE NO LEAK','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,116),
('Cooling Pond','PDF p4','Fire hydrant outside point check','OPEN / CLOSE','select','once_per_shift','["OPEN","CLOSED","ABNORMAL"]'::jsonb,117),

('Extractor','PDF p5','Housekeeping and grass growth condition','CLEAN','check','once_per_shift','["CLEAN","NOT CLEAN"]'::jsonb,101),
('Extractor','PDF p5','Plant ground floor lighting check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,102),
('Extractor','PDF p5','Water separator output flow to safety boiler','MEDIUM FLOW','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,103),
('Extractor','PDF p5','All drain valves leak and check','OPEN / CLOSE','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,104),
('Extractor','PDF p5','Fire extinguisher foam 50kg cylinder condition','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,105),
('Extractor','PDF p5','Fire extinguisher A/B type available','AVAILABLE','check','once_per_shift','["AVAILABLE","NOT AVAILABLE"]'::jsonb,106),
('Extractor','PDF p5','Plant breakdown operator working condition','PRESENCE OF MIND','check','conditional','["NORMAL","ABNORMAL","NOT APPLICABLE"]'::jsonb,107),
('Extractor','PDF p5','Tank 34 water drain first shift','WATER DRAIN','check','first_shift_only','["DONE","NOT DONE"]'::jsonb,108),
('Extractor','PDF p5','Extractor 13 & 14 hopper water drain first shift','WATER DRAIN','check','first_shift_only','["DONE","NOT DONE"]'::jsonb,109),
('Extractor','PDF p5','Extractor drum shaft housing leak check','VAPOUR LEAK','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,110),
('Extractor','PDF p5','Extractor drive side gland rope check','VAPOUR NIL','check','once_per_shift','["VAPOUR NIL","VAPOUR PRESENT"]'::jsonb,111),
('Extractor','PDF p5','Lightning arrest earth check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,112),
('Extractor','PDF p6','All condenser hexane recovery view glass check','MONITORING','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,113),
('Extractor','PDF p6','Extractor manhole door leakage check','VAPOUR NIL','check','once_per_shift','["VAPOUR NIL","VAPOUR PRESENT"]'::jsonb,114),
('Extractor','PDF p6','Plant operation properly run','MONITORING','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,115),
('Extractor','PDF p6','Production oil transfer to storage tank','OPEN / CLOSE','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,116),
('Extractor','PDF p6','Rice bran / copra / palm kernel oil separate tank check','MONITORING','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,117),
('Extractor','PDF p6','Extractor spray ball valves check','OPEN / CLOSE','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,118),
('Extractor','PDF p7','General emergency safety condition check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,119),
('Extractor','PDF p7','Panel board CO2 fire extinguisher available','AVAILABLE','check','once_per_shift','["AVAILABLE","NOT AVAILABLE"]'::jsonb,120),

('Second Floor','PDF p12','Fire extinguisher available on floor','AVAILABLE','check','once_per_shift','["AVAILABLE","NOT AVAILABLE"]'::jsonb,1),
('Second Floor','PDF p12','Incoming conveyor rotary valve and drive chain check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,2),
('Second Floor','PDF p12','Oil storage tank overflow level check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,3),
('Second Floor','PDF p12','Flasher view sight glass gasket leakage check','VAPOUR NIL','check','once_per_shift','["VAPOUR NIL","VAPOUR PRESENT"]'::jsonb,4),
('Second Floor','PDF p13','Final stripper view glass gasket leak check','VAPOUR NIL','check','once_per_shift','["VAPOUR NIL","VAPOUR PRESENT"]'::jsonb,5),
('Second Floor','PDF p13','Final vent outlet vapour smell check','< SMELL','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,6),
('Second Floor','PDF p13','Incoming conveyor safety interlock check','MONITORING','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,7),
('Second Floor','PDF p13','No 205 solvent conveyor safety interlock','MONITORING','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,8),

('Preparatory','PDF p13','Clean feeding point magnet','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,1),
('Preparatory','PDF p14','Conditioner screw leaves and bearings check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,2),
('Preparatory','PDF p14','Pellet machine check nut tight regularly','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,3),
('Preparatory','PDF p14','Distributor conveyor chain condition','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,4),
('Preparatory','PDF p14','All gearbox oil levels and oil seals','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,5),
('Preparatory','PDF p14','Pellet cooler fan / belt / perforated sheet cleaning','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,6),
('Preparatory','PDF p14','BRB siever drum cleaning','CLEAN','check','once_per_shift','["CLEAN","NOT CLEAN"]'::jsonb,7),
('Preparatory','PDF p14','Elevator bucket / belt / bearings check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,8),
('Preparatory','PDF p14','Pellet machine oil level every day','CONDITION','check','daily','["NORMAL","ABNORMAL"]'::jsonb,9),
('Preparatory','PDF p15','Steam leakage check','NO LEAK','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,10),
('Preparatory','PDF p15','MCB room housekeeping','CLEAN','check','once_per_shift','["CLEAN","NOT CLEAN"]'::jsonb,11),
('Preparatory','PDF p15','Preparatory all-area housekeeping','CLEAN','check','once_per_shift','["CLEAN","NOT CLEAN"]'::jsonb,12),
('Preparatory','PDF p15','Fire extinguisher at pelletizer and cooler areas','AVAILABLE','check','once_per_shift','["AVAILABLE","NOT AVAILABLE"]'::jsonb,13),

('Raw Material Godown','PDF p16','Raw material receiving grade confirmation sample','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,101),
('Raw Material Godown','PDF p16','Grade confirmation and unload separately','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,102),
('Raw Material Godown','PDF p16','Sampling collect variants and final sample','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,103),
('Raw Material Godown','PDF p16','Stock location map prepared daily','MAINTAIN','check','daily','["DONE","NOT DONE"]'::jsonb,104),
('Raw Material Godown','PDF p16','Commercial feeding ratio lotwise with lab report','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,105),
('Raw Material Godown','PDF p16','Shift wise feeding log sheet record','MAINTAIN','check','once_per_shift','["DONE","NOT DONE"]'::jsonb,106),
('Raw Material Godown','PDF p16','Housekeeping all areas shift wise','CLEAN','check','once_per_shift','["CLEAN","NOT CLEAN"]'::jsonb,107),
('Raw Material Godown','PDF p16','Godown fire extinguisher and hydrant point check','AVAILABLE','check','once_per_shift','["AVAILABLE","NOT AVAILABLE"]'::jsonb,108),
('Raw Material Godown','PDF p17','Feeding tractor spark arrest compulsory','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,109),

('Packing Godown','PDF p17','DORB / Copra DOC / Palm kernel hourly bag record maintained','MAINTAIN','check','once_per_shift','["DONE","NOT DONE"]'::jsonb,101),
('Packing Godown','PDF p17','Production all bags hourly sample sent to lab','MAINTAIN','check','once_per_shift','["DONE","NOT DONE"]'::jsonb,102),
('Packing Godown','PDF p17','Production DOC/DOB cooler below 45C and lotting/loading','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,103),
('Packing Godown','PDF p17','Production storage lot card maintained','MAINTAIN','check','once_per_shift','["DONE","NOT DONE"]'::jsonb,104),
('Packing Godown','PDF p18','Production area housekeeping','CLEAN','check','once_per_shift','["CLEAN","NOT CLEAN"]'::jsonb,105),
('Packing Godown','PDF p18','Hexane smell and smoking check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,106),
('Packing Godown','PDF p18','DOC conveyor running check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,107),
('Packing Godown','PDF p18','Rotary siever running check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,108),
('Packing Godown','PDF p18','Outside fire hydrant point check','OPEN / CLOSE','select','once_per_shift','["OPEN","CLOSED","ABNORMAL"]'::jsonb,109),

('Palvarizer Godown','PDF p18','Shift wise grinding production bags recorded','NO OF BAGS / HR','check','once_per_shift','["DONE","NOT DONE"]'::jsonb,1),
('Palvarizer Godown','PDF p18','Production material area and protection check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,2),
('Palvarizer Godown','PDF p18','Rotor / hammer / knife screen / chamber condition','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,3),
('Palvarizer Godown','PDF p19','Machine foundation bolts and guards','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,4),
('Palvarizer Godown','PDF p19','Bearing lubrication and grease/oil level','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,5),
('Palvarizer Godown','PDF p19','Motor coupling / belt / pulley alignment','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,6),
('Palvarizer Godown','PDF p19','Electrical panel / MCB / overload / emergency stop','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,7),
('Palvarizer Godown','PDF p19','Safety guards properly fitted','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,8),
('Palvarizer Godown','PDF p19','Fire extinguisher available nearby','AVAILABLE','check','once_per_shift','["AVAILABLE","NOT AVAILABLE"]'::jsonb,9),
('Palvarizer Godown','PDF p19','Palvarizer machine interlock check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,10),

('Factory General Safety','PDF p19','Personal protective items check','AVAILABLE','check','once_per_shift','["AVAILABLE","NOT AVAILABLE"]'::jsonb,101),
('Factory General Safety','PDF p19','Chemical receiving procedures','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,102),
('Factory General Safety','PDF p19','Chemical segregation','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,103),
('Factory General Safety','PDF p19','Chemical handling','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,104),
('Factory General Safety','PDF p19','Spill and leakage procedures','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,105),
('Factory General Safety','PDF p19','Fire safety equipment stock weekly check','MAINTAIN','check','weekly','["NORMAL","ABNORMAL"]'::jsonb,106),
('Factory General Safety','PDF p20','Do / Don''t everyday check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,107),
('Factory General Safety','PDF p20','SEP plant safety check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,108),
('Factory General Safety','PDF p20','LOTO - Lockout Tagout check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,109),
('Factory General Safety','PDF p20','Hot work safety check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,110),
('Factory General Safety','PDF p20','Boiler utility safety check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,111),
('Factory General Safety','PDF p20','Chemical safety check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,112),
('Factory General Safety','PDF p20','Working at height check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,113),
('Factory General Safety','PDF p20','Confined space check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,114),
('Factory General Safety','PDF p20','Electrical safety check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,115),
('Factory General Safety','PDF p20','Material handling check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,116),
('Factory General Safety','PDF p20','Emergency response checklist','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,117),
('Factory General Safety','PDF p20','Fire hydrant pressure auto/manual check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,118),
('Factory General Safety','PDF p20','All hydrant point valves open/close everyday','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,119),
('Factory General Safety','PDF p20','Fire hydrant jockey pump start/cutoff','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,120),
('Factory General Safety','PDF p21','Spent earth area smoking / fire flame check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,121),
('Factory General Safety','PDF p21','Lab safety check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,122),
('Factory General Safety','PDF p21','ETP RO safety check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,123),
('Factory General Safety','PDF p21','Water drainage clear/block check','MAINTAIN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,124),
('Factory General Safety','PDF p21','Workshop safety and housekeeping','MAINTAIN / CLEAN','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,125),

('Vision Boiler','PDF p22','Raw water storage level check','HIGH','select','once_per_shift','["HIGH","MEDIUM","LOW"]'::jsonb,101),
('Vision Boiler','PDF p22','Water level low/high cut off check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,102),
('Vision Boiler','PDF p22','Alarm system high level check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,103),
('Vision Boiler','PDF p22','Water level glass leak check','CONDITION','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,104),
('Vision Boiler','PDF p22','Feed water tank level check','HIGH','select','once_per_shift','["HIGH","MEDIUM","LOW"]'::jsonb,105),
('Vision Boiler','PDF p22','Gauge glass water level manual check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,106),
('Vision Boiler','PDF p22','Pressure switch ID fan cut off','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,107),
('Vision Boiler','PDF p22','Pressure switch FD fan cut off','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,108),
('Vision Boiler','PDF p22','Mobrey switch safety control check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,109),
('Vision Boiler','PDF p22','ID fan belt loose check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,110),
('Vision Boiler','PDF p22','ID fan and FD fan noise check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,111),
('Vision Boiler','PDF p22','Fire wood unloading space at boiler front','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,112),
('Vision Boiler','PDF p22','Main / air vent / blowdown valve leakage','CONDITION','check','once_per_shift','["NO LEAK","LEAK"]'::jsonb,113),
('Vision Boiler','PDF p22','Blow down TDS check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,114),
('Vision Boiler','PDF p22','Panel board cleaning check','CLEAN','check','once_per_shift','["CLEAN","NOT CLEAN"]'::jsonb,115),

('CVL Boiler','PDF p23','Starting safety air vent valve / feed pump / interlock','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,101),
('CVL Boiler','PDF p23','Furnace / back fire check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,102),
('CVL Boiler','PDF p23','General housekeeping for boiler','CLEAN','check','once_per_shift','["CLEAN","NOT CLEAN"]'::jsonb,103),
('CVL Boiler','PDF p23','Boiler maintenance PPE','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,104),
('CVL Boiler','PDF p23','Chimney smoke direction','DIRECTION','select','once_per_shift','["EAST","WEST","NORTH","SOUTH"]'::jsonb,105),
('CVL Boiler','PDF p23','Chimney flue gas path blockage','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,106),
('CVL Boiler','PDF p23','Fire wood grade check','CONDITION','check','once_per_shift','["NORMAL","ABNORMAL"]'::jsonb,107)
), s as (select id,name from public.parameter_sections where module='solvent')
insert into public.parameter_master(section_id,source_ref,source_text,name,target_text,input_type,frequency,mandatory,alert_enabled,ticket_enabled,options,sort_order)
select s.id,v.source_ref,v.name,v.name,v.target_text,v.input_type,v.frequency,true,true,true,v.options,v.sort_order
from v join s on s.name=v.section
where not exists(select 1 from public.parameter_master p where p.section_id=s.id and upper(p.name)=upper(v.name));

-- Explicitly keep future Refinery content out of active Solvent data entry.
update public.parameter_master p set active=false
from public.parameter_sections s
where p.section_id=s.id and s.module='solvent' and s.name ilike '%refinery%';
-- Source-grounding safety patch.
-- The supplied Solvent & Boiler document defines targets/expected conditions but in many rows
-- does NOT define separate warning/critical bands. Remove starter inferred bands so production
-- validation uses the source target text until SVMA approves explicit limits in Admin.
update public.parameter_master
set warning_low=null, warning_high=null, critical_low=null, critical_high=null
where source_ref ilike 'PDF%';
