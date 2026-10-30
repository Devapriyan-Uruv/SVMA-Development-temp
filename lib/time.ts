// India Standard Time is a fixed +5:30 offset with no DST. All plant
// operations (shift boundaries, "today", report dates) are meant in IST
// regardless of what timezone the Node process itself happens to run in
// (Render defaults to UTC). Never use `new Date(y,m-1,d,h,mi)` or a bare
// `new Date().toISOString().slice(0,10)` for shift/operational-date logic —
// both silently take on the server's local timezone / UTC instead of IST.
// Use these helpers instead; they give the same correct answer everywhere.
export const IST_OFFSET_MS=5.5*60*60*1000;

// Build the UTC instant for a given IST wall-clock date/time, e.g. the
// shift_master start_time ("06:00") on a given operational_date.
export function istToUtc(y:number,m:number,d:number,h=0,mi=0,s=0):Date{
  return new Date(Date.UTC(y,m-1,d,h,mi,s)-IST_OFFSET_MS);
}

// The calendar date (YYYY-MM-DD) that a given instant falls on in IST.
// Defaults to "now".
export function istDateString(at:Date|number=Date.now()):string{
  const t=typeof at==='number'?at:at.getTime();
  return new Date(t+IST_OFFSET_MS).toISOString().slice(0,10);
}

// "Today" in IST — the correct replacement for
// `new Date().toISOString().slice(0,10)`, which returns the UTC date and
// is wrong for the first ~5.5 hours of the IST calendar day.
export function istTodayDate():string{return istDateString()}

// "Yesterday" in IST — the SVMA team updates yesterday's ERP data today, so
// the ERP Push default date is always this, never istTodayDate().
export function istYesterdayDate():string{return istDateString(Date.now()-86400000)}
