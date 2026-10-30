import * as XLSX from 'xlsx';
import { CATEGORIES, sourceLabel, type PresenceRow, type NameEvidence } from './transactionPresence';
const HEADERS=['S.No','Lorry NO','Party Name','Material','Net Weight','WEIGH BRIDGE REF NO','ERP GP NO','TALLY REF NO','STATUS'];
function sheet(book:XLSX.WorkBook,name:string,headers:string[],rows:unknown[][]){
 const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);
 ws['!cols']=headers.map(h=>({wch:/Particulars|searched|Reason|Notes|Source|Evidence|Candidate/i.test(h)?48:/Weight|S.No|date/i.test(h)?18:28}));
 ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length,c:headers.length-1}})};
 ws['!rows']=[{hpt:30},...rows.map(row=>({hpt:Math.max(30,Math.min(300,15*Math.max(...row.map(v=>String(v??'').split('\n').length))))}))];
 XLSX.utils.book_append_sheet(book,ws,name);return ws;
}
function official(rows:PresenceRow[]){return rows.map((r,i)=>[i+1,r.lorryNo,r.partyName,r.material,r.netWeight,r.weighBridgeRef,r.erpGpNo,r.tallyRefNo,r.status]);}
export function exportTransactionWorkbook(main:PresenceRow[],date:string){
 const wb=XLSX.utils.book_new();
 sheet(wb,'Main',HEADERS,official(main));
 for(const c of CATEGORIES){const rows=main.filter(r=>r.status===c);const ws=sheet(wb,c,HEADERS,official(rows));if(!rows.length)XLSX.utils.sheet_add_aoa(ws,[[`No entries classified as ${c}.`]],{origin:'A3'});}
 sheet(wb,'Summary',['Category','Weighments','Matching with Tally','Not found in uploaded Tally'],[...CATEGORIES.map(c=>{const rows=main.filter(r=>r.status===c);return[c,rows.length,rows.filter(r=>r.evidence.length).length,rows.filter(r=>!r.evidence.length).length]}),['Total',main.length,main.filter(r=>r.evidence.length).length,main.filter(r=>!r.evidence.length).length]]);
 sheet(wb,'Tally Check',['Weighment Ref','Vehicle','Category','Tally check','Match basis','Gate Supplier / Customer','Tally Particulars','Vch No.','Gate check','Notes'],main.map(r=>[r.weighBridgeRef,r.lorryNo,r.status,r.tallyState,r.basis,r.gateParties.join('\n'),r.tallyParticulars.join('\n'),r.tallyRefNo,r.erpState,r.notes.join('\n')]));
 const evidence:NameEvidence[]=main.flatMap(r=>r.evidence);
 sheet(wb,'Name Evidence',['Weighment Ref','Vehicle','Category','Name source','Supplier / Customer searched','Tally Particulars','Name verification','Evidence basis','Vch Type','Vch No.','Voucher date','Tally company','Matched PO / SO','Supplier invoice','Register quantity (source unit)','Weighment kg','Voucher details','Source rows'],evidence.map(e=>[e.weighmentRef,e.vehicle,e.category,e.nameSource,e.searchedName,e.tallyParticulars,e.nameVerification,e.basis,e.voucherType,e.voucherNo,e.voucherDate,e.company,e.matchedOrders.join('\n'),e.supplierInvoice,e.registerQuantity,e.weighmentKg,e.details.join('\n'),e.sources.map(sourceLabel).join('\n')]));
 sheet(wb,'Gate Mapping',['Weighment Ref','Vehicle','Weighment Party','Gate Pass','Direction','Gate date','Gate Supplier / Customer','Gate material','PO / SO','Invoice','Candidate treatment','Source'],main.flatMap(r=>r.candidates.map(g=>[r.weighBridgeRef,r.lorryNo,r.partyName,g.gp,g.direction,g.date,g.party,g.material,g.order,g.invoice,g.disposition,sourceLabel(g.source)])));
 sheet(wb,'Not Found',['Weighment Ref','Vehicle','Party','Material','Category','Names searched','PO / SO searched','Gate check','Tally check'],main.filter(r=>!r.evidence.length).map(r=>[r.weighBridgeRef,r.lorryNo,r.partyName,r.material,r.status,[...new Set([r.partyName,...r.gateParties])].join('\n'),[...new Set(r.candidates.filter(g=>g.selected).map(g=>g.order).filter(Boolean))].join('\n'),r.erpState,r.tallyState]));
 sheet(wb,'Notes',['Topic','Explanation'],[
  ['Operational date',date],['Matching with Tally','A supplier/customer name match or full PO/SO reference match counts as Tally presence. Listed voucher numbers may be name-only evidence; they do not certify the delivery booking or quantity.'],
  ['Sources','All recognizable Day Book and supporting-register sheets in the uploaded workbook are searched, including voucher Particulars lines. Voucher company, date and source row are retained.'],
  ['Categories','Only Purchase, Sales, Others and Job Work. Firewood, water, store material, gunny and inner shifts are Others. SOYABARI / JWBARI stays Sales. Explicit configured job-work references identify Job Work.'],
  ['Gate candidates','Vehicle first, then material, party and operational date ± configured days. Same-day compatible candidates are preferred. Multiple candidates and shared Gate records are not allocated by row order.'],
  ['Name differences','Formatting and common suffixes are normalized. Exact, similar and configured-alias names are identified in Name Evidence. Similar names can refer to different branches; inspect the preserved original names and companies.'],
  ['Date scope','Name presence searches every actual voucher date in the uploaded Tally file. Other-date findings remain labelled as such. Not found means not found in this upload, not necessarily missing from live Tally.'],
  ['Repeated vouchers','Duplicate appearances of the same company/date/type/number/party voucher are consolidated. A name-level voucher can support several movements and is not allocated exclusively.'],
  ['Missing references','Unresolved ERP GP fields and absent Tally reference fields remain blank. Tally Check and Gate Mapping explain them.'],
  ['Weighment population','Every parsed physical row is retained. Duplicate source serial numbers are flagged rather than discarded. Source Control and original row locations remain in the application response.']
 ]);
 return wb;
}
