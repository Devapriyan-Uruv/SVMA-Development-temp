// Import contract alerts: the general steps from contract to settlement, driven by the contract's own dates. Pure — the sweep route supplies
// the facts and sends what this returns. `key` makes each notice fire once per contract and recipient (notifications.dedupe_key).
export type AlertFacts = {
  id: string; ref: string; supplier: string; status: string; createdAt: string;
  quantity: number | null; shipmentEnd: string | null; eta: string | null; delivery: string | null; settlementDue: string | null; settledAt: string | null;
  receivedTons: number; invoices: number; invoicesWithBoe: number; hasPurchaseVoucher: boolean | null;
};
export type Alert = { key: string; severity: 'info' | 'warning' | 'critical'; title: string; body: string };

const days = (iso: string | null, today: string) => (iso ? Math.round((Date.parse(iso) - Date.parse(today)) / 86400000) : null);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function contractAlerts(f: AlertFacts, today: string): Alert[] {
  const out: Alert[] = [], tag = `${f.ref} • ${f.supplier}`;
  const add = (key: string, severity: Alert['severity'], title: string, body: string) => out.push({ key, severity, title: `${title} • ${tag}`, body });
  const age = Math.floor((Date.parse(today) - Date.parse(f.createdAt.slice(0, 10))) / 86400000);

  // 1. Review — an extracted contract waiting to be confirmed.
  if (f.status !== 'Confirmed' && age >= 1) add('review', 'warning', 'CONTRACT AWAITING REVIEW', `The extracted contract has been waiting ${plural(age, 'day')} for review and confirmation.`);
  if (f.status !== 'Confirmed') return out;

  const settled = !!f.settledAt;
  const ship = days(f.shipmentEnd, today), eta = days(f.eta, today), del = days(f.delivery, today), due = days(f.settlementDue, today);
  const shortBy = f.quantity != null && f.quantity > 0 ? Math.max(0, f.quantity - f.receivedTons) : 0, short = f.quantity != null && shortBy > f.quantity * 0.005;

  // 2. Shipment window — until an ETA is recorded the goods are assumed not yet shipped.
  if (!settled && f.eta == null && ship != null) {
    if (ship < 0) add('ship_overdue', 'critical', 'SHIPMENT WINDOW PASSED', `The shipment period ended ${plural(-ship, 'day')} ago and no arrival date is recorded. Confirm the Bill of Lading with the supplier and enter the ETA.`);
    else if (ship <= 7) add('ship_t7', 'warning', 'SHIPMENT WINDOW CLOSING', `The shipment period ends in ${plural(ship, 'day')}. Confirm the shipping advice / Bill of Lading and enter the ETA.`);
  }
  // 3. Arrival — prepare, clear, file the Bill of Entry.
  if (!settled && eta != null) {
    if (eta <= 7 && eta > 2) add('eta_t7', 'info', 'VESSEL ARRIVING SOON', `Arrival in ${plural(eta, 'day')}. Brief the CHA and prepare the Bill of Entry documents (invoice, packing list, BL, certificates).`);
    if (eta <= 2 && eta >= 0) add('eta_t2', 'warning', eta === 0 ? 'ARRIVING TODAY' : 'ARRIVAL IN 2 DAYS', `${eta === 0 ? 'The shipment is due today' : `Arrival in ${plural(eta, 'day')}`}. File the Bill of Entry and keep duty funds ready to avoid demurrage.`);
    if (eta < 0 && f.invoicesWithBoe < Math.max(1, f.invoices)) add('boe_pending', 'critical', 'BILL OF ENTRY NOT RECORDED', `The shipment arrived ${plural(-eta, 'day')} ago but the Bill of Entry number is not recorded for every invoice. Port free days and demurrage may be running.`);
  }
  // 4. Delivery — contract date of delivery against what the ERP has received.
  if (!settled && del != null) {
    if (del >= 0 && del <= 3 && short) add('delivery_t3', 'info', 'DELIVERY DUE SOON', `Delivery is due in ${plural(del, 'day')}; ${f.receivedTons.toLocaleString('en-IN')} MT received so far, ${shortBy.toLocaleString('en-IN', { maximumFractionDigits: 3 })} MT to go.`);
    if (del < 0 && short) add('delivery_late', 'warning', 'DELIVERY PAST DUE', `The delivery date passed ${plural(-del, 'day')} ago and ${shortBy.toLocaleString('en-IN', { maximumFractionDigits: 3 })} MT of the contract quantity has not been received (${f.receivedTons.toLocaleString('en-IN')} MT in).`);
  }
  // 5. Settlement — payment to the supplier.
  if (!settled && due != null) {
    if (due < 0) add('settle_overdue', 'critical', 'SETTLEMENT OVERDUE', `Payment to the supplier was due ${plural(-due, 'day')} ago. Complete the settlement or clear the due date once settled.`);
    else if (due === 0) add('settle_due', 'critical', 'SETTLEMENT DUE TODAY', 'Payment to the supplier is due today.');
    else if (due <= 3) add('settle_t3', 'warning', 'SETTLEMENT DUE IN 3 DAYS', `Payment to the supplier is due in ${plural(due, 'day')}. Arrange the forex and funds.`);
    else if (due <= 7) add('settle_t7', 'info', 'SETTLEMENT DUE IN A WEEK', `Payment to the supplier is due in ${plural(due, 'day')}.`);
  }
  // 6. Sheet ready — everything needed to review the settlement is in.
  if (!settled && f.quantity != null && !short && f.receivedTons > 0 && f.invoices > 0 && f.invoicesWithBoe >= f.invoices && f.hasPurchaseVoucher !== false)
    add('sheet_ready', 'info', 'SETTLEMENT SHEET READY', 'The full quantity is received and every invoice has its Bill of Entry. Review the Settlement sheet and mark it settled.');
  return out;
}
