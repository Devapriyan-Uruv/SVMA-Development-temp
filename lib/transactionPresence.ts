import * as XLSX from 'xlsx';

export const CATEGORIES = ['Purchase', 'Sales', 'Others', 'Job Work'] as const;
export type Category = typeof CATEGORIES[number];
export type Source = { file: string; sheet: string; row: number };
export type Weighment = { id: string; ref: string; vehicle: string; party: string; material: string; weight: number | null; date: string; source: Source };
export type Gate = { id: string; gp: string; vehicle: string; party: string; material: string; order: string; invoice: string; date: string; direction: 'IN' | 'OUT'; source: Source };
export type Voucher = { id: string; company: string; date: string; party: string; type: string; vch: string; order: string; invoice: string; qty: number | null; particulars: string[]; details: string[]; sources: Source[] };
export type PresenceRules = { nameThreshold: number; gateNameThreshold: number; gateWindowDays: number; jobWorkPrefixes: string[]; purchaseMaterials: string[]; nameAliases: [string, string][] };
export const DEFAULT_RULES: PresenceRules = { nameThreshold: 0.86, gateNameThreshold: 0.84, gateWindowDays: 1, jobWorkPrefixes: ['JOW-SO/', 'JOW-PO/'], purchaseMaterials: ['RICE BRAN', 'COPRA', 'SOYA BEANS', 'COCONUT CAKE', 'PALM KERNEL'], nameAliases: [] };
export const text = (value: unknown) => value == null ? '' : String(value).trim();
export const normalize = (value: unknown) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
const header = (value: unknown) => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const unique = <T,>(items: T[]) => Array.from(new Set(items));
const raw = (book: XLSX.WorkBook, sheet: string): unknown[][] => XLSX.utils.sheet_to_json(book.Sheets[sheet], { header: 1, raw: true, defval: null });

