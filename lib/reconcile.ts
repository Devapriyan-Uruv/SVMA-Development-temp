import * as XLSX from 'xlsx';
import { canonMaterial, canonParty, canonRef, canonVehicle, similarity, txt } from './normalize';

export type Row = Record<string, any>;
export type MatchStatus = 'FOUND' | 'NOT FOUND' | 'NOT VERIFIED' | 'PROBABLE MATCH' | 'REQUIRES REVIEW';
export type MatchResult = { source: Row; match?: Row; status: MatchStatus; score: number; method: string; reason: string; direction?: 'IN'|'OUT'; category?: string };

export function readWorkbook(buffer: ArrayBuffer | Buffer) {
  return XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
}

function rawSheet(book: XLSX.WorkBook, sheetName: string): unknown[][] {
  const sh = book.Sheets[sheetName];
  return sh ? (XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: null, raw: false }) as unknown[][]) : [];
}

function rowsFromSheet(book: XLSX.WorkBook, sheetName: string, headerRowZeroBased: number): Row[] {
  const raw = rawSheet(book, sheetName);
  const headers = (raw[headerRowZeroBased] || []).map((x: unknown, i: number) => txt(x) || `_c${i}`);
  return raw.slice(headerRowZeroBased + 1)
    .filter((r: unknown[]) => r.some((v: unknown) => txt(v)))
    .map((r: unknown[], i: number) => ({ ...Object.fromEntries(headers.map((h: string, c: number) => [h, r[c]])), _row: headerRowZeroBased + i + 2 } as Row));
}

function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const s = txt(value);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) { let y = Number(m[3]); if (y < 100) y += 2000; return new Date(y, Number(m[2]) - 1, Number(m[1]), 12, 0, 0); }
  const named = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (named) {
    const months: Record<string,number> = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
    const mm = months[named[2].toUpperCase()]; let y=Number(named[3]); if(y<100)y+=2000;
    if (mm !== undefined) return new Date(y, mm, Number(named[1]), 12, 0, 0);
  }
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d;
}

