export function targetBounds(target?:string|null){
  const raw=String(target||'').toUpperCase().replace(/,/g,'').replace(/°C/g,'').replace(/%/g,'').trim();
  if(!raw)return {low:null as number|null,high:null as number|null};
  const range=raw.match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|TO)\s*(-?\d+(?:\.\d+)?)/);
  if(range){const a=Number(range[1]),b=Number(range[2]);return {low:Math.min(a,b),high:Math.max(a,b)}}
  const lt=raw.match(/<\s*=?\s*(-?\d+(?:\.\d+)?)/);if(lt)return {low:null,high:Number(lt[1])};
  const gt=raw.match(/>\s*=?\s*(-?\d+(?:\.\d+)?)/);if(gt)return {low:Number(gt[1]),high:null};
  const exact=raw.match(/^(-?\d+(?:\.\d+)?)(?:\s*[A-Z/²()]+.*)?$/);if(exact){const n=Number(exact[1]);return {low:n,high:n}}
  return {low:null,high:null};
}
export function safeArray(v:unknown):string[]{return Array.isArray(v)?v.map(String).filter(Boolean):[]}
export function healthScore(normal:number,warning:number,critical:number,unconfigured=0){const measured=normal+warning+critical;if(!measured)return unconfigured?0:100;return Math.max(0,Math.round((normal+warning*.55)/measured*100))}