export function calendarDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  let y = 0, m = 0, d = 0; const s = text(value);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  const dm = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  const named = s.match(/^(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{2,4})$/);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (dm) { d = +dm[1]; m = +dm[2]; y = +dm[3]; }
  else if (named) { d = +named[1]; m = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(named[2].slice(0,3).toUpperCase()) + 1; y = +named[3]; }
  else return '';
  if (y < 100) y += 2000;
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : '';
}
const distance = (a: string, b: string) => a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / 86400000 : null;
function number(value: unknown): number | null { if (!text(value)) return null; const n = Number(text(value).replace(/,/g,'')); return Number.isFinite(n) ? n : null; }
function index(row: unknown[], aliases: string[]) { return row.findIndex(cell => aliases.map(header).includes(header(cell))); }
function findTable(book: XLSX.WorkBook, groups: string[][], label: string) {
  for (const sheet of book.SheetNames) {
    const rows = raw(book, sheet), hi = rows.slice(0, 60).findIndex(row => groups.every(aliases => index(row, aliases) >= 0));
    if (hi >= 0) return { sheet, rows, hi, headers: rows[hi] };
  }
  throw new Error(`${label}: required column headers were not found. Check the selected file and its headings.`);
}
const VEHICLES = ['Vehilce No', 'Vehicle No', 'Vehicle Number', 'Lorry No', 'Truck No'];
const REFS = ['Serial No', 'Weigh Bridge Ref No', 'Weighment No', 'Weighment Ref', 'Ticket No'];
const NET = ['Net Weight', 'NetWeight', 'Net Wt', 'Net Weight (kg)', 'Net Weight (Kgs)', 'Net'];
export function parseWeighmentUpload(book: XLSX.WorkBook, file: string, selectedDate = '') {
  const t = findTable(book, [VEHICLES, REFS, ['Material', 'Material Name'], ['Party Name', 'Party', 'Supplier Name']], 'Weighment');
  const h = t.headers, vi = index(h, VEHICLES), ri = index(h, REFS), pi = index(h, ['Party Name','Party','Supplier Name']), mi = index(h, ['Material','Material Name']), wi = index(h, NET), di = index(h, ['Date','Weighment Date']);
  if (wi < 0) throw new Error('Weighment: Net Weight column is required.');
  const title = t.rows.slice(0,t.hi).flat().map(text).join(' ');
  const titleDate = title.match(/(?:for\s+the\s+date|date)\s*:?\s*(\d{1,2}[-/.][A-Za-z0-9]{1,9}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})/i)?.[1];
  const detectedDate = calendarDate(titleDate);
  if (selectedDate && !calendarDate(selectedDate)) throw new Error('Choose a valid reconciliation date.');
  const rows: Weighment[] = [];
  t.rows.forEach((r,i) => {
    const total = /^(grand\s+total|total\s+values|total)$/i;
    const hasMovement = !!text(r[vi]) || (!!text(r[pi]) && !!text(r[mi]));
    if (i <= t.hi || !hasMovement || total.test(text(r[pi])) || total.test(text(r[ri])) || header(r[ri]) === header(h[ri])) return;
    rows.push({ id: `${file}|${t.sheet}|${i+1}`, ref: text(r[ri]), vehicle: text(r[vi]), party: text(r[pi]), material: text(r[mi]), weight: number(r[wi]), date: calendarDate(selectedDate) || calendarDate(di >= 0 ? r[di] : '') || detectedDate, source: { file, sheet: t.sheet, row: i+1 } });
  });
  if (!rows.length) throw new Error('Weighment: no physical entries found.');
  if (rows.some(r => !r.date)) throw new Error('Weighment date could not be detected. Choose the reconciliation date and run again.');
  const dates = unique(rows.map(r => r.date));
  if (dates.length !== 1) throw new Error('This report contains multiple weighment dates. Upload one operational day at a time.');
  return { rows, date: dates[0] };
}
export function parseGateUpload(book: XLSX.WorkBook, file: string, direction: 'IN' | 'OUT'): Gate[] {
  const parties = direction === 'IN' ? ['Supplier Name','Vendor Name'] : ['Customer Name','Party Name'];
  const materials = direction === 'IN' ? ['Material Name','Material'] : ['Products Name','Product Name','Material Name','Material'];
  const t = findTable(book, [VEHICLES, ['GatePass No','Gate Pass No','Gate Entry No'], parties, materials], `Gate ${direction}`);
  const h=t.headers, vi=index(h,VEHICLES), gi=index(h,['GatePass No','Gate Pass No','Gate Entry No']), pi=index(h,parties), mi=index(h,materials), di=index(h,['Date','Gate Date']), oi=index(h,direction==='IN'?['Purchase Order No','PO No']:['Supplier Order No','Sales Order No','SO No']), ii=index(h,['Invoice Number','Invoice No']);
  return t.rows.flatMap((r,i) => i <= t.hi || !text(r[gi]) || !text(r[vi]) || header(r[gi])===header(h[gi]) ? [] : [{ id:`${file}|${t.sheet}|${i+1}`,gp:text(r[gi]),vehicle:text(r[vi]),party:text(r[pi]),material:text(r[mi]),order:text(r[oi]),invoice:text(r[ii]),date:calendarDate(r[di]),direction,source:{file,sheet:t.sheet,row:i+1} }]);
}

