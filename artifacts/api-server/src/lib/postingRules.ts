// Step 3b: how each source document becomes journal lines (docs/specs/step3-ledger.md section 4). Pure, unit tested.
// One entry per invoice, credit note, receipt and settlement. A problem is "fix" (blocks posting) or "ack" (posts once the
// accountant acknowledges it with a note).
import { round2 } from "./payments";

export type Problem = { level: "fix" | "ack"; code: string; message: string; ref?: string | null };
export type Line = { accountCode: string; debit: number; credit: number; customerId?: number | null; supplierId?: number | null; memo?: string | null };
export type Draft = { voucherType: string; narration: string; sourceType: string; sourceId: number; sourceRef: string | null; date: string; lines: Line[] };
export type Built = { entry: Draft | null; problems: Problem[] };

// Where money taken in each payment mode sits until it is settled or banked
export const MODE_ACCOUNT: Record<string, string> = {
  cash: "1100", nabil_qr: "1270", qr: "1270",
  card_nabil: "1250", card_hbl: "1260", card_sulimha_nabil: "1280", card_sulimha_hbl: "1280",
  card: "1250", esewa: "1250", // older card bills with no machine recorded: Nabil POS by default, flagged
  credit: "1300",
};
export const MACHINE_ACCOUNT: Record<string, string> = { nabil_pos: "1250", hbl_pos: "1260", qr: "1270", sulimha_nabil_pos: "1280", sulimha_hbl_pos: "1280" };
export const BANK_ACCOUNT: Record<string, string> = { nabil: "1200", hbl: "1210" };
const SALES: Record<string, string> = { food: "4000", beverage: "4010" };
export const BREAKFAST_INCOME = "4020", DISCOUNTS = "4950", RETURNS = "4900", OUTPUT_VAT = "2200", BANK_CHARGES = "7000", RECEIVABLE = "1300";

// Same account and customer: one line; debit and credit of one account are netted
function tidy(lines: Line[]): Line[] {
  const map = new Map<string, Line>();
  for (const l of lines) {
    const k = `${l.accountCode}|${l.customerId ?? ""}|${l.debit > 0 ? "D" : "C"}`;
    const m = map.get(k);
    if (m) { m.debit = round2(m.debit + l.debit); m.credit = round2(m.credit + l.credit); } else map.set(k, { ...l, debit: round2(l.debit), credit: round2(l.credit) });
  }
  return [...map.values()].filter(l => l.debit > 0.004 || l.credit > 0.004);
}
const balanced = (lines: Line[]) => Math.abs(lines.reduce((s, l) => s + l.debit - l.credit, 0)) < 0.005;

export type SaleSource = {
  orderId: number; invoiceNumber: string | null; day: string; total: number; vat: number; breakfast: boolean; customerId: number | null;
  items: { name: string; subtotal: number; kind: string | null; category: string | null }[];
  parts: { mode: string; amount: number }[];
};