/** Preserve the calendar date carried by Excel. Using toISOString() on an Excel local-midnight Date shifted IST workbooks back one day. */
function isoDay(d: Date | null) {
  if (!d) return null;
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function minMaxDates(rows: Row[], field='Date') {
  const ds = rows.map((r) => parseDateValue(r[field])).filter((d): d is Date => !!d).sort((a,b)=>a.getTime()-b.getTime());
  return { from: isoDay(ds[0] || null), to: isoDay(ds[ds.length-1] || null) };
}

export function parseWeighment(book: XLSX.WorkBook): Row[] {
  const sn = book.SheetNames[0]; const raw = rawSheet(book, sn);
  const idx = raw.findIndex((r) => r.some((v: unknown) => /Vehilce No|Vehicle No/i.test(txt(v))));
  if (idx < 0) return [];
  const headers = raw[idx].map((x: unknown, i: number) => txt(x) || `_c${i}`);
  return raw.slice(idx + 1).filter((r: unknown[])=>r.some((v:unknown)=>txt(v))).map((r: unknown[],i: number): Row=>{
    const o: Row = Object.fromEntries(headers.map((h:string,c:number)=>[h,r[c]]));
    return { ...o, _row: idx+i+2, _vehicle: canonVehicle(o['Vehilce No'] ?? o['Vehicle No']), _party: canonParty(o['Party Name']), _material: smartMaterial(o['Material']) };
  }).filter((o: Row)=>o._vehicle && !/TOTAL VALUES/i.test(txt(o['Party Name'])));
}

export function detectWeighmentDate(book: XLSX.WorkBook) {
  const raw = rawSheet(book, book.SheetNames[0]);
  for (const row of raw.slice(0,8)) for (const cell of row) {
    const s=txt(cell); const m=s.match(/Daily Weighment Register For The Date\s*:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i);
    if(m) return isoDay(parseDateValue(m[1]));
  }
  return null;
}

export function parseGateIn(book: XLSX.WorkBook): Row[] {
  return rowsFromSheet(book, 'GateEntry', 5).map((r)=>({ ...r, _direction:'IN', _vehicle:canonVehicle(r['Vehicle No']), _party:canonParty(r['Supplier Name']), _material:smartMaterial(r['Material Name']), _ref:canonRef(r['Purchase Order No']), _date:isoDay(parseDateValue(r['Date'])) }));
}
export function parseGateOut(book: XLSX.WorkBook): Row[] {
  return rowsFromSheet(book, 'GateOutEntry', 5).map((r)=>({ ...r, _direction:'OUT', _vehicle:canonVehicle(r['Vehicle No']), _party:canonParty(r['Customer Name']), _material:smartMaterial(r['Products Name']), _ref:canonRef(r['Supplier Order No']), _date:isoDay(parseDateValue(r['Date'])) }));
}
export function detectGatePeriod(gateIn: Row[], gateOut: Row[]) { return minMaxDates([...gateIn,...gateOut]); }

function smartMaterial(v: unknown) {
  return canonMaterial(v).replace(/DE OILED RICE BRAN/g,'DORB').replace(/RICEBRAN/g,'RICE BRAN').replace(/GRADE I{1,3}/g,'').replace(/PLASTIC|NORMAL|RAW/g,'').replace(/\s+/g,' ').trim();
}
function tokenJaccard(a:string,b:string) {
  const A=new Set(a.split(/\s+/).filter(Boolean)), B=new Set(b.split(/\s+/).filter(Boolean)); if(!A.size||!B.size)return 0;
  let n=0; for(const x of A) if(B.has(x)) n++; return n/(A.size+B.size-n);
}
function smartSimilarity(a:string,b:string) {
  if(!a||!b)return 0; const A=a.toUpperCase().trim(), B=b.toUpperCase().trim();
  const contain=A.includes(B)||B.includes(A) ? .90 : 0;
  return Math.max(similarity(A,B), tokenJaccard(A,B), contain);
}
function physicalEvidence(w:Row,g:Row) {
  if(!w._vehicle || w._vehicle!==g._vehicle)return {score:-1,material:0,party:0};
  const material=smartSimilarity(w._material||'',g._material||'');
  const party=smartSimilarity(w._party||'',g._party||'');
  return {score:.55 + .28*material + .17*party,material,party};
}
function physicalScore(w:Row,g:Row) { return physicalEvidence(w,g).score; }

export function isInternalParty(p:string) { const x=canonParty(p); return x.includes('SVMA SOYA FOODS') || x.includes('MAXI BIO OLEOS'); }
export function classifyInward(r:Row) {
  const party=canonParty(r['Supplier Name']); const ref=txt(r['Purchase Order No']).toUpperCase(); const mat=smartMaterial(r['Material Name']);
  if(isInternalParty(party)) return 'INTERNAL JOB WORK';
  if(ref.includes('JW')) return 'EXTERNAL JOB WORK';
  if(/WATER/.test(mat)) return 'WATER';
  if(/FIRE\s*WOOD|FIREWOOD/.test(mat)) return 'FIREWOOD';
  if(/JUTE|GUNNY/.test(mat)) return 'JUTE GUNNY BAGS';
  if(/STORE/.test(mat)) return 'STORE MATERIAL';
  if(ref.includes('RB-PO') || /RICE\s*BRAN/.test(mat)) return 'RICE BRAN PURCHASE';
  if(ref || /SOYA|COPRA|COCONUT|PALM|KERNEL/.test(mat)) return 'OTHER RAW MATERIAL PURCHASE';
  return 'REQUIRES REVIEW';
}
export function classifyOutward(r:Row) {
  const party=canonParty(r['Customer Name']); const ref=txt(r['Supplier Order No']).toUpperCase();
  if(isInternalParty(party)) return 'INTERNAL JOB WORK';
  if(ref.includes('JW')) return 'EXTERNAL JOB WORK';
  if(ref) return 'SALES';
  return 'REQUIRES REVIEW';
}
function categoryOf(g:Row){return g._direction==='IN'?classifyInward(g):classifyOutward(g)}

/** Weighment is the master. Extra gate rows are intentionally ignored. Each gate row can be consumed only once. */
export function matchWeighmentToGate(weigh:Row[], gateIn:Row[], gateOut:Row[]) {
  const gates=[...gateIn,...gateOut]; const matches:MatchResult[]=[]; const unmatched:Row[]=[];
  const vehicles=Array.from(new Set(weigh.map(w=>w._vehicle).filter(Boolean)));
  for(const vehicle of vehicles){
    const ws=weigh.filter(w=>w._vehicle===vehicle); const gs=gates.filter(g=>g._vehicle===vehicle);
    const pairs:{score:number;wi:number;gi:number}[]=[];
    ws.forEach((w,wi)=>gs.forEach((g,gi)=>pairs.push({score:physicalScore(w,g),wi,gi})));
    pairs.sort((a,b)=>b.score-a.score); const usedW=new Set<number>(), usedG=new Set<number>();
    for(const p of pairs){
      if(usedW.has(p.wi)||usedG.has(p.gi)||p.score<0)continue;
      const w=ws[p.wi],g=gs[p.gi],e=physicalEvidence(w,g);
      // Vehicle is a candidate key only. A final ERP/Gate allocation needs supporting party/material evidence.
      const hasSupportingEvidence=e.material>=.60||e.party>=.68;
      const repeated=gs.length>1||ws.length>1;
      const status:MatchStatus=hasSupportingEvidence&&(!repeated||p.score>=.78)?'FOUND':'PROBABLE MATCH';
      usedW.add(p.wi);usedG.add(p.gi);
      matches.push({source:w,match:g,status,score:p.score,method:'VEHICLE+MATERIAL+PARTY+ONE_TO_ONE',reason:status==='FOUND'?'Vehicle candidate was confirmed by material/party evidence with one-to-one gate allocation.':'Vehicle matched, but supporting evidence is not strong enough for a deterministic ERP/Gate match; Finance review is required.',direction:g._direction,category:categoryOf(g)});
    }
    ws.forEach((w,wi)=>{if(!usedW.has(wi))unmatched.push(w)});
  }
  return { matches, unmatchedWeigh: unmatched };
}

export function buildPhysicalSummary(weigh:Row[],gateIn:Row[],gateOut:Row[]) {
  const x=matchWeighmentToGate(weigh,gateIn,gateOut); const counts:Record<string,number>={};
  x.matches.forEach(m=>{const c=m.category||'REQUIRES REVIEW';counts[c]=(counts[c]||0)+1});
  return { ...x, counts, matchedWeighments:x.matches.length };
}
export function filterOperationalWindow(rows:Row[],_from?:string|null,_to?:string|null){return rows}
export function physicalMatch(weighments:Row[],gates:Row[]){return matchWeighmentToGate(weighments,gates.filter(g=>g._direction==='IN'),gates.filter(g=>g._direction==='OUT')).matches}

export type DayBookVoucher = Row & { date:unknown; party:string; voucherType:string; voucherNo:string; debit:number; credit:number; references:{kind:string;reference:string;amount:number;dc:string;row:number}[]; lines:{particular:string;row:number;debit:number;credit:number}[] };
export function parseDayBook(book:XLSX.WorkBook):DayBookVoucher[] {
  const raw=rawSheet(book,'Day Book'); const idx=raw.findIndex(r=>txt(r[0])==='Date'&&txt(r[1])==='Particulars'); if(idx<0)return[];
  const out:DayBookVoucher[]=[]; let current:DayBookVoucher|null=null;
  for(let i=idx+2;i<raw.length;i++){
    const r=raw[i]; const date=parseDateValue(r[0]); const particular=txt(r[1]); const vtype=txt(r[6]); const vno=txt(r[7]); const debit=num(r[8]),credit=num(r[9]);
    if(date && particular && (vtype||vno||debit||credit)){
      current={_row:i+1,date:r[0],_date:isoDay(date),party:particular,voucherType:vtype,voucherNo:vno,debit,credit,references:[],lines:[],_party:canonParty(particular),_voucher:canonRef(vno)} as DayBookVoucher;out.push(current);continue;
    }
    if(!current||!particular)continue;
    if(/^(AGST REF|NEW REF|ON ACCOUNT)$/i.test(particular)){
      current.references.push({kind:particular,reference:txt(r[2]),amount:num(r[4]),dc:txt(r[5]),row:i+1});continue;
    }
    current.lines.push({particular,row:i+1,debit,credit});
  }
  return out;
}

export function detectTallyPeriod(book:XLSX.WorkBook){const v=parseDayBook(book).map(x=>parseDateValue(x.date)).filter((d):d is Date=>!!d).sort((a,b)=>a.getTime()-b.getTime());return{from:isoDay(v[0]||null),to:isoDay(v[v.length-1]||null)}}
export function parseTallyRegisters(book:XLSX.WorkBook):Row[] {
  return parseDayBook(book).filter(v=>/PURCHASE\s*ORDER|SALES\s*ORDER/i.test(v.voucherType)).map(v=>({Date:v.date,Particulars:v.party,'Vch Type':v.voucherType,'Vch No.':v.voucherNo,_sheet:'Day Book',_kind:/PURCHASE/i.test(v.voucherType)?'PURCHASE':'SALES',_voucher:canonRef(v.voucherNo),_party:canonParty(v.party),_date:v._date}));
}
function orderCandidates(book:XLSX.WorkBook,kind:'PO'|'SO'): Row[] {
  const rx=kind==='PO'?/PURCHASE\s*ORDER/i:/SALES\s*ORDER/i;
  return parseDayBook(book).filter((v: DayBookVoucher)=>rx.test(v.voucherType)).map((v: DayBookVoucher): Row=>({ ...v,_kind:kind==='PO'?'PURCHASE':'SALES',_sheet:'Day Book',_voucher:canonRef(v.voucherNo) }));
}
function gateRef(g:Row,kind:'PO'|'SO'){return canonRef(kind==='PO'?g['Purchase Order No']:g['Supplier Order No'])}
function gateParty(g:Row,kind:'PO'|'SO'){return canonParty(kind==='PO'?g['Supplier Name']:g['Customer Name'])}

export function reconcileOrders(source:Row[],book:XLSX.WorkBook,kind:'PO'|'SO'): Row[] {
  const pool: Row[]=orderCandidates(book,kind); const coverage=detectTallyPeriod(book); const max=coverage.to?new Date(`${coverage.to}T23:59:59`).getTime():null;
  return source.map((s)=>{
    const ref=gateRef(s,kind); const party=gateParty(s,kind); const exact: Row[]=pool.filter((t:Row)=>t._voucher===ref).sort((a:Row,b:Row)=>smartSimilarity(party,b._party||'')-smartSimilarity(party,a._party||''));
    if(exact.length){const m=exact[0];return{source:s,match:m,status:'FOUND' as MatchStatus,foundInTally:'YES',score:1,method:'EXACT_VCH_NO',reason:'Exact normalized PO/SO found in Tally Day Book Vch No.; party used as supporting validation.'}}
    const gateDate=parseDateValue(s['Date']); if(gateDate&&max!==null&&gateDate.getTime()>max){return{source:s,status:'NOT VERIFIED' as MatchStatus,foundInTally:'NOT VERIFIED',score:0,method:'TALLY_PERIOD',reason:`Gate transaction is dated ${isoDay(gateDate)}, after the uploaded Tally coverage ending ${coverage.to}.`}}
    const candidates=pool.map((t:Row)=>({t,refScore:similarity(ref,t._voucher||''),partyScore:smartSimilarity(party,t._party||'')})).map(x=>({...x,score:x.refScore*.75+x.partyScore*.25})).sort((a,b)=>b.score-a.score).slice(0,3);
    return{source:s,status:'NOT FOUND' as MatchStatus,foundInTally:'NO',score:candidates[0]?.score||0,method:'EXACT_VCH_NO_NOT_FOUND',reason:'The exact normalized PO/SO was not found in Tally Day Book Vch No. within the uploaded Tally period.',candidates:candidates.map(c=>({voucherNo:c.t.voucherNo,party:c.t.party,date:c.t._date,score:c.score}))};
  });
}
export function tallyMatch(source:Row[],tally:Row[],kind:'PO'|'SO') {
  return source.map(s=>{const ref=gateRef(s,kind),party=gateParty(s,kind);const exact=tally.filter(t=>t._voucher===ref&&t._kind===(kind==='PO'?'PURCHASE':'SALES'));if(exact.length)return{source:s,match:exact.sort((a,b)=>smartSimilarity(party,b._party||'')-smartSimilarity(party,a._party||''))[0],status:'FOUND' as MatchStatus,score:1,method:'EXACT_VCH_NO',reason:'Exact normalized PO/SO found in Tally.'};return{source:s,status:'NOT FOUND' as MatchStatus,score:0,method:'EXACT_VCH_NO_NOT_FOUND',reason:'Exact normalized PO/SO not found in Tally.'}})
}

export function parseCreditDebit(book:XLSX.WorkBook):Row[] {
  const rows=rowsFromSheet(book,'CreditList',4); let lastPo='';
  return rows.map((r: Row): Row=>{if(txt(r.PONo))lastPo=txt(r.PONo);return{...r,_poOriginal:lastPo,_po:canonRef(lastPo),_party:canonParty(r['Customer Name']),_invoice:canonRef(r['Invoice No']),_lot:txt(r.LotNumber),_lotCore:lotCore(r.LotNumber),_date:isoDay(parseDateValue(r.Date))}})
    .filter((r: Row)=>txt(r['Customer Name'])&&txt(r['Invoice No'])&&txt(r.LotNumber));
}
export function detectCreditPeriod(rows:Row[]){return minMaxDates(rows,'Date')}
function lotCore(v:unknown){const s=txt(v).toUpperCase();const m=s.match(/(?:^|[^0-9])(\d{6})(?:[^0-9]|$)/);return m?m[1]:canonRef(s)}
function num(v:unknown){if(typeof v==='number'&&Number.isFinite(v))return v;const n=Number(String(v??'').replace(/,/g,'').trim());return Number.isFinite(n)?n:0}
function sameParty(sourceParty:string,voucherParty:string){return smartSimilarity(sourceParty,canonParty(voucherParty))>=.65}
function sameLot(a:unknown,b:unknown){const A=lotCore(a),B=lotCore(b);return !!A&&A===B}

function paymentAllocations(vouchers:DayBookVoucher[]): Row[] {
  const out:Row[]=[];
  for(const p of vouchers.filter(v=>/^PAYMENT$/i.test(v.voucherType.trim()))){
    const medium=p.lines.find(l=>/BANK|CASH|CC ACCOUNT/i.test(l.particular))?.particular||'';
    const instrument=p.lines.find(l=>/CHE\.?\s*NO|CHEQUE|UTR|NEFT|RTGS/i.test(l.particular))?.particular||'';
    const refs=p.references.filter(r=>/AGST REF/i.test(r.kind));
    for(const r of refs){
      out.push({
        date:p._date,
        party:p.party,
        _party:p._party,
        voucherType:p.voucherType,
        voucherNo:p.voucherNo,
        voucherDebit:num(p.debit),
        voucherCredit:num(p.credit),
        reference:r.reference,
        referenceSequence:lotCore(r.reference),
        referenceAmount:num(r.amount),
        referenceDc:r.dc,
        referenceCount:refs.length,
        medium,
        instrument,
        _row:p._row,
        _refRow:r.row
      });
    }
  }
  return out;
}

/**
 * Business formula supplied by SVMA for the Credit / Debit Note purchase rows.
 * Excel columns:
 * AJ = BillValue, AK = Rebate Value, AL = Rebate IGST Amount,
 * AB = Weightment, AC = Unloading.
 * Expected payable = AJ + 5% GST - (AK + AL) - AB - AC.
 */
function creditDebitExpectedPayable(c:Row){
  const billValue=num(c.BillValue);                // AJ
  const gst5=billValue*.05;
  const rebateValue=num(c['Rebate Value']);       // AK
  const rebateIgst=num(c['Rebate IGST Amount']);  // AL
  const weighment=num(c.Weightment);               // AB
  const unloading=num(c.Unloading);                // AC
  const expected=billValue+gst5-(rebateValue+rebateIgst)-weighment-unloading;
  return {billValue,gst5,rebateValue,rebateIgst,weighment,unloading,expected};
}

/**
 * Vendor Payment reconciliation is deliberately independent of Weighment/Gate.
 * Credit/Debit Note is the master purchase population.
 * H (LotNumber) -> six digit sequence (example RB-R/082205/26-27 -> 082205).
 * That sequence is searched in Tally Day Book column C, but only inside vouchers whose Vch Type is Payment.
 * The Payment header's Debit Amount (column I) is retained as the voucher total.
 * If one Payment voucher pays multiple Agst Ref lots, the exact matched child allocation is used for the lot comparison
 * so the voucher total is not incorrectly repeated against every lot.
 */
export function purchasePaymentReconcile(creditRows:Row[],book:XLSX.WorkBook): Row[] {
  const vouchers=parseDayBook(book);
  const allocations=paymentAllocations(vouchers);
  return creditRows.map((c:Row)=>{
    const sequence=c._lotCore||lotCore(c.LotNumber);
    const sourceParty=c._party||canonParty(c['Customer Name']);
    const formula=creditDebitExpectedPayable(c);

    // First locate Payment vouchers by the lot sequence carried in Tally column C.
    const sequenceMatches:Row[]=allocations.filter((a:Row)=>a.referenceSequence===sequence);
    const vendorMatches:Row[]=sequenceMatches.filter((a:Row)=>sameParty(sourceParty,a.party));
    const candidates=vendorMatches;

    // A matching sequence only counts as a confirmed payment when the vendor also agrees.
    // The same six-digit sequence can legitimately appear for other parties, so other-party matches are not treated as payment.
    const hasSequence=sequenceMatches.length>0;
    const hasVendorPayment=vendorMatches.length>0;

    // Do not duplicate the parent Debit total when one Payment voucher contains several Agst Ref lots.
    // For a single-reference voucher the reference amount and Debit total are normally identical.
    const comparisonAmounts=vendorMatches.map((a:Row)=>a.referenceCount>1?num(a.referenceAmount):(num(a.voucherDebit)||num(a.referenceAmount)));
    const paidAmount=comparisonAmounts.reduce((s:number,v:number)=>s+v,0);
    const lotAllocatedAmount=vendorMatches.reduce((s:number,a:Row)=>s+num(a.referenceAmount),0);
    const paymentVoucherDebitTotal=vendorMatches.reduce((s:number,a:Row,idx:number,arr:Row[])=>{
      const key=`${a.date}|${a.voucherNo}`;
      return arr.findIndex((x:Row)=>`${x.date}|${x.voucherNo}`===key)===idx ? s+num(a.voucherDebit) : s;
    },0);

    const difference=hasVendorPayment?paidAmount-formula.expected:null;
    let status='NOT PAID';
    let comment=hasSequence?'The same six-digit sequence appears under other Tally Payment parties, but no Payment voucher was found for this Lot sequence and this vendor. It is therefore not treated as paid.':'No Tally voucher with Vch Type Payment contains this Lot sequence for the same vendor in the uploaded Day Book.';
    if(hasVendorPayment&&Math.abs(difference||0)<=1){
      status='RECONCILED';
      comment='Lot sequence, vendor and Tally Payment voucher are confirmed. The calculated Credit / Debit payable matches the paid amount within ₹1.';
    }else if(hasVendorPayment&&(difference||0)<-1){
      status='SHORT PAID';
      comment=`Payment is confirmed for this Lot and vendor, but the amount is short by ₹${Math.round(Math.abs(difference||0)).toLocaleString('en-IN')}.`;
    }else if(hasVendorPayment&&(difference||0)>1){
      status='EXCESS PAID';
      comment=`Payment is confirmed for this Lot and vendor, but the amount exceeds the calculated payable by ₹${Math.round(Math.abs(difference||0)).toLocaleString('en-IN')}.`;
    }

    const paymentDate=hasVendorPayment?vendorMatches.map((x:Row)=>x.date).filter(Boolean).sort().at(-1)||'':'';
    const paymentVoucher=hasVendorPayment?Array.from(new Set(vendorMatches.map((x:Row)=>x.voucherNo))).join(', '):'';
    const paymentMedium=hasVendorPayment?Array.from(new Set(vendorMatches.map((x:Row)=>x.medium).filter(Boolean))).join(', '):'';
    const instrument=hasVendorPayment?Array.from(new Set(vendorMatches.map((x:Row)=>x.instrument).filter(Boolean))).join(', '):'';
    const tallyReference=hasVendorPayment?Array.from(new Set(vendorMatches.map((x:Row)=>x.reference))).join(', '):hasSequence?Array.from(new Set(sequenceMatches.map((x:Row)=>x.reference))).join(', '):'';

    return {
      poNumber:c._poOriginal||c.PONo,
      vendor:c['Customer Name'],
      invoice:c['Invoice No'],
      lotNumber:c.LotNumber,
      lotSequence:sequence,
      referenceNumber:c['Reference Number'],
      sourceDate:c.Date,

      // User-specified source formula audit.
      billValueAJ:formula.billValue,
      gst5Percent:formula.gst5,
      rebateValueAK:formula.rebateValue,
      rebateIgstAL:formula.rebateIgst,
      weighmentAB:formula.weighment,
      unloadingAC:formula.unloading,
      calculatedPayable:formula.expected,

      // Tally Payment validation.
      paymentFound:hasVendorPayment?'YES':'NO',
      tallyReference:hasVendorPayment?tallyReference:'',
      tallyVoucherType:hasVendorPayment?'Payment':'',
      paymentAmount:paidAmount,
      lotAllocatedAmount,
      paymentVoucherDebitTotal,
      paymentDifference:difference,
      outstanding:hasVendorPayment?Math.max(0,formula.expected-paidAmount):formula.expected,
      paymentDate,
      paymentVoucher,
      paymentMedium,
      instrument,
      status,
      comment,
      matches:candidates.map((x:Row)=>({date:x.date,party:x.party,voucherType:x.voucherType,voucherNo:x.voucherNo,reference:x.reference,sequence:x.referenceSequence,voucherDebit:x.voucherDebit,referenceAmount:x.referenceAmount,referenceCount:x.referenceCount,medium:x.medium,instrument:x.instrument}))
    };
  });
}

export function vendorPaymentSummary(rows:Row[]) {
  return {
    detailRows:rows.length,
    paymentFound:rows.filter((r:Row)=>r.paymentFound==='YES').length,
    reconciled:rows.filter((r:Row)=>r.status==='RECONCILED').length,
    shortPaid:rows.filter((r:Row)=>r.status==='SHORT PAID').length,
    excessPaid:rows.filter((r:Row)=>r.status==='EXCESS PAID').length,
    vendorReview:rows.filter((r:Row)=>r.status==='VENDOR REVIEW').length,
    notPaid:rows.filter((r:Row)=>r.status==='NOT PAID').length,
    amountReview:rows.filter((r:Row)=>['SHORT PAID','EXCESS PAID','VENDOR REVIEW'].includes(r.status)).length
  };
}

export function salesReceiptReconcile(_book:XLSX.WorkBook){return[] as Row[]}
