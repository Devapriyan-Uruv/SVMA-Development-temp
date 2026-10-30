// Sales GST split. The Sales Register carries the invoice's combined tax
// (TaxAmount) but its own CGST/SGST/IGST columns are not reliable for
// inter-state invoices (they still show CGST/SGST and a meaningless IGST), so the
// split is derived: intra-state (Tamil Nadu) = CGST + SGST (half each), inter-state
// = IGST. The customer's place decides it. Checked against the ERP's own
// Sale Order GST split on 291 of 291 invoices that have one.

const NON_TN = /\b(PALAKKAD|PALAKAD|THRISSUR|TRISSUR|ERNAKULAM|ERNAKULUM|COCHIN|KOCHI|ALUVA|KOLLAM|KANJIKODE|THIRUVANANTHAPURAM|THIRUVANANDHAPURAM|TRIVANDRUM|CALICUT|KOZHIKODE|KOTTAYAM|KANNUR|ALAPPUZHA|MALAPPURAM|KERALA|BENGALURU|BANGALORE|BANGLORE|RAMANAGARA|TUMKUR|RAJANKUNTE|MYSORE|HUBLI|KARNATAKA|HYDERABAD|TELANGANA|TIRUPATI|CHITTOOR|NELLORE|VIJAYAWADA|GUNTUR|ANDHRA|HARYANA|MAHARASHTRA|PUNE|MUMBAI|GUJARAT|PUNJAB|DELHI|RAJASTHAN|ODISHA|WEST BENGAL|KOLKATA|MADHYA PRADESH|UTTAR PRADESH|BIHAR)\b/i;

export function isInterState(place: string | null | undefined): boolean {
  return NON_TN.test(String(place || ''));
}

const r2 = (n: number) => Number(n.toFixed(2));

export function splitGst(tax: number | null | undefined, place: string | null | undefined): { cgst: number; sgst: number; igst: number; interState: boolean } | null {
  if (tax == null || !Number.isFinite(tax)) return null;
  if (isInterState(place)) return { cgst: 0, sgst: 0, igst: r2(tax), interState: true };
  const half = r2(tax / 2);
  return { cgst: half, sgst: r2(tax - half), igst: 0, interState: false };
}