export function saleEntry(s: SaleSource, opts: { vatEnabled: boolean }): Built {
  const ref = s.invoiceNumber ?? `Order #${s.orderId}`;
  const problems: Problem[] = [];
  const preVat = round2(s.total - s.vat);
  const credits: Line[] = [];
  if (s.breakfast) {
    if (preVat > 0) credits.push({ accountCode: BREAKFAST_INCOME, debit: 0, credit: preVat });
  } else {
    if (!s.items.length && preVat > 0) problems.push({ level: "fix", code: "no_items", message: `${ref} has no items, so its sales account is unknown.`, ref });
    const missing = [...new Set(s.items.filter(i => !SALES[i.kind ?? ""]).map(i => i.category ?? "(no category)"))];
    if (missing.length) problems.push({ level: "fix", code: "category_kind", message: `${ref}: menu categor${missing.length === 1 ? "y" : "ies"} ${missing.join(", ")} not marked Food or Beverage.`, ref });
    const byKind = new Map<string, number>();
    for (const i of s.items) if (SALES[i.kind ?? ""]) byKind.set(i.kind!, round2((byKind.get(i.kind!) ?? 0) + i.subtotal));
    const gross = round2([...byKind.values()].reduce((a, b) => a + b, 0));
    for (const [kind, amount] of [...byKind.entries()].sort((a, b) => SALES[a[0]].localeCompare(SALES[b[0]]))) credits.push({ accountCode: SALES[kind], debit: 0, credit: amount });
    const discount = round2(gross - preVat);
    if (discount > 0.004) credits.unshift({ accountCode: DISCOUNTS, debit: discount, credit: 0 });
    else if (discount < -0.004 && credits.length) {
      // the bill is more than its items (older invoices): the difference goes to the biggest sales line, flagged
      const big = credits.reduce((a, b) => (b.credit > a.credit ? b : a));
      big.credit = round2(big.credit - discount);
      problems.push({ level: "ack", code: "items_total", message: `${ref}: items add up to Rs. ${gross.toFixed(2)} but the bill (before VAT) is Rs. ${preVat.toFixed(2)}.`, ref });
    }
  }
  if (s.vat > 0) {
    credits.push({ accountCode: OUTPUT_VAT, debit: 0, credit: round2(s.vat) });
    if (!opts.vatEnabled) problems.push({ level: "ack", code: "vat_bill", message: `${ref} is a VAT bill (Rs. ${s.vat.toFixed(2)} VAT) while VAT is off.`, ref });
  }
  const debits: Line[] = [];
  for (const p of s.parts) {
    // A Rs 0 part is no money (a Rs 0 bill: payment_method 'none' and no payment rows, or a 100% discount): no line, no problem
    if (Math.abs(p.amount) < 0.005) continue;
    const acct = MODE_ACCOUNT[p.mode];
    if (!acct) { problems.push({ level: "fix", code: "payment_mode", message: `${ref}: payment mode "${p.mode}" has no account.`, ref }); continue; }
    if (acct === RECEIVABLE && !s.customerId) { problems.push({ level: "fix", code: "credit_customer", message: `${ref}: a credit part with no customer.`, ref }); continue; }
    if (p.mode === "card" || p.mode === "esewa") problems.push({ level: "ack", code: "card_machine", message: `${ref}: a card payment with no machine recorded (posted to 1250 Nabil POS).`, ref });
    debits.push({ accountCode: acct, debit: round2(p.amount), credit: 0, customerId: acct === RECEIVABLE ? s.customerId : null });
  }
  const lines = tidy([...debits, ...credits.filter(c => c.debit > 0), ...credits.filter(c => c.credit > 0)]);
  if (problems.some(p => p.level === "fix")) return { entry: null, problems };
  if (!lines.length) return { entry: null, problems };
  if (!balanced(lines)) return { entry: null, problems: [...problems, { level: "fix", code: "unbalanced", message: `${ref}: the payments do not add up to the bill.`, ref }] };
  return { entry: { voucherType: "SJ", narration: `Sale ${ref}`, sourceType: "order", sourceId: s.orderId, sourceRef: ref, date: s.day, lines }, problems };
}

export type NoteSource = { noteId: number; noteNo: string; day: string; kind: string; subtotal: number; vat: number; total: number; customerId: number; invoiceNumber: string | null; newCustomerId: number | null; newInvoiceNumber: string | null };

