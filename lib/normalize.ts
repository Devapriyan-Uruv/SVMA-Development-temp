export const txt=(v:unknown)=>String(v??'').trim();
export const upper=(v:unknown)=>txt(v).toUpperCase().replace(/\s+/g,' ');
export const canonRef=(v:unknown)=>upper(v).replace(/[^A-Z0-9]/g,'');
export const canonVehicle=(v:unknown)=>upper(v).replace(/[^A-Z0-9]/g,'');
export const canonParty=(v:unknown)=>upper(v)
  .replace(/PRIVATE LIMITED|PVT\.?\s*LTD\.?/g,'PVT LTD')
  .replace(/LIMITED/g,'LTD').replace(/[^A-Z0-9 ]/g,'').replace(/\s+/g,' ').trim();
export const canonMaterial=(v:unknown)=>upper(v).replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
export function similarity(a:string,b:string){
 a=canonRef(a);b=canonRef(b);if(!a||!b)return 0;if(a===b)return 1;
 const big=(s:string)=>new Set(Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)));
 const A=big(a),B=big(b);let n=0;A.forEach(x=>{if(B.has(x))n++});return (2*n)/Math.max(1,A.size+B.size);
}
export function parseDate(v:unknown){
 const s=txt(v); if(!s)return null;
 const m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/); if(m){let y=+m[3];if(y<100)y+=2000;return new Date(Date.UTC(y,+m[2]-1,+m[1]));}
 const d=new Date(s); return Number.isNaN(d.getTime())?null:d;
}
