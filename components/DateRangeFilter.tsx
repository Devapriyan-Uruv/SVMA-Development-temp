'use client';
// A small, purely additive reporting filter for a register/list page —
// From/To dates, nothing else. Read-only query narrowing on the fetch it
// feeds; never touches shift/session state, so it can't affect a shift
// currently running.
export function DateRangeFilter({from,to,onFrom,onTo,onClear}:{from:string;to:string;onFrom:(v:string)=>void;onTo:(v:string)=>void;onClear:()=>void}){
 return <div style={{display:'flex',gap:8,alignItems:'end',flexWrap:'wrap'}}>
  <label className="field" style={{minWidth:0}}><span>From</span><input type="date" value={from} onChange={e=>onFrom(e.target.value)}/></label>
  <label className="field" style={{minWidth:0}}><span>To</span><input type="date" value={to} onChange={e=>onTo(e.target.value)}/></label>
  {(from||to)?<button type="button" className="btn btn-outline btn-sm" onClick={onClear}>Clear</button>:null}
 </div>;
}