/** Read the voucher header and all its Particulars lines; supporting registers are independent evidence. */
export function parseTallyUpload(book: XLSX.WorkBook, file: string) {
  const output: Voucher[]=[]; let recognized=0;
  for (const sheet of book.SheetNames) {
    const rows=raw(book,sheet), hi=rows.slice(0,60).findIndex(r=>index(r,['Date'])>=0&&index(r,['Particulars'])>=0&&index(r,['Vch No.','Voucher No.'])>=0);
    if(hi<0) continue; recognized++;
    const h=rows[hi],di=index(h,['Date']),pi=index(h,['Particulars']),vi=index(h,['Vch No.','Voucher No.']),ti=index(h,['Vch Type','Voucher Type']),oi=index(h,['Voucher Ref. No.','Voucher Ref No','Order No','Purchase Order No','Sales Order No']),ii=index(h,['Supplier Invoice No.','Invoice No.']),qi=index(h,['Quantity','Qty']),ni=index(h,['Narration']);
    let company=text(rows.slice(0,hi).find(r=>r.some(v=>text(v)))?.find(v=>text(v)));
    const registerType=rows.slice(0,hi).flat().map(text).find(s=>/Register$/i.test(s))?.replace(/\s+Register$/i,'') || sheet.replace(/\s+Register$/i,'');
    let current: Voucher | null=null;
    for(let i=hi+1;i<rows.length;i++) {
      const r=rows[i],vch=text(r[vi]),party=text(r[pi]),date=calendarDate(r[di]);
      if(header(r[di])==='date'&&header(r[pi])==='particulars'){current=null;continue;}
      if(!party&&!vch&&/\b(?:PVT|PRIVATE|LIMITED|LTD)\b/i.test(text(r[di]))&&!date){company=text(r[di]);current=null;continue;}
      if(vch&&party&&date&&(ti<0||text(r[ti]))) {
        current={id:'',company,date,party,type:ti>=0?text(r[ti]):registerType,vch,order:text(r[oi]),invoice:text(r[ii]),qty:number(r[qi]),particulars:[party],details:ni>=0&&text(r[ni])?[text(r[ni])]:[],sources:[{file,sheet,row:i+1}]};output.push(current);
      } else if(current&&ti>=0&&party) {
        if(!/^(New Ref|Agst Ref|On Account)$/i.test(party))current.particulars.push(party);
        current.details.push(r.filter(v=>text(v)).map(text).join(' | '));
      }
    }
  }
  if(!recognized) throw new Error('Tally: no Day Book or supporting register with Date, Particulars and Vch No. / Voucher No. was found.');
  const map=new Map<string,Voucher>();
  for(const v of output) {
    const key=[normalize(v.company),v.date,normalize(v.type),normalize(v.vch),normalize(v.party)].join('|');
    const existing=map.get(key);
    if(existing){existing.sources.push(...v.sources);existing.details=unique([...existing.details,...v.details]);existing.particulars=unique([...existing.particulars,...v.particulars]);existing.order||=v.order;existing.invoice||=v.invoice;existing.qty??=v.qty;}
    else map.set(key,{...v,id:key});
  }
  return {vouchers:[...map.values()],rawVoucherCount:output.length,recognizedSheets:recognized};
}