export function creditNoteEntry(n: NoteSource): Built {
  const base = { voucherType: "SJ", sourceType: "credit_note", sourceId: n.noteId, sourceRef: n.noteNo, date: n.day };
  if (n.kind === "reissue") {
    if (!n.newCustomerId) return { entry: null, problems: [{ level: "fix", code: "reissue", message: `${n.noteNo}: the re-issued invoice is missing.`, ref: n.noteNo }] };
    return { entry: { ...base, narration: `${n.noteNo}: invoice ${n.invoiceNumber ?? ""} moved to invoice ${n.newInvoiceNumber ?? ""} (Wrong customer)`,
      lines: [{ accountCode: RECEIVABLE, debit: round2(n.total), credit: 0, customerId: n.newCustomerId }, { accountCode: RECEIVABLE, debit: 0, credit: round2(n.total), customerId: n.customerId }] }, problems: [] };
  }
  const lines = tidy([
    { accountCode: RETURNS, debit: round2(n.subtotal), credit: 0 },
    { accountCode: OUTPUT_VAT, debit: round2(n.vat), credit: 0 },
    { accountCode: RECEIVABLE, debit: 0, credit: round2(n.total), customerId: n.customerId },
  ]);
  if (!balanced(lines)) return { entry: null, problems: [{ level: "fix", code: "unbalanced", message: `${n.noteNo}: amount and VAT do not add up to the total.`, ref: n.noteNo }] };
  return { entry: { ...base, narration: `${n.noteNo}: credit note on ${n.invoiceNumber ?? ""}`, lines }, problems: [] };
}

export type ReceiptSource = { receiptId: number; voucherNo: string; day: string; mode: string; amount: number; bankAccount: string | null; customerId: number };

export function receiptEntry(r: ReceiptSource): Built {
  const acct = r.mode === "bank" ? BANK_ACCOUNT[r.bankAccount ?? ""] : MODE_ACCOUNT[r.mode];
  if (!acct || acct === RECEIVABLE) return { entry: null, problems: [{ level: "fix", code: r.mode === "bank" ? "receipt_bank" : "payment_mode", message: r.mode === "bank" ? `${r.voucherNo}: a receipt by bank with no bank recorded.` : `${r.voucherNo}: receipt mode "${r.mode}" has no account.`, ref: r.voucherNo }] };
  return { entry: { voucherType: "RJ", narration: `${r.voucherNo}: receipt`, sourceType: "receipt", sourceId: r.receiptId, sourceRef: r.voucherNo, date: r.day,
    lines: [{ accountCode: acct, debit: round2(r.amount), credit: 0 }, { accountCode: RECEIVABLE, debit: 0, credit: round2(r.amount), customerId: r.customerId }] }, problems: [] };
}

export type SettlementSource = { settlementId: number; machine: string; salesDay: string; day: string; gross: number; received: number; bankAccount: string; reference: string };

export function settlementEntry(s: SettlementSource): Built {
  const machine = MACHINE_ACCOUNT[s.machine], bank = BANK_ACCOUNT[s.bankAccount];
  const ref = `${s.machine} ${s.salesDay}`;
  if (!machine || !bank) return { entry: null, problems: [{ level: "fix", code: "settlement", message: `Settlement ${ref}: machine or bank has no account.`, ref }] };
  const charge = round2(s.gross - s.received);
  const problems: Problem[] = charge < -0.004 ? [{ level: "ack", code: "settlement_over", message: `Settlement ${ref}: received Rs. ${s.received.toFixed(2)} is more than the sales Rs. ${s.gross.toFixed(2)}.`, ref }] : [];
  const lines = tidy([
    { accountCode: bank, debit: round2(s.received), credit: 0 },
    ...(charge > 0.004 ? [{ accountCode: BANK_CHARGES, debit: charge, credit: 0 }] : []),
    { accountCode: machine, debit: 0, credit: round2(s.gross) },
    ...(charge < -0.004 ? [{ accountCode: BANK_CHARGES, debit: 0, credit: -charge }] : []),
  ]);
  return { entry: { voucherType: "ST", narration: `Settlement ${s.machine} for ${s.salesDay} (${s.reference})`, sourceType: "settlement", sourceId: s.settlementId, sourceRef: s.reference, date: s.day, lines }, problems };
}

// Two line sets are the same entry (to tell whether a posted source changed)
export function sameLines(a: Line[], b: Line[]): boolean {
  const key = (ls: Line[]) => ls.map(l => `${l.accountCode}|${l.customerId ?? ""}|${l.supplierId ?? ""}|${round2(l.debit).toFixed(2)}|${round2(l.credit).toFixed(2)}`).sort().join(";");
  return key(a) === key(b);
}
