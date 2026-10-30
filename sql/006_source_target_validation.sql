-- Source-grounding safety patch.
-- The supplied Solvent & Boiler document defines targets/expected conditions but in many rows
-- does NOT define separate warning/critical bands. Remove starter inferred bands so production
-- validation uses the source target text until SVMA approves explicit limits in Admin.
update public.parameter_master
set warning_low=null, warning_high=null, critical_low=null, critical_high=null
where source_ref ilike 'PDF%';
