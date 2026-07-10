/**
 * invoicePdf.ts — S6: the invoice ARTIFACT. Generated once at issue, stored
 * through the S4 document path (private R2/fs), immutable evidence from then
 * on — the PDF is never regenerated, the stored bytes ARE the document that
 * went (or goes) to the counterparty.
 *
 * pdf-lib, standard Helvetica (no font files, no native deps). One A4 page:
 * issuer entity block, the outward number, billed-to, the mission/tournament
 * reference, one line item, Subtotal / VAT / TOTAL in the line's native
 * currency. NO bank details by design: C3 never stores account numbers
 * (standing law), so the artifact carries none.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { formatMoney, type CurrencyCode, type Invoice } from '@c3web/domain';

export interface InvoicePdfContext {
  readonly invoice: Invoice;
  readonly entity: { readonly name: string; readonly jurisdiction: string; readonly registrationId: string | null };
  readonly mission: { readonly name: string; readonly code: string | null };
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.09, 0.1, 0.14);
const MID = rgb(0.38, 0.4, 0.46);
const LINE = rgb(0.82, 0.83, 0.86);

/** pdf-lib's WinAnsi encoding rejects some Unicode (—, NBSP is fine); keep the artifact safe. */
function ansi(text: string): string {
  return text.replace(/—/g, '-').replace(/–/g, '-').replace(/[""]/g, '"').replace(/['']/g, "'");
}

export async function buildInvoicePdf(ctx: InvoicePdfContext): Promise<Uint8Array> {
  const { invoice, entity, mission } = ctx;
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${invoice.invoiceNumber}`);
  doc.setCreator('C3');
  const page = doc.addPage(A4);
  const [width] = A4;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // formatMoney separates code and amount with U+00A0; swap for a plain space
  // so the artifact stays copy/search-friendly.
  const rightEdge = width - MARGIN;
  const money = (minor: number): string => ansi(formatMoney(minor, invoice.currency as CurrencyCode).replace(/ /g, ' '));

  const text = (t: string, x: number, y: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(ansi(t), { x, y, size, font: f, color });
  const rightText = (t: string, y: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(ansi(t), { x: rightEdge - f.widthOfTextAtSize(ansi(t), size), y, size, font: f, color });
  const rule = (y: number) => page.drawLine({ start: { x: MARGIN, y }, end: { x: rightEdge, y }, thickness: 0.75, color: LINE });

  // ── issuer block (left) + the outward number (right) ──────────────────────
  let y = 841.89 - MARGIN - 8;
  text(entity.name, MARGIN, y, 16, bold);
  y -= 16;
  text(entity.jurisdiction, MARGIN, y, 9, font, MID);
  if (entity.registrationId) {
    y -= 12;
    text(`Reg / VAT: ${entity.registrationId}`, MARGIN, y, 9, font, MID);
  }

  let yr = 841.89 - MARGIN - 8;
  rightText('INVOICE', yr, 22, bold);
  yr -= 20;
  rightText(invoice.invoiceNumber, yr, 12, bold);
  yr -= 14;
  rightText(`Issued ${invoice.issuedOn}`, yr, 9, font, MID);

  y = Math.min(y, yr) - 34;
  rule(y);
  y -= 22;

  // ── billed to ──────────────────────────────────────────────────────────────
  text('BILLED TO', MARGIN, y, 8, bold, MID);
  y -= 14;
  text(invoice.billedToName, MARGIN, y, 12, bold);
  if (invoice.billedToDetails) {
    for (const lineText of invoice.billedToDetails.split(/\r?\n/).slice(0, 4)) {
      y -= 13;
      text(lineText, MARGIN, y, 9, font, MID);
    }
  }

  // ── the reference (tournament-coded, income-typed) ────────────────────────
  y -= 26;
  text('REFERENCE', MARGIN, y, 8, bold, MID);
  y -= 14;
  text(`${mission.code ? `${mission.code} - ` : ''}${mission.name}`, MARGIN, y, 10);
  y -= 13;
  text(`Type of income: ${invoice.incomeCategory}`, MARGIN, y, 9, font, MID);

  // ── the line item ──────────────────────────────────────────────────────────
  y -= 30;
  rule(y);
  y -= 16;
  text('DESCRIPTION', MARGIN, y, 8, bold, MID);
  rightText('AMOUNT', y, 8, bold, MID);
  y -= 16;
  text(invoice.description ?? `${invoice.incomeCategory} - ${mission.name}`, MARGIN, y, 10);
  rightText(money(invoice.subtotalMinor), y, 10);
  y -= 14;
  rule(y);

  // ── totals column ──────────────────────────────────────────────────────────
  const totals: Array<[string, string, PDFFont, number]> = [
    ['Subtotal', money(invoice.subtotalMinor), font, 10],
    [`VAT (${(invoice.vatRateBps / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%)`, money(invoice.vatMinor), font, 10],
    ['TOTAL DUE', money(invoice.totalMinor), bold, 12],
  ];
  const labelX = rightEdge - 220;
  for (const [label, value, f, size] of totals) {
    y -= 20;
    text(label, labelX, y, size, f, f === bold ? INK : MID);
    rightText(value, y, size, f);
  }
  y -= 12;
  page.drawLine({ start: { x: labelX, y }, end: { x: rightEdge, y }, thickness: 1, color: INK });

  // ── currency + footer ─────────────────────────────────────────────────────
  y -= 16;
  text(`All amounts in ${invoice.currency}.`, labelX, y, 8, font, MID);
  text(`Generated by C3 - ${invoice.invoiceId}`, MARGIN, MARGIN - 14, 7.5, font, MID);

  return doc.save();
}
