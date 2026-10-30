import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

// Usage receipt for URUV model credits, issued in the name of AIX3. It is a
// plain receipt — no invoice number, due date, bank details or signature.
// GST is the only thing added to the usage value.

import { GST_PCT } from '@/lib/aiUsage';
export const RECEIPT_GST_PCT = GST_PCT;

export type ReceiptLine = { description: string; credits: number; requests: number; amount: number };
export type ReceiptData = { periodLabel: string; from: string; to: string; lines: ReceiptLine[]; generatedOn: string };

const FROM = {
  name: 'AIX3',
  address: '494/9 Pandiyan Nagar, CAK Road, Karur, Tamil Nadu - 639001',
  gstin: '33CDBPC7914H1ZW',
  contact: 'karthikeyan@aix3.in  |  www.aix3.in',
};
const TO = {
  name: 'SVMA Agro Products P LTD',
  address: '273/1, Dindigul - Trichy Main Road, Moonandipatti, Velvarkottai, Dindigul, Tamil Nadu - 624380',
  gstin: '33AAICS1297C1ZI',
};

const NAVY = '#1F3A5F', INK = '#111827', MUTED = '#6B7280', LINE = '#E5E7EB', TINT = '#F3F4F6';
const root = process.cwd();
const FONT = path.join(root, 'assets', 'fonts', 'Inter_400Regular.ttf'), BOLD = path.join(root, 'assets', 'fonts', 'Inter_700Bold.ttf');

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const credits = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ /g, '-');

/** Line amounts are rounded to paise first and the totals are built from those
 * rounded lines, so every figure on the page adds up exactly. */
export function receiptTotals(lines: ReceiptLine[]) {
  const subtotal = r2(lines.reduce((s, l) => s + r2(l.amount), 0));
  const gst = r2(subtotal * RECEIPT_GST_PCT / 100);
  return { subtotal, gst, total: r2(subtotal + gst) };
}

export function buildUsageReceipt(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `AIX3 usage receipt - ${data.periodLabel || `${data.from} to ${data.to}`}`, Author: 'AIX3' } });
    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('Inter', FONT); doc.registerFont('Inter-Bold', BOLD);

    const L = 40, R = 555, W = R - L;
    // Header — white so the dark AIX3 logo keeps its contrast
    const logo = path.join(root, 'public', 'uruv_logo.png');
    if (fs.existsSync(logo)) { try { doc.image(logo, L, 40, { height: 34 }); } catch { /* logo is optional */ } }
    doc.fillColor(NAVY).font('Inter-Bold').fontSize(22).text('RECEIPT', L, 46, { width: W, align: 'right' });
    doc.rect(L, 84, W, 3).fill(NAVY);
    doc.fillColor(MUTED).font('Inter').fontSize(8.5).text('AI × Experience × Execution', L, 94);

    // Parties
    const top = 122, half = W / 2 - 10;
    const party = (x: number, label: string, p: { name: string; address: string; gstin: string; contact?: string }) => {
      doc.fillColor(MUTED).font('Inter-Bold').fontSize(8).text(label, x, top, { width: half, characterSpacing: 0.6 });
      doc.fillColor(INK).font('Inter-Bold').fontSize(11).text(p.name, x, top + 14, { width: half });
      doc.fillColor(MUTED).font('Inter').fontSize(9).text(p.address, x, doc.y + 2, { width: half });
      doc.text(`GSTIN: ${p.gstin}`, x, doc.y + 2, { width: half });
      if (p.contact) doc.text(p.contact, x, doc.y + 2, { width: half });
    };
    party(L, 'FROM', FROM); const yFrom = doc.y;
    party(L + W / 2 + 10, 'BILL TO', TO); const yTo = doc.y;

    // Period box
    const y0 = Math.max(yFrom, yTo) + 16;
    doc.rect(L, y0, W, 40).fill(TINT);
    doc.fillColor(MUTED).font('Inter-Bold').fontSize(8).text('RECEIPT FOR', L + 12, y0 + 8, { characterSpacing: 0.6 });
    doc.fillColor(INK).font('Inter-Bold').fontSize(11).text(data.periodLabel ? `URUV model credits — ${data.periodLabel}` : 'URUV model credits usage', L + 12, y0 + 20);
    doc.fillColor(MUTED).font('Inter').fontSize(9).text(`Usage from ${fmtDate(data.from)} to ${fmtDate(data.to)}`, L, y0 + 22, { width: W - 12, align: 'right' });

    // Table
    const cols = { desc: L + 8, credits: 330, req: 410, amt: R - 8 };
    let y = y0 + 58;
    doc.rect(L, y, W, 22).fill(NAVY);
    doc.fillColor('#FFFFFF').font('Inter-Bold').fontSize(9);
    doc.text('Description', cols.desc, y + 7);
    doc.text('Credits', cols.credits - 60, y + 7, { width: 60, align: 'right' });
    doc.text('Requests', cols.req - 60, y + 7, { width: 60, align: 'right' });
    doc.text('Amount (₹)', cols.amt - 90, y + 7, { width: 90, align: 'right' });
    y += 22;
    data.lines.forEach((ln, i) => {
      if (y > 700) { doc.addPage(); y = 50; }
      if (i % 2) doc.rect(L, y, W, 22).fill('#FAFAFA');
      doc.fillColor(INK).font('Inter').fontSize(9.5);
      doc.text(ln.description, cols.desc, y + 6, { width: 230, lineBreak: false, ellipsis: true });
      doc.text(credits(ln.credits), cols.credits - 60, y + 6, { width: 60, align: 'right' });
      doc.text(ln.requests ? ln.requests.toLocaleString('en-IN') : '—', cols.req - 60, y + 6, { width: 60, align: 'right' });
      doc.text(rupees(r2(ln.amount)), cols.amt - 90, y + 6, { width: 90, align: 'right' });
      y += 22;
    });
    doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).lineWidth(1).stroke();

    // Totals
    const t = receiptTotals(data.lines);
    y += 16;
    if (y > 690) { doc.addPage(); y = 50; }
    const labelX = 340, valW = R - 8;
    const row = (label: string, value: string, bold = false) => {
      doc.fillColor(bold ? INK : MUTED).font(bold ? 'Inter-Bold' : 'Inter').fontSize(bold ? 12 : 10).text(label, labelX, y, { width: 110 });
      doc.fillColor(INK).font(bold ? 'Inter-Bold' : 'Inter').fontSize(bold ? 12 : 10).text(value, valW - 110, y, { width: 110, align: 'right' });
      y += bold ? 24 : 20;
    };
    row('Usage value', rupees(t.subtotal));
    row(`GST @ ${RECEIPT_GST_PCT}%`, rupees(t.gst));
    doc.rect(labelX - 10, y - 4, R - labelX + 10, 30).fill(NAVY);
    doc.fillColor('#FFFFFF').font('Inter-Bold').fontSize(12).text('TOTAL', labelX, y + 5, { width: 110 });
    doc.text(rupees(t.total), valW - 130, y + 5, { width: 130, align: 'right' });
    y += 44;

    doc.fillColor(MUTED).font('Inter').fontSize(8.5).text(`1 credit = 1,000 tokens. Generated on ${fmtDate(data.generatedOn)}. This is a system-generated usage receipt.`, L, y, { width: W });
    doc.fillColor(MUTED).fontSize(9).text('Thank you for partnering with AIX3  •  www.aix3.in', L, 790, { width: W, align: 'center' });
    doc.end();
  });
}
