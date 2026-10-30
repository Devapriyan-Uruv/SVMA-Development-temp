import type { DayBookVoucher } from '@/lib/outstanding/engine';
import { FOREIGN_NAME } from '@/lib/outstanding/engine';
import { isGroupName as isGroupParty } from './group';
import { isFirewoodVoucher, type Row } from './build';

// Loads Summary: the management "number of loads" sheet (SVMA_AGRO.xlsx — Purchase / Purchase D.C. / Sales / Sales D.C. / Others) for one
// day. Tally supplies the bills and amounts; the ERP supplies the loads: the day's purchase receipts (Purchase Details report), the Sales
// Register invoices and, for items that never get a receipt (water, store material), the gate weighments. Whatever fits no template
// line is listed under Others. Pure: the Tally vouchers, the ERP records of the day and the pending-order counts are passed in.

/** One ERP load: a purchase receipt (IN), a sales invoice (OUT) or a gate weighment. `gate` is its reference (RN no, invoice no or gate pass). */
export type ErpWeighment = { gate: string; direction: string; product: string; party: string; po: string; so: string; remarks: string };
export type ErpDay = { receipts: ErpWeighment[]; invoices: ErpWeighment[]; weighments: ErpWeighment[] };
export type ErpPending = { salesOrders: number; purchaseOrders: number };
export type LoadsSummary = {
  date: string;
  /** False when the ERP has no records for this day: loads then fall back to the Tally voucher count. */
  erpAvailable: boolean; erpLoads: number;
  purchase: Row[]; purchaseDc: Row[]; sales: Row[]; salesDc: Row[]; others: Row[];
  totals: { purchase: number; purchaseDc: number; sales: number; salesDc: number; others: number };
  /** Every Tally bill counted once, by where it landed: template lines, D.C. lines or Others (purchase side and sales side). Ties to the Purchases / Sales sheets. */
  tie: { purchase: Record<'lines' | 'dc' | 'others', { n: number; amount: number }>; sales: Record<'lines' | 'dc' | 'others', { n: number; amount: number }> };
  notes: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const low = (s: unknown) => String(s ?? '').toLowerCase();
const key = (s: string) => low(s).replace(/[^a-z0-9]/g, '');

/** The three suppliers Rice Bran is bought from directly (everyone else is indirect). Exact names: "Sri Ulaganayagi Amman Traders" is not Sri Amman Traders. */
export const isDirectRiceBranSupplier = (name: string) => { const k = key(name); return /^sriammantraders/.test(k) || /^mmricemill/.test(k) || /^srithiruch[ae]ndurmurugan/.test(k); };

type Acc = { tn: number; ta: number; en: number; parties: Set<string>; products: Set<string>; ledgers: Set<string> };
type Def = { id: string; no: string; name: string; split?: 'dir' | 'ori' | 'edi'; note?: string };

const PURCHASE: Def[] = [
  { id: 'ricebran', no: '1', name: 'Rice Bran', split: 'dir' }, { id: 'copra', no: '2', name: 'Copra (coconut oil cake)', split: 'ori' }, { id: 'pk', no: '3', name: 'Palm Kernel', split: 'ori' },
  { id: 'pkoil', no: '4', name: 'Palm Kernel Crude Oil', split: 'ori' }, { id: 'salseed', no: '5', name: 'Sal Seed' }, { id: 'mangoseed', no: '6', name: 'Mango Seed' },
  { id: 'soya', no: '7', name: 'Soya Bean (Import)' }, { id: 'mangodoc', no: '8', name: 'Mango DOC Nice' }, { id: 'shea', no: '9', name: 'Shea Cake' },
  { id: 'rbcured', no: '10', name: 'Rice Bran Cured Oil' }, { id: 'copradoc', no: '11', name: 'Copra DOC' }, { id: 'gunny', no: '12', name: 'Gunny' },
  { id: 'store', no: '13', name: 'Store Material', note: 'Tally counts bills; the ERP counts loads' }, { id: 'civil', no: '14', name: 'Civil Material', note: 'Tally counts bills; the ERP counts loads' },
  { id: 'water', no: '15', name: 'Water' }, { id: 'rowater', no: '16', name: 'RO Water' }, { id: 'fw', no: '17', name: 'Firewood' },
];
const PURCHASE_DC: Def[] = [
  { id: 'dc_flour', no: 'i', name: 'Soya TVP Flour (from Soya)' }, { id: 'dc_maxi', no: 'ii–vi', name: 'Maxi Choc / Kote / Fill / Cream / Coat (from Maxi Bio)' },
  { id: 'dc_pkoil', no: 'vii', name: 'Palm Kernel Crude Oil (from Maxi Bio)' }, { id: 'dc_olein', no: 'viii', name: 'Refined Palm Kernel Olein (from Maxi Bio)' },
  { id: 'dc_fatty', no: 'ix', name: 'Palm Kernel Fatty Oil (from Maxi Bio)' }, { id: 'dc_acid', no: 'x', name: 'Acid Oil (from Maxi Bio)' },
];
const SALES: Def[] = [
  { id: 'dorb', no: '1', name: 'De-oiled Rice Bran' }, { id: 'rbo', no: '2', name: 'Refined Rice Bran Oil', note: 'Tally has one Rice Bran Oil ledger for refined and crude' }, { id: 'rbcrude', no: '3', name: 'Rice Bran Crude Oil' },
  { id: 'wax', no: '4', name: 'Rice Bran Wax' }, { id: 'gum', no: '5', name: 'Rice Bran Gum' }, { id: 'earth', no: '6', name: 'Spent Earth Powder' },
  { id: 'coc_doc', no: '7a', name: 'Coconut DOC' }, { id: 'copracake', no: '7b', name: 'Copra Cake (coconut cake)' }, { id: 'coc_edible', no: '8', name: 'Coconut Edible Oil' }, { id: 'coc_non', no: '9', name: 'Coconut Non-Edible / Crude Oil' },
  { id: 'pkdoc', no: '10', name: 'De-oiled Palm Kernel (PK Chips / PK Nice)' }, { id: 'pkoil', no: '11/19', name: 'Palm Kernel Crude Oil' }, { id: 'pkshell', no: '12', name: 'Palm Kernel Shell' },
  { id: 'soya', no: '13', name: 'Soya Bean' }, { id: 'maxi', no: '14–18', name: 'Maxi Choc / Coat / Kote / Fill / Cream (CBS)' }, { id: 'olein', no: '20', name: 'Refined Palm Kernel Olein' },
  { id: 'fatty', no: '21', name: 'Palm Kernel Fatty Oil' }, { id: 'acid', no: '22', name: 'Acid Oil' }, { id: 'refcoc', no: '23', name: 'Refined Coconut Oil' },
  { id: 'salseed', no: '24', name: 'Sal Seed' }, { id: 'mangoseed', no: '25', name: 'Mango Seed' }, { id: 'shea', no: '26', name: 'Shea Cake' },
  { id: 'gunny', no: '27', name: 'Gunny Sales' }, { id: 'scrap', no: '28', name: 'Scrap Sales' },
];
const SALES_DC: Def[] = [
  { id: 'dc_bari', no: '2–9', name: 'Soya Bari (all sizes, flakes, granules) — to Soya Foods' }, { id: 'dc_flour', no: '8', name: 'Soya TVP Flour (job work)' },
  { id: 'dc_waste', no: '9', name: 'Soya Bari Waste' }, { id: 'dc_pkoil', no: '1', name: 'Palm Kernel Crude Oil (to Maxi Bio)' },
];
const OTHERS: Def[] = [
  { id: 'fwsales', no: '', name: 'Firewood sales' }, { id: 'jwrb', no: '', name: 'Job work (rice bran)' }, { id: 'rodtep', no: '', name: 'RODTEP and other incentives' },
  { id: 'services', no: '', name: 'Service / expense bills (freight, fees, charges — not loads)' },
  { id: 'inner', no: '', name: 'Inner shifting' }, { id: 'container', no: '', name: '40-foot containers' }, { id: 'outer', no: '', name: 'Outer godown loads' },
  { id: 'tuticorin', no: '', name: 'Direct sale from Tuticorin' }, { id: 'export', no: '', name: 'Export sales' },
];

const inText = (re: RegExp, ...xs: unknown[]) => re.test(xs.map(low).join(' | '));
const DC_PRODUCT_PURCHASE: [string, RegExp][] = [['dc_flour', /flour|tvp/], ['dc_maxi', /maxi|\bcbs\b/], ['dc_olein', /olein/], ['dc_fatty', /fatty/], ['dc_acid', /acid oil/], ['dc_pkoil', /palm ?kernal?.*(crude|oil)/]];

/** Which purchase line a ledger / product text belongs to; `group` = the other side is a group company, `dcOrder` = the ERP order is a job-work / flour order. */
function purchaseLine(s: string, group: boolean, dcOrder: boolean): string | null {
  if (/fire ?wood/.test(s)) return 'fw';
  if (/broken/.test(s)) return 'ricebran';
  if (group || dcOrder) for (const [id, re] of DC_PRODUCT_PURCHASE) if (re.test(s) && !(id === 'dc_pkoil' && !group)) return id;
  if (/mango ?doc/.test(s)) return 'mangodoc';
  if (/mango ?seed/.test(s)) return 'mangoseed';
  if (/sal ?seed/.test(s)) return 'salseed';
  if (/shea|sheia/.test(s)) return 'shea';
  if (/rice ?bran ?oil|cured/.test(s)) return 'rbcured';
  if ((/rice ?bran|ricebran/.test(s) && !/fatty|wax|gum|doc|dorb|de.?oiled|oil/.test(s)) || /raw ?rose/.test(s)) return 'ricebran';
  if (/palm ?kernal?.*(oil|crude)|pk crude/.test(s)) return 'pkoil';
  if (/palm ?kernal?|\bpk\b/.test(s)) return 'pk';
  if (/copra|coconut (oil )?cake|coconut cake/.test(s)) return 'copra';
  if (/soya ?doc/.test(s)) return null;
  if (/\bdoc\b/.test(s)) return 'copradoc';
  if (/soya ?beans?/.test(s) && !/oil|bari|flour/.test(s)) return 'soya';
  if (/gunny|jute|stitched|plastic (big|small)/.test(s)) return 'gunny';
  if (/\bro ?water\b/.test(s)) return 'rowater';
  if (/\bwater\b/.test(s) && !/tanker|expenses/.test(s)) return 'water';
  if (/civil|building|cement/.test(s)) return 'civil';
  if (/store ?material|stores|diesel|chemical|hexane|packing|polythene|\bsalt\b|spare|lam pp|woven|liner|maintenance|machinery|boiler|\betp\b|electrical|printing|stationery|computer|generator|\blab\b|plant & machinery|mobile|postage|courier/.test(s)) return 'store';
  return null;
}

function salesLine(s: string, group: boolean, jow: boolean, jwbari: boolean): string | null {
  if (/fire ?wood/.test(s)) return 'fwsales';
  if (/bari waste|basi waste|waste/.test(s) && /bari|basi/.test(s)) return 'dc_waste';
  if (jwbari || /bari/.test(s)) return 'dc_bari';
  if (/job ?work/.test(s) && /rice ?bran/.test(s)) return 'jwrb';
  if (/job ?work|flour|tvp/.test(s)) return 'dc_flour';
  if (group && jow && /palm ?kernal?.*(oil|crude)|palm ?kernal oil/.test(s)) return 'dc_pkoil';
  if (/rodtep|incentive/.test(s)) return 'rodtep';
  if (/maxi|\bcbs\b/.test(s)) return 'maxi';
  if (/wax/.test(s)) return 'wax';
  if (/\bgum\b/.test(s)) return 'gum';
  if (/earth/.test(s)) return 'earth';
  if (/refined coconut/.test(s)) return 'refcoc';
  if (/coconut.*(crude|non.?edible)/.test(s)) return 'coc_non';
  if (/coconut (edible )?oil|coconut oil/.test(s)) return 'coc_edible';
  if (/coconut cake|copra/.test(s) && !/palm/.test(s)) return 'copracake';
  if (/\bdoc\b|doc edible/.test(s) && !/palm/.test(s)) return 'coc_doc';
  if (/olein/.test(s)) return 'olein';
  if (/fatty/.test(s) && !/rice/.test(s)) return 'fatty';
  if (/acid oil/.test(s)) return 'acid';
  if (/rice ?bran.*crude|crude.*rice ?bran/.test(s)) return 'rbcrude';
  if (/rice ?bran ?oil|refined rice/.test(s)) return 'rbo';
  if (/de.?oiled rice|dorb|\bdob\b|rice ?bran/.test(s) && !/fatty/.test(s)) return 'dorb';
  if (/palm ?kernal?.*(cake|grind|chips|nice|doc)|pk (chips|nice)|de.?oiled palm|palmkernal-grind/.test(s)) return 'pkdoc';
  if (/shell/.test(s)) return 'pkshell';
  if (/palm ?kernal?.*oil|palm ?kernal oil/.test(s)) return 'pkoil';
  if (/soya ?beans?/.test(s)) return 'soya';
  if (/sal ?seed/.test(s)) return 'salseed';
  if (/mango ?seed/.test(s)) return 'mangoseed';
  if (/shea|sheia/.test(s)) return 'shea';
  if (/gunny/.test(s)) return 'gunny';
  if (/scrap/.test(s)) return 'scrap';
  return null;
}

const SERVICE = /freight|lorry|transport|charges|fees|insurance|survey|clearing|liner|\bcfs\b|brokerage|commission|testing|travelling|advertisement|courier|professional|stevedoring|warehouse/i;
const GST_LINE = /sgst|cgst|igst|round|tds|tcs|input|freight outwards|discount|packing/i;
const ledgerOf = (v: DayBookVoucher) => v.lines.slice(1).find(l => !GST_LINE.test(l.name) && (l.dr || l.cr))?.name ?? v.lines[0]?.name ?? '';

const NON_RECEIPT = new Set(['water', 'rowater', 'store', 'civil', 'gunny']);
const FAMILY = [['pkoil', 'olein', 'fatty', 'acid'], ['coc_doc', 'copracake', 'pkdoc'], ['rbo', 'rbcrude']];
const sigTokens = (s: string) => new Set(low(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !/^(pvt|ltd|private|limited|traders|trading|agency|company|the|and)$/.test(t)));
const sameParty = (a: string, b: string) => { const x = sigTokens(a), y = sigTokens(b); if (!x.size || !y.size) return false; let c = 0; for (const t of x) if (y.has(t)) c++; return c / Math.min(x.size, y.size) >= 0.5; };

export function buildLoads(date: string, all: DayBookVoucher[], erpDay: ErpDay | null, pending: ErpPending | null): LoadsSummary {
  const V = all.filter(v => v.date === date);
  // The ERP loads of the day: receipts for purchases (plus gate weighments for items that never get a receipt) and the Sales Register for sales;
  // gate weighments stand in only when a day has no receipts / invoices loaded.
  const weighIn = (erpDay?.weighments ?? []).filter(w => /^in/i.test(w.direction)), weighOut = (erpDay?.weighments ?? []).filter(w => !/^in/i.test(w.direction));
  const weighments: ErpWeighment[] = erpDay ? [
    ...(erpDay.receipts.length ? [...erpDay.receipts, ...weighIn.filter(w => NON_RECEIPT.has(purchaseLine(low(w.product), isGroupParty(w.party), false) ?? ''))] : weighIn),
    ...(erpDay.invoices.length ? erpDay.invoices : weighOut),
  ] : [];
  const erpAvailable = weighments.length > 0;
  const bins = { P: new Map<string, Acc>(), PDC: new Map<string, Acc>(), S: new Map<string, Acc>(), SDC: new Map<string, Acc>(), O: new Map<string, Acc>() };
  const acc = (m: Map<string, Acc>, k: string) => m.get(k) || m.set(k, { tn: 0, ta: 0, en: 0, parties: new Set(), products: new Set(), ledgers: new Set() }).get(k)!;
  const zero = () => ({ lines: { n: 0, amount: 0 }, dc: { n: 0, amount: 0 }, others: { n: 0, amount: 0 } });
  const tie = { purchase: zero(), sales: zero() };
  const tied = (side: 'P' | 'S', where: 'lines' | 'dc' | 'others', amount: number) => { const t = tie[side === 'P' ? 'purchase' : 'sales'][where]; t.n++; t.amount = r2(t.amount + amount); };
  const unmapped = { tally: new Map<string, Acc>(), erp: new Map<string, Acc>() };
  const sub = (id: string, split: Def['split'], party: string, text: string, imported: boolean) => split === 'dir' ? `${id}|${isDirectRiceBranSupplier(party) ? 'Direct' : 'Indirect'}` : split === 'ori' ? `${id}|${imported ? 'Import' : 'Local'}` : id;

  const put = (side: 'P' | 'S', dc: boolean, id: string, party: string, text: string, imported: boolean, isTally: boolean, amount: number) => {
    const defs = side === 'P' ? (dc ? PURCHASE_DC : PURCHASE) : (dc ? SALES_DC : SALES);
    const def = defs.find(d => d.id === id);
    const bin = id in { fwsales: 1, jwrb: 1, rodtep: 1, services: 1 } ? bins.O : bins[side === 'P' ? (dc ? 'PDC' : 'P') : (dc ? 'SDC' : 'S')];
    const a = acc(bin, def ? sub(id, def.split, party, text, imported) : id);
    if (isTally) { a.tn++; a.ta = r2(a.ta + amount); if (text) a.ledgers.add(text.slice(0, 40)); tied(side, bin === bins.O ? 'others' : dc ? 'dc' : 'lines', amount); } else a.en++;
    if (party) a.parties.add(party.slice(0, 26)); if (!isTally && text) a.products.add(text.slice(0, 40));
  };
  const leftover = (m: Map<string, Acc>, k: string, party: string, amount: number, isTally: boolean, side: 'P' | 'S' = 'P') => { const a = acc(m, k); if (isTally) { a.tn++; a.ta = r2(a.ta + amount); tied(side, 'others', amount); } else a.en++; if (party) a.parties.add(party.slice(0, 26)); };
  const movement = (text: string, party: string, amount: number, isTally: boolean, side: 'P' | 'S' = 'P') => {
    const t = low(text);
    const id = /inner ?shift|shifting/.test(t) ? 'inner' : /outer ?godown/.test(t) ? 'outer' : /40 ?(ft|feet|foot)|container/.test(t) ? 'container' : null;
    if (id) { const a = acc(bins.O, id); if (isTally) { a.tn++; a.ta = r2(a.ta + amount); tied(side, 'others', amount); } else a.en++; if (party) a.parties.add(party.slice(0, 26)); return true; }
    return false;
  };

  // ---- ERP: the day's loads (done first: it tells which product a Tally sale is when the Tally ledger is ambiguous) --------------------------------------------------------------------------------
  const seenGate = new Set<string>();
  const erpSales: { party: string; id: string }[] = [];
  for (const w of weighments ?? []) {
    const gk = w.gate ? `${w.gate}|${w.direction}` : ''; if (gk) { if (seenGate.has(gk)) continue; seenGate.add(gk); }
    const group = isGroupParty(w.party), dcPo = /^(jw|utf|jow)/i.test(w.po) || /^(jwbari|jow)/i.test(w.so), imported = /import/i.test(w.product) || FOREIGN_NAME.test(w.party);
    const text = low(w.product);
    if (movement(`${w.product} ${w.remarks}`, w.party, 0, false)) continue;
    if (/^in/i.test(w.direction)) {
      const id = purchaseLine(text, group, dcPo);
      const dc = !!id && id.startsWith('dc_');
      if (id) put('P', dc, id, w.party, w.product, imported, false, 0); else leftover(unmapped.erp, `Purchase (IN) — ${w.product}`, w.party, 0, false);
    } else {
      if (FOREIGN_NAME.test(w.party)) { const a = acc(bins.O, 'export'); a.en++; a.parties.add(w.party.slice(0, 26)); continue; }
      const id = salesLine(text, group, /^jow/i.test(w.so), /^jwbari/i.test(w.so));
      const dc = !!id && id.startsWith('dc_');
      if (id) { erpSales.push({ party: w.party, id }); put('S', dc, id, w.party, w.product, false, false, 0); } else leftover(unmapped.erp, `Sales (OUT) — ${w.product}`, w.party, 0, false);
    }
  }

  // ---- Tally: purchase and sales bills (orders only where they stand for a D.C. load) ----------------------------------------------
  for (const v of V) {
    const t = v.vchType.trim(), h = v.lines[0], party = h?.name ?? '', led = ledgerOf(v), nar = v.narration.join(' ');
    const isP = /^purchase/i.test(t), isS = /^sales/i.test(t);
    // Orders are not bills: they sit on the Orders sheet and are never counted as purchases or sales.
    if ((!isP && !isS) || /order/i.test(t)) continue;
    const amount = isP ? (h?.cr ?? 0) : (h?.dr ?? 0), group = isGroupParty(party), imported = /import/i.test(led) || FOREIGN_NAME.test(party);
    if (movement(`${led} ${nar}`, party, amount, true, isP ? 'P' : 'S')) continue;
    const fw = isFirewoodVoucher(v);
    if (isP) {
      const service = SERVICE.test(led) && !/^purchase/i.test(led);
      const id = fw ? 'fw' : service ? null : (purchaseLine(low(led), group, false) ?? purchaseLine(low(t), group, false));
      const dc = !!id && id.startsWith('dc_');
      if (id) put('P', dc, id, party, led, imported, true, amount);
      else if (!service && (/ERP\s*$/i.test(t) || /goods|bran|oil|doc|cake/i.test(t))) leftover(unmapped.tally, `Purchase — ${led || t}`, party, amount, true, 'P');
      else put('P', false, 'services', party, led, false, true, amount);
    } else {
      let id = fw ? 'fwsales' : salesLine(low(led), group, /^jow/i.test(v.vchNo), false);
      // One Tally ledger often covers several products (Palm Kernel Oil = crude or olein, "Doc" = coconut DOC or palm kernel DOC): the ERP invoice of the same customer says which.
      const fam = id ? FAMILY.find(f => f.includes(id!)) : undefined;
      if (id && fam) { const c = new Set(erpSales.filter(e => fam.includes(e.id) && sameParty(e.party, party)).map(e => e.id)); if (c.size === 1) id = [...c][0]; }
      const dc = !!id && id.startsWith('dc_');
      if (!fw && (/export/i.test(led) || FOREIGN_NAME.test(party))) { const a = acc(bins.O, 'export'); a.tn++; a.ta = r2(a.ta + amount); a.parties.add(party.slice(0, 26)); tied('S', 'others', amount); continue; }
      if (!fw && /tuticorin|tuti\b/i.test(party)) { const a = acc(bins.O, 'tuticorin'); a.tn++; a.ta = r2(a.ta + amount); a.parties.add(party.slice(0, 26)); tied('S', 'others', amount); continue; }
      if (id) put('S', dc, id, party, led, false, true, amount);
      else leftover(unmapped.tally, `Sales — ${led || t}`, party, amount, true, 'S');
    }
  }

  // ---- rows --------------------------------------------------------------------------------------------------------------------------
  const loadsOf = (a: Acc) => erpAvailable ? a.en : a.tn;
  const check = (a: Acc, kind?: 'bills' | 'dc') => !erpAvailable ? 'ERP records not loaded for this day — Tally count shown' : a.tn === a.en ? 'Tally and ERP agree' : kind === 'bills' ? 'Bills and loads are counted differently (not expected to match)' : a.en === 0 ? 'In Tally, no ERP load' : a.tn === 0 ? (kind === 'dc' ? 'D.C. load — no invoice in Tally (Tally holds an order at most)' : 'In the ERP, no Tally bill') : `Tally ${a.tn} vs ERP ${a.en}`;
  const mk = (defs: Def[], m: Map<string, Acc>, totalLabel: string, dc = false): { rows: Row[]; total: number } => {
    const rows: Row[] = []; let total = 0, tn = 0, ta = 0, en = 0;
    for (const d of defs) {
      const keys = d.split === 'dir' ? ['Direct', 'Indirect'] : d.split === 'ori' ? ['Local', 'Import'] : [''];
      for (const k of keys) {
        const a = m.get(k ? `${d.id}|${k}` : d.id) ?? { tn: 0, ta: 0, en: 0, parties: new Set<string>(), products: new Set<string>(), ledgers: new Set<string>() };
        const l = loadsOf(a); total += l; tn += a.tn; ta += a.ta; en += a.en;
        rows.push({ 'S.No': d.no, Particulars: d.name + (k ? ` — ${k}` : ''), 'From / parties': [...a.parties].slice(0, 3).join('; ') + (a.parties.size > 3 ? ` +${a.parties.size - 3}` : ''), 'Tally bills': a.tn, 'Tally amount': a.ta, 'ERP loads': a.en, 'No. of loads': l, Check: !a.tn && !a.en ? '—' : d.note && a.tn !== a.en ? d.note : check(a, dc ? 'dc' : /store|civil|water|gunny/.test(d.id) ? 'bills' : undefined) });
      }
    }
    rows.push({ 'S.No': '', Particulars: totalLabel, 'From / parties': '', 'Tally bills': tn, 'Tally amount': r2(ta), 'ERP loads': en, 'No. of loads': total, Check: '' });
    return { rows, total };
  };
  const P = mk(PURCHASE, bins.P, 'TOTAL PURCHASE'), PD = mk(PURCHASE_DC, bins.PDC, 'TOTAL PURCHASE D.C.', true), S = mk(SALES, bins.S, 'TOTAL SALES'), SD = mk(SALES_DC, bins.SDC, 'TOTAL SALES D.C.', true);

  const orows: Row[] = []; let oTotal = 0;
  const oRow = (name: string, a: Acc | undefined, note: string) => { const x = a ?? { tn: 0, ta: 0, en: 0, parties: new Set<string>(), products: new Set<string>(), ledgers: new Set<string>() }; const l = loadsOf(x); oTotal += l; orows.push({ 'S.No': '', Particulars: name, 'From / parties': [...x.parties].slice(0, 3).join('; '), 'Tally bills': x.tn, 'Tally amount': x.ta, 'ERP loads': x.en, 'No. of loads': l, Check: !x.tn && !x.en ? note : check(x) }); };
  for (const d of OTHERS) oRow(d.name, bins.O.get(d.id), /inner|container|outer|tuticorin|export/.test(d.id) ? 'None found — not recorded in Tally or the ERP data' : '—');
  for (const [k, a] of [...unmapped.tally, ...unmapped.erp].sort((x, y) => x[0].localeCompare(y[0]))) oRow(`Not in the template — ${k}`, a, '—');
  if (pending) {
    orows.push({ 'S.No': '', Particulars: 'Pending: sales orders open / partly completed in the ERP (as of the last ERP upload)', 'From / parties': '', 'Tally bills': '', 'Tally amount': '', 'ERP loads': '', 'No. of loads': pending.salesOrders, Check: 'Orders, not loads — not added to the totals' });
    orows.push({ 'S.No': '', Particulars: 'Pending: purchase orders with quantity still to receive in the ERP (as of the last ERP upload)', 'From / parties': '', 'Tally bills': '', 'Tally amount': '', 'ERP loads': '', 'No. of loads': pending.purchaseOrders, Check: 'Orders, not loads — not added to the totals' });
  }
  orows.push({ 'S.No': '', Particulars: 'TOTAL OTHERS', 'From / parties': '', 'Tally bills': orows.reduce((s, r) => s + (Number(r['Tally bills']) || 0), 0), 'Tally amount': r2(orows.reduce((s, r) => s + (Number(r['Tally amount']) || 0), 0)), 'ERP loads': orows.reduce((s, r) => s + (Number(r['ERP loads']) || 0), 0), 'No. of loads': oTotal, Check: '' });

  const notes = [
    erpAvailable ? `Loads are the ERP's own records of the day (${seenGate.size || weighments.length}): purchase receipts, Sales Register invoices and, for water / store material / civil / gunny, gate weighments. Tally bills are shown beside them.` : 'The ERP has no records for this day, so loads are the Tally voucher counts.',
    'Rice Bran is Direct only for Sri Amman Traders, M.M. Rice Mill (Salem) and Sri Thiruchendur Murugan Traders; every other supplier is Indirect.',
    'Order vouchers are not bills and are not counted; they are on the Orders sheet.',
    'Inner shifting, 40-foot containers, outer godown, direct sale from Tuticorin and export are not recorded in Tally or the ERP data; anything found by name is listed under Others.',
  ];
  return { date, erpAvailable, erpLoads: seenGate.size || weighments.length, purchase: P.rows, purchaseDc: PD.rows, sales: S.rows, salesDc: SD.rows, others: orows, totals: { purchase: P.total, purchaseDc: PD.total, sales: S.total, salesDc: SD.total, others: oTotal }, tie, notes };
}
