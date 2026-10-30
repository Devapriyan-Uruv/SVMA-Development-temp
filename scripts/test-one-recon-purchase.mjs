// One Reconciliation — purchase / indirect feedback fixes. Pure logic only (no database, no files):
//   exact Tally keys, weight-based lot reassignment, unlinked records, shorthand product from the lot's own record.
// Run: node scripts/test-one-recon-purchase.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root = process.cwd();
const out = fs.mkdtempSync(path.join(root, '.one-recon-test-'));
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
try {
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) emit(p); } };
  const emit = p => {
    const o = path.join(out, path.relative(root, p).replace(/\.tsx?$/, '.js')); fs.mkdirSync(path.dirname(o), { recursive: true });
    const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    fs.writeFileSync(o, js.replace(/require\("@\/([^"]+)"\)/g, (_, m) => `require(${JSON.stringify(path.join(out, m))})`));
  };
  walk(path.join(root, 'lib'));
  fs.writeFileSync(path.join(out, 'lib/aix3/provider.js'), 'exports.aix3Enabled=()=>false;exports.aix3Complete=async()=>{throw new Error("no AI")};exports.parseAix3Json=()=>null;');
  const req = createRequire(path.join(root, 'package.json'));
  const load = f => createRequire(path.join(out, 'x.js'))(path.join(out, 'lib/oneReconciliation', f));
  const { buildLedgerIndex } = load('tallyLedger.js');
  const { reassignByWeight } = load('reassign.js');
  const { findUnlinked } = load('unlinked.js');
  const { productFromLotRecord } = load('productMaster.js');
  void req;

  // ---- Tally: voucher number = ERP receipt no; New Ref carries the lot -------------------------------------------------
  const v = (key, vchNo, vchType, date, refs) => ({ key, file: 'f', sheet: 's', row: 1, date, party: 'P', vchType, vchNo, debit: null, credit: 1000, amount: 1000, refs });
  const led = buildLedgerIndex([
    v('a', 'RB-RN/1577/26-27', 'Purchase - Bran ERP', '2026-09-15', [{ kind: 'New Ref', ref: 'RB-RG1/091502/26-27/154', amount: 1000, drcr: 'Cr', row: 2 }]),
    v('b', '00991', 'Payment', '2026-09-20', [{ kind: 'Agst Ref', ref: 'RB-RG1/091502/26-27/154', amount: 1000, drcr: 'Dr', row: 4 }]),
  ]);
  check('voucher number indexes the booking', () => assert.equal(led.byVchNo.get('RB-RN/1577/26-27').length, 1));
  check('New Ref lot indexes only the booking, not the payment', () => assert.deepEqual(led.newRefByLot.get('RB-RG1/091502/26-27').map(p => p.voucher.key), ['a']));
  check('Day Book coverage is the first/last voucher date', () => assert.deepEqual(led.coverage, { from: '2026-09-15', to: '2026-09-20' }));

  // ---- Weekly water payments, single-date refs, old serial-only refs, water suppliers -----------------------------------
  const pv = (key, vchNo, vchType, date, party, refs, counter) => ({ key, file: 'f', sheet: 's', row: 1, date, party, vchType, vchNo, debit: 100, credit: null, amount: 100, refs, counter });
  const led2 = buildLedgerIndex([
    pv('w1', '06619', 'Payment', '2026-09-06', 'Nagaraj-Water', [{ kind: 'Agst Ref', ref: '29.08.26 to 04.09.26', amount: 18200, drcr: 'Dr', row: 2 }]),
    pv('w2', '07275', 'Payment', '2026-09-22', 'Yovan,Thamaraipadi', [{ kind: 'Agst Ref', ref: '23.09.26', amount: 18000, drcr: 'Dr', row: 3 }]),
    pv('w3', '99999', 'Payment', '2026-09-22', 'Bad Date', [{ kind: 'Agst Ref', ref: '45.19.26', amount: 1, drcr: 'Dr', row: 4 }]),
    pv('j1', '01721', 'Journal - Gen', '2026-09-14', 'Water Expenses', [], 'Yovan,Thamaraipadi'),
    pv('b1', 'RB-RN/1386/26-27', 'Purchase - Bran ERP', '2026-08-31', 'M.B.S.Traders', [{ kind: 'New Ref', ref: '090104/MBS/731/26-27', amount: 919588, drcr: 'Cr', row: 5 }]),
    pv('d1', 'DN/1190/26-27', 'Debit Note ERP', '2026-08-31', 'M.B.S.Traders', [{ kind: 'Agst Ref', ref: '090104/MBS/731/26-27', amount: 110615, drcr: 'Dr', row: 6 }]),
  ]);
  check('a date-range payment covers the dates inside it', () => { const r = led2.rangePayments.find(x => x.voucher.key === 'w1'); assert.deepEqual([r.from, r.to], ['2026-08-29', '2026-09-04']); });
  check('a single-date payment covers the week up to that date; an impossible date is ignored', () => { const r = led2.rangePayments.find(x => x.voucher.key === 'w2'); assert.deepEqual([r.from, r.to], ['2026-09-17', '2026-09-23']); assert.ok(!led2.rangePayments.some(x => x.voucher.key === 'w3')); });
  check('suppliers credited by Water Expenses journals are the water suppliers', () => assert.ok(led2.waterSuppliers.has('YOVAN,THAMARAIPADI')));
  check('old serial-only references (090104/MBS/731/26-27) are found by serial', () => assert.deepEqual(led2.bySerial.get('090104').map(p => p.voucher.key).sort(), ['b1', 'd1']));

  // ---- Same truck, lot swapped between two loads -----------------------------------------------------------------------
  const row = (reconId, vehicle, lot, erp, status, date = '2026-09-02') => ({
    reconId, transactionType: 'Indirect Purchase', primaryStatus: status, statuses: [status], product: { matchMethod: 'category', masterProductType: 'raw_material' },
    v: { vehicle, date, lot, party: 'X', netWeight: 0, erpReference: erp, erpQuantity: 0, bagWeightKg: 0, tallyVoucherNo: 'Not Found', dataQuality: 'OK', aiComment: '' }, audit: [],
  });
  const rc = (rnNo, lotNo, weight, plasticBag = 0, jute = 0) => ({ rnNo, rnDate: '2026-09-02', poNo: '', lotNo, supplier: 'X', vehicle: 'TN02J2853', product: 'RICE BRAN', billNo: '', billRate: null, billQty: null, weight, billValue: null, juteBag: jute, plasticBag, totalBags: plasticBag + jute, prov: { origin: 'upload', file: 'f', sheet: 's', row: '1' } });
  const rows = [row('R1', 'TN02J2853', 'RB-G2/090210/26-27', 'RB-RN/1403', 'QUANTITY MISMATCH'), row('R2', 'TN02J2853', 'Not Found', 'Not Found', 'ERP MISSING')];
  const w = [{ id: 'w1', vehicle: 'TN02J2853', weight: 1055, date: '2026-09-02' }, { id: 'w2', vehicle: 'TN02J2853', weight: 14275, date: '2026-09-02' }];
  const receipts = [rc('RB-RN/1403', 'RB-G2/090210/26-27', 14.217, 290), rc('RB-RN/1404', 'BR/090211/26-27', 1.046, 45)];
  const re = reassignByWeight(rows, w, receipts);
  check('both swapped loads get the receipt that matches their weight', () => { assert.equal(re.get('w1').lotNo, 'BR/090211/26-27'); assert.equal(re.get('w2').lotNo, 'RB-G2/090210/26-27'); });
  check('a load that already agrees with its receipt is never reassigned', () => {
    const settledRows = [row('R1', 'TN02J2853', 'L1', 'RB-RN/1403', 'FULLY MATCHED')];
    assert.equal(reassignByWeight(settledRows, [w[1]], receipts).size, 0);
  });
  check('two receipts that fit equally are ambiguous and left alone', () => {
    const amb = reassignByWeight([row('R2', 'TN02J2853', 'Not Found', 'Not Found', 'ERP MISSING')], [w[0]], [rc('A', 'L-A/1', 1.046, 45), rc('B', 'L-B/1', 1.05, 45)]);
    assert.equal(amb.size, 0);
  });

  // ---- Unlinked records ----------------------------------------------------------------------------------------------------
  const linked = row('R1', 'TN02J2853', 'L1', 'RB-RN/1403', 'FULLY MATCHED'); linked.v.netWeight = 14275;
  const un = findUnlinked([linked], [rc('RB-RN/1403', 'L1', 14.2), rc('RB-RN/1999', 'L9', 5)], buildLedgerIndex([]), '2026-09-01', '2026-09-30');
  check('a receipt with no weighment is listed; a linked one is not', () => { assert.equal(un.length, 1); assert.equal(un[0].reference, 'RB-RN/1999'); });

  // ---- Product from the lot's own record -----------------------------------------------------------------------------------
  const index = { products: [{ id: 'p1', productCode: 'RB-G1', displayName: 'RICEBRAN-Grade I', category: 'RICE BRAN', productType: 'raw_material' }, { id: 'p2', productCode: 'FLR', displayName: 'Untosted Flour TPY', category: 'FLOUR', productType: 'raw_material' }], aliasByNormalized: new Map() };
  const pr = async () => {
    const a = await productFromLotRecord('BRAN', 'p1', '', index);
    const b = await productFromLotRecord('SOYA FLOUR', 'p2', '', index);
    return { a, b };
  };
  const { a, b } = await pr();
  check('"BRAN" is taken as the lot\'s RICE BRAN product', () => { assert.equal(a.masterProductName, 'RICEBRAN-Grade I'); assert.equal(a.matchMethod, 'lot_record'); });
  check('the ERP lot product is taken as the product of record even when the weighbridge text differs', () => { assert.equal(b.masterProductName, 'Untosted Flour TPY'); assert.equal(b.raw, 'SOYA FLOUR'); });

  console.log(`\n${passed} checks passed`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
