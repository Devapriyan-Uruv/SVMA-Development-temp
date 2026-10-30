import fs from 'node:fs';
const checks=[];
const ok=(name,cond)=>{checks.push([name,!!cond]);if(!cond)process.exitCode=1};
const read=p=>fs.readFileSync(p,'utf8');
const sql=read('sql/015_v7_solvent_exact_master_ai_ticket_report.sql');
const entries=read('app/api/entries/route.ts');
const exp=read('app/api/export/shift/route.ts');
const parser=read('lib/targetParser.ts');
ok('Lab Analysing Report removed from Solvent',sql.includes("LAB ANALYSING REPORT")&&sql.includes('active=false'));
ok('Ground-floor authorised entry control present',sql.includes('PLANT ENTRY REGISTER ONLY AUTHORISED PERSON'));
ok('Ground-floor gate position present',sql.includes('PLANT ENTRANCE GATE POSITION'));
ok('Cooling pump targets are 65 / 55',sql.includes("target_text='65'")&&sql.includes("target_text='55'"));
ok('Second-floor 8.5 AMS corrected',sql.includes("target_text='8.5 AMS'"));
ok('Recuperation range keeps +4 sign',sql.includes("target_text='-2 mm - +4 mm'"));
ok('Four vacuum rows present', ['580 MM/KG','518 MM/KG','5218 MM/KG','5278 MM/KG'].every(x=>sql.includes(x)));
ok('Vacuum pump is 20 AMS',sql.includes("target_text='20 AMS'"));
ok('Pelletizer uses 80 AMS',sql.includes("target_text='80 AMS'"));
ok('Palvarizer spelling preserved',sql.includes('PALVARIZER GODOWN'));
ok('Vesion Boiler spelling preserved',sql.includes('VESION BOILER'));
ok('Strict greater/less parser implemented',parser.includes('lowInclusive:false')&&parser.includes('highInclusive:false'));
// V8.6.1 (sql/018): deviation/ticket/notification creation moved from the
// route handler into a database trigger (svma_saved_reading_alert ->
// svma_process_deviation_entry) so a follow-up failure can never roll back
// the reading itself — see sql/018_v8_6_1_reliability_and_repair.sql. The
// route now only reads back what the trigger created. These two checks
// verify the same guarantees against the new location instead of the old.
const reliabilitySql=read('sql/018_v8_6_1_reliability_and_repair.sql');
ok('Every Solvent deviation creates a ticket',reliabilitySql.includes('ticket_worthy:=coalesce(p.ticket_enabled,true)')&&reliabilitySql.includes("coalesce(p.ticket_severity_threshold,'warning')='warning'"));
ok('Deviation notification remains deterministic',entries.includes('numericDeviatesFromTarget')&&entries.includes('categoricalDeviatesFromTarget')&&reliabilitySql.includes('ent.validation_status'));
ok('Downloaded report has Ticket ID',exp.includes("'Ticket ID'"));
ok('Downloaded report has AI Comments',exp.includes("'AI Comments'"));
ok('Downloaded report has probable-cause hypothesis column',exp.includes('Why this might have arisen (AI hypothesis — not confirmed root cause)'));
ok('AI prompt cannot change deterministic status',exp.includes('MUST NOT change status, target, actual values, ticket state'));
ok('No AI key still exports deterministic report',exp.includes('AI hypothesis unavailable'));
for(const [name,pass] of checks)console.log(`${pass?'PASS':'FAIL'}  ${name}`);
console.log(`\n${checks.filter(x=>x[1]).length}/${checks.length} V7 controls passed`);
if(process.exitCode)process.exit(process.exitCode);
