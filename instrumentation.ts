// Next.js calls register() exactly once when the server process starts —
// this is the supported place to kick off a background loop without a
// custom server.js. Only safe because this app runs on Render as a single
// long-lived Node process (`next start`), not on a serverless/edge
// platform that spins instances up and down per request — there, a
// setInterval here would either never run or run once per cold start.
// If this app ever scales to multiple instances, each would run its own
// sweep independently; that's harmless (the DB update marks a row
// processed, so a second instance just finds nothing left to do), just
// redundant work, not a correctness problem.
export async function register(){
 if(process.env.NEXT_RUNTIME!=='nodejs')return;
 const g=globalThis as any;
 if(g.__svmaPushSweepStarted)return; // guard against register() re-firing on dev hot reload
 g.__svmaPushSweepStarted=true;

 const {runPushSweep}=await import('./lib/pushSweep');
 const INTERVAL_MS=5*60*1000;
 async function tick(){try{await runPushSweep()}catch{/* best-effort — never take the server down over this */}}
 setTimeout(tick,15000); // an initial run shortly after boot, rather than waiting a full interval
 setInterval(tick,INTERVAL_MS);

 // Daily pull of the ERP Report API into the erp_api_* tables. The server can be asleep at the scheduled hour, so this is checked
 // on every tick and runs as soon as the process is awake after 06:00 IST, once a day (see lib/ops/mtreport/sync.ts).
 const {maybeRunScheduledSync}=await import('./lib/ops/mtreport/sync');
 async function erpTick(){try{await maybeRunScheduledSync()}catch{/* best-effort — a failed pull is logged in erp_api_sync_runs, never takes the server down */}}
 setTimeout(erpTick,60000);
 setInterval(erpTick,INTERVAL_MS);

 // Morning Import status for the data owner and management: once a day, as soon as the process is awake after 08:00 IST
 // (lib/importMaster/notify.ts — idempotent per person per day, so a second instance or a restart sends nothing twice).
 const {maybeRunImportDaily}=await import('./lib/importMaster/notify');
 const {supabaseAdmin}=await import('./lib/supabase/admin');
 async function importTick(){try{await maybeRunImportDaily(supabaseAdmin())}catch{/* best-effort — retried on the next tick */}}
 setTimeout(importTick,90000);
 setInterval(importTick,INTERVAL_MS);
}