function nameKey(value: string) {
  return value.toUpperCase().replaceAll('T/R',' TRADERS ').replaceAll('P/F',' POULTRY FARM ').replaceAll('F/W',' FIREWOOD ').replace(/\bP\s+LTD\b/g,' PRIVATE LIMITED ').replace(/\bTR\.?\b/g,' TRADERS ').replace(/[^A-Z0-9 ]/g,'').replace(/\b(LTD|LIMITED|PVT|PRIVATE|TRADERS|TRADER|AGENCIES|AGENCY|STORES|STORE|FW|FIREWOOD|BRAN|DORB|DOB|CAKE|OIL|OILS|CREDITORS|SCREDITORS|NEW|SRI|SHREE|SREE)\b/g,' ').replace(/\s/g,'');
}
/** Longest contiguous matching blocks, with deterministic tie breaking, as in the reviewed sample. */
function sequenceRatio(a:string,b:string):number {
  if(!a.length&&!b.length)return 1;
  function matches(alo:number,ahi:number,blo:number,bhi:number):number {
    let best=0,ai=alo,bj=blo,prev=new Map<number,number>();
    for(let i=alo;i<ahi;i++) {const next=new Map<number,number>();for(let j=blo;j<bhi;j++)if(a[i]===b[j]){const size=(prev.get(j-1)||0)+1;next.set(j,size);if(size>best){best=size;ai=i-size+1;bj=j-size+1;}}prev=next;}
    if(!best)return 0;
    return best+(ai>alo&&bj>blo?matches(alo,ai,blo,bj):0)+(ai+best<ahi&&bj+best<bhi?matches(ai+best,ahi,bj+best,bhi):0);
  }
  return 2*matches(0,a.length,0,b.length)/(a.length+b.length);
}
export function nameSimilarity(originalA:string,originalB:string,rules:PresenceRules=DEFAULT_RULES):number {
  if(rules.nameAliases.some(([a,b])=>(normalize(a)===normalize(originalA)&&normalize(b)===normalize(originalB))||(normalize(b)===normalize(originalA)&&normalize(a)===normalize(originalB))))return 1;
  const a=nameKey(originalA),b=nameKey(originalB);if(!a||!b)return 0;if(a===b)return 1;
  const [short,long]=a.length<=b.length?[a,b]:[b,a];
  if(short.length>=3&&long.startsWith(short))return .96;
  if(short.length===2&&long.startsWith(short)&&[originalA,originalB].some(s=>normalize(s).startsWith(short+'TRADER')))return .90;
  if(short.length>=5&&long.slice(1).startsWith(short))return .90;
  let score=sequenceRatio(a,b);
  if(short.length>=5)for(let n=Math.max(1,short.length-2);n<short.length+3;n++)score=Math.max(score,sequenceRatio(short,long.slice(0,n))*.94);
  return score;
}
export function materialFamily(value:string):string {
  const n=normalize(value);
  if(n.includes('GUNNY')||n.includes('STITCHEDPLASTIC'))return 'GUNNY';
  if(n.includes('FIREWOOD'))return 'FIREWOOD';if(n.includes('WATER'))return 'WATER';
  if(n.includes('SOYABARI'))return 'SOYABARI';
  if(n.includes('REFINEDRICEBRANOIL')||n.includes('RRBOIL'))return 'RRB OIL';
  if(n.includes('DEOILEDRICEBRAN')||n.includes('DORB'))return 'DORB';
  if(n.includes('RICEBRAN'))return 'RICE BRAN';if(n.includes('COPRA'))return 'COPRA';
  if(n.includes('STOREMATERIAL'))return 'STORE MATERIAL';if(n.includes('EARTH'))return 'EARTH';
  if(n.includes('FLOUR'))return 'FLOUR';if(n.includes('MANGODOC')||n.includes('MIXINGDOC'))return 'MANGO DOC';
  if(n.includes('SOYABEAN'))return 'SOYA BEANS';if(n.includes('COCONUTCAKE'))return 'COCONUT CAKE';
  if(n.includes('PALMKERNEL')||n.includes('PALMKERNAL'))return 'PALM KERNEL';return n;
}
function classify(w:Weighment,gates:Gate[],rules:PresenceRules):Category {
  const m=materialFamily(w.material);
  if(['FIREWOOD','WATER','STORE MATERIAL','GUNNY'].includes(m))return 'Others';
  if(m==='SOYABARI'||gates.some(g=>/^JWBARI-SO\//i.test(g.order)))return 'Sales';
  if(gates.some(g=>rules.jobWorkPrefixes.some(prefix=>g.order.toUpperCase().startsWith(prefix.toUpperCase())))||/\bJOB\s*WORK\b/i.test(w.material))return 'Job Work';
  if(gates.some(g=>g.direction==='OUT'&&g.order))return 'Sales';
  if(normalize(w.party).includes('INNERSHIF')||(normalize(w.party).includes('SVMA')&&['MANGO DOC','FLOUR'].includes(m)))return 'Others';
  if(rules.purchaseMaterials.includes(m)||gates.some(g=>g.direction==='IN'&&g.order))return 'Purchase';
  return 'Others';
}
export type NameEvidence = { weighmentId:string; weighmentRef:string; vehicle:string; category:Category; basis:string; nameSource:string; searchedName:string; tallyParticulars:string; nameVerification:string; nameScore:number; voucherType:string; voucherNo:string; voucherDate:string; company:string; matchedOrders:string[]; supplierInvoice:string; registerQuantity:number|null; weighmentKg:number|null; details:string[]; sources:Source[] };
export type GateEvidence = Gate & { selected:boolean; nameScore:number; disposition:string };
export type PresenceRow = { serialNo:number; weighmentId:string; weighBridgeRef:string; lorryNo:string; partyName:string; material:string; netWeight:number|null; status:Category; erpGpNo:string; tallyRefNo:string; tallyState:string; erpState:string; basis:string; gateParties:string[]; tallyParticulars:string[]; candidates:GateEvidence[]; evidence:NameEvidence[]; notes:string[]; source:Source };
export function reconcilePresence(weigh:Weighment[],gateInput:Gate[],vouchers:Voucher[],rules:PresenceRules=DEFAULT_RULES) {
  if(!(rules.nameThreshold>0&&rules.nameThreshold<=1&&rules.gateNameThreshold>0&&rules.gateNameThreshold<=1&&Number.isInteger(rules.gateWindowDays)&&rules.gateWindowDays>=0))throw new Error('Invalid reconciliation rule thresholds.');
  const gates=[...new Map(gateInput.map(g=>[[g.direction,g.gp,g.date,normalize(g.vehicle),normalize(g.party),normalize(g.material),g.order,g.invoice].join('|'),g])).values()];
  const selectedById=new Map<string,Gate[]>();
  const main:PresenceRow[]=weigh.map((w,idx)=>{
    const vehicleCandidates=normalize(w.vehicle)?gates.filter(g=>normalize(g.vehicle)===normalize(w.vehicle)):[];
    const inWindow=vehicleCandidates.filter(g=>!g.date||(distance(w.date,g.date)??Infinity)<=rules.gateWindowDays);
    const materialCandidates=inWindow.filter(g=>materialFamily(g.material)===materialFamily(w.material));
    const partyCandidates=materialCandidates.filter(g=>nameSimilarity(w.party,g.party,rules)>=rules.gateNameThreshold);
    let selected=partyCandidates.length?partyCandidates:materialCandidates;
    const sameDay=selected.filter(g=>g.date===w.date);if(sameDay.length)selected=sameDay;
    selectedById.set(w.id,selected);
    const category=classify(w,selected,rules);
    let erpState=selected.length===1?(partyCandidates.length?'Unique vehicle/material/party match':'Vehicle/material match; party differs'):selected.length>1?'Multiple Gate candidates':inWindow.length?'Vehicle found; material differs':vehicleCandidates.length?'Vehicle found outside date window':'Vehicle not found';
    if(selected.length===1&&!selected[0].date)erpState='Gate date missing; candidate only';
    const names=[...selected.map(g=>({source:`Gate ${g.direction}`,name:g.party})),{source:'Weighment',name:w.party}];
    const orders=unique(selected.map(g=>g.order).filter(Boolean));
    const evidence:NameEvidence[]=[];
    for(const v of vouchers) {
      let best={score:0,source:'',searched:'',particular:''};
      for(const name of names)for(const particular of v.particulars){const score=nameSimilarity(name.name,particular,rules);if(score>best.score)best={score,source:name.source,searched:name.name,particular};}
      const matchedOrders=orders.filter(o=>[normalize(v.vch),normalize(v.order)].includes(normalize(o)));
      const nameMatch=best.score>=rules.nameThreshold;if(!nameMatch&&!matchedOrders.length)continue;
      let basis=matchedOrders.length?(nameMatch?'Order/reference + name match':'Order/reference match; name differs'):'Name match only';
      if(selected.some(g=>g.invoice&&v.invoice&&normalize(g.invoice)===normalize(v.invoice)))basis+='; invoice matches';
      evidence.push({weighmentId:w.id,weighmentRef:w.ref,vehicle:w.vehicle,category,basis,nameSource:best.source,searchedName:best.searched,tallyParticulars:best.particular,nameVerification:nameMatch?(best.score===1?'Exact normalized / configured alias':'Similar name'):'Name differs',nameScore:Math.round(best.score*1000)/1000,voucherType:v.type,voucherNo:v.vch,voucherDate:v.date,company:v.company,matchedOrders,supplierInvoice:v.invoice,registerQuantity:v.qty,weighmentKg:w.weight,details:v.details,sources:v.sources});
    }
    const notes:string[]=[];
    if(selected.length>1)notes.push('Gate references are candidates, not allocated trips.');
    if(selected.some(g=>nameSimilarity(w.party,g.party,rules)<rules.gateNameThreshold))notes.push('Gate and weighment party names differ; a Tally name finding does not resolve this difference.');
    if(evidence.some(e=>e.nameSource==='Weighment'))notes.push('Includes independent Weighment Party Name search.');
    if(evidence.some(e=>e.voucherDate!==w.date))notes.push('Includes other voucher dates present in the uploaded Tally workbook.');
    if(evidence.length)notes.push('Name/reference presence evidence; not confirmation of this delivery booking or quantity.');
    if(w.weight===null)notes.push('Net weight is missing or invalid in the source.');
    if(!w.ref)notes.push('Weighment reference is missing; physical row retained using its source row.');
    if(!w.vehicle)notes.push('Vehicle number is missing; name verification still runs.');
    return {serialNo:idx+1,weighmentId:w.id,weighBridgeRef:w.ref,lorryNo:w.vehicle,partyName:w.party,material:w.material,netWeight:w.weight,status:category,erpGpNo:selected.length===1&&selected[0].date?selected[0].gp:'',tallyRefNo:unique(evidence.map(e=>e.voucherNo)).join('\n'),tallyState:evidence.length?'Matching with Tally':'Not found in uploaded Tally',erpState,basis:evidence.some(e=>e.basis.startsWith('Order/reference + name'))?'Order/reference + name':evidence.some(e=>e.matchedOrders.length)?'Order/reference':evidence.length?'Name only':'No name or order match',gateParties:unique(selected.map(g=>g.party)),tallyParticulars:unique(evidence.map(e=>e.tallyParticulars)),candidates:vehicleCandidates.map(g=>({...g,selected:selected.includes(g),nameScore:Math.round(nameSimilarity(w.party,g.party,rules)*1000)/1000,disposition:selected.includes(g)?'Candidate':!inWindow.includes(g)?'Outside date window':!materialCandidates.includes(g)?'Material differs':'Other party/date candidate'})),evidence,notes,source:w.source};
  });
  // One Gate cannot be silently allocated to several physical movements.
  for(const r of main){const selected=selectedById.get(r.weighmentId)||[];if(r.erpGpNo&&selected.some(g=>[...selectedById.values()].filter(gs=>gs.some(x=>x.id===g.id)).length>1)){r.erpGpNo='';r.erpState='Gate also candidate for another weighment';r.notes.push('Gate allocation is not unique across the weighment population.');}}
  const refs=new Map<string,number>();for(const w of weigh)refs.set(w.ref,(refs.get(w.ref)||0)+1);
  for(const r of main)if((refs.get(r.weighBridgeRef)||0)>1)r.notes.push('Duplicate weighment reference in source; source rows retained separately.');
  const categoryCounts=Object.fromEntries(CATEGORIES.map(c=>[c,main.filter(r=>r.status===c).length])) as Record<Category,number>;
  const categorySummary=CATEGORIES.map(category=>({category,total:categoryCounts[category],found:main.filter(r=>r.status===category&&r.evidence.length).length,notFound:main.filter(r=>r.status===category&&!r.evidence.length).length}));
  const tallyMatched=main.filter(r=>r.evidence.length).length,erpMatched=main.filter(r=>r.erpGpNo).length;
  return {svmaCR:main,categoryCounts,categorySummary,nameEvidence:main.flatMap(r=>r.evidence),summary:{weighments:weigh.length,physicalMovements:weigh.length,gateMatched:erpMatched,gateMatchRequired:weigh.length-erpMatched,erpMatched,erpMissing:main.filter(r=>r.erpState==='Vehicle not found').length,tallyMatched,tallyMissing:weigh.length-tallyMatched,needsReview:main.filter(r=>!r.erpGpNo).length,purchases:categoryCounts.Purchase,sales:categoryCounts.Sales,others:categoryCounts.Others,jobWork:categoryCounts['Job Work'],purchaseFound:categorySummary[0].found,purchaseMissing:categorySummary[0].notFound,salesFound:categorySummary[1].found,salesMissing:categorySummary[1].notFound},sourceControl:{physicalWeighments:weigh.length,generatedMainRecords:main.length,missingSourceTransactions:weigh.filter(w=>!main.some(r=>r.weighmentId===w.id)).length,duplicateOutputTransactions:main.length-new Set(main.map(r=>r.weighmentId)).size,duplicateSourceReferences:[...refs.values()].reduce((n,count)=>n+Math.max(0,count-1),0),rowConservation:main.length===weigh.length&&new Set(main.map(r=>r.weighmentId)).size===weigh.length,categoryTotal:categorySummary.reduce((n,c)=>n+c.total,0)}};
}
export const sourceLabel=(s:Source)=>`${s.file} | ${s.sheet} | row ${s.row}`;
export function period(dates:string[]){const sorted=unique(dates.filter(Boolean)).sort();return {from:sorted[0]||null,to:sorted.at(-1)||null};}
