import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const checks=[];
function check(name, ok, detail='') { checks.push({name,ok,detail}); if(!ok) process.exitCode=1; }

const entries=read('app/api/entries/route.ts');
const shift=read('app/api/shift/session/route.ts');
const board=read('components/ParameterEntryBoard.tsx');
const parser=read('lib/targetParser.ts');
const adminApi=read('app/api/admin/parameters/route.ts');
const migration=read('sql/013_v5_industrial_glass_finance_quality.sql');
const oneShot=read('sql/000_RUN_THIS_NOW_V5.sql');
const recon=read('lib/reconciliationV5.ts');
const shell=read('components/AppShell.tsx');

check('Target required before entry submission', entries.includes("code:'TARGET_REQUIRED'"));
check('Target missing never creates deviation', entries.includes("if(!target)return {validationStatus:'unconfigured',severity:null}"));
check('Shift finalization blocks target gaps', shift.includes("code:'TARGET_CONFIGURATION_REQUIRED'"));
check('Data-entry UI locks rows with no target', board.includes('Target required') && board.includes('target-entry-locked'));
check('Admin requires visible target for active data-entry parameters', adminApi.includes('A visible target is required for every active data-entry parameter'));
check('Ambiguous bare numeric targets do not auto-deviate', parser.includes('if(b.ambiguous)return null'));
check('Known source-confirmed Quality NIL targets migrated', ['PK DT','COPRA DT','DORB'].every(x=>migration.includes(x)) && migration.includes("set target_text='NIL'"));
check('Target gap audit view exists', migration.includes('data_entry_target_gaps'));
check('Target-less source rows are removed from live data entry', migration.includes('set active=false, source_review_required=true, alert_enabled=false, ticket_enabled=false'));
check('V5 one-shot SQL is Supabase-editor compatible', !oneShot.includes('\\i 013_') && oneShot.includes('finance_reconciliation_rules'));
check('Transaction reconciliation preserves weighment row population', recon.includes('rowConservation: main.length === weigh.length'));
check('Purchase payment uses actual payment allocations', recon.includes("kind: 'AGST REF' | 'ON ACCOUNT'") && recon.includes('voucherTotalPaise'));
check('Finance matching exposes review instead of guessing ambiguity', recon.includes("state: 'NEEDS REVIEW'") && recon.includes('Multiple final accounting candidates'));
check('Local-time greeting implemented client-side', shell.includes('Good morning') && shell.includes('Good afternoon') && shell.includes('Good evening'));

const productionFiles=[];
for(const dir of ['app','components','lib']){
  const walk=(d)=>{for(const e of fs.readdirSync(path.join(root,d),{withFileTypes:true})){const rel=path.join(d,e.name);if(e.isDirectory())walk(rel);else if(/\.(ts|tsx)$/.test(e.name))productionFiles.push(rel)}};walk(dir);
}
const hardcoded=productionFiles.filter(f=>/0141938|GE-OU\/3191\/26-27|DORB-SO\/00320\/26-27|DORB\/00784\/26-27/.test(read(f)));
check('Regression sample identifiers are not hardcoded in production TS/TSX', hardcoded.length===0, hardcoded.join(', '));

for(const c of checks) console.log(`${c.ok?'PASS':'FAIL'}  ${c.name}${c.detail?` — ${c.detail}`:''}`);
console.log(`\n${checks.filter(c=>c.ok).length}/${checks.length} V5 static controls passed.`);
if(process.exitCode) process.exit(process.exitCode);
