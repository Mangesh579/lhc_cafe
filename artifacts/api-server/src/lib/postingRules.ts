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
  vatRate?: number | null; taxable?: number | null; // 5e: frozen at payment
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
  if (s.vatRate != null && s.taxable != null) {
    const want = Math.sign(s.taxable * s.vatRate) * Math.round(Math.abs(s.taxable * s.vatRate) + 1e-7) / 100;
    if (Math.abs(want - s.vat) >= 0.005 || Math.abs(round2(s.taxable + s.vat) - s.total) >= 0.005) problems.push({ level: "fix", code: "sale_vat", message: `${ref}: its VAT (Rs. ${s.vat.toFixed(2)}) does not match ${s.vatRate}% of Rs. ${s.taxable.toFixed(2)}, or the total does not add up.`, ref });
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

export type ReceiptSource = { receiptId: number; voucherNo: string; day: string; mode: string; amount: number; bankAccount: string | null; customerId: number; tdsAmount?: number };
export const TDS_RECEIVABLE = "1460";

export function receiptEntry(r: ReceiptSource): Built {
  const acct = r.mode === "bank" ? BANK_ACCOUNT[r.bankAccount ?? ""] : MODE_ACCOUNT[r.mode];
  if (!acct || acct === RECEIVABLE) return { entry: null, problems: [{ level: "fix", code: r.mode === "bank" ? "receipt_bank" : "payment_mode", message: r.mode === "bank" ? `${r.voucherNo}: a receipt by bank with no bank recorded.` : `${r.voucherNo}: receipt mode "${r.mode}" has no account.`, ref: r.voucherNo }] };
  // 5c: the TDS the customer withheld is an asset (1460), and the receipt settles the money plus the TDS
  const tds = round2(r.tdsAmount ?? 0);
  if (tds < 0) return { entry: null, problems: [{ level: "fix", code: "receipt_tds", message: `${r.voucherNo}: the TDS withheld is below zero.`, ref: r.voucherNo }] };
  if (tds > 0 && r.mode !== "cash" && r.mode !== "bank") return { entry: null, problems: [{ level: "fix", code: "receipt_tds_mode", message: `${r.voucherNo}: TDS on a ${r.mode} receipt (only cash or bank receipts carry TDS). Void it and enter it again.`, ref: r.voucherNo }] };
  return { entry: { voucherType: "RJ", narration: `${r.voucherNo}: receipt${tds > 0 ? ` (TDS withheld Rs. ${tds.toFixed(2)})` : ""}`, sourceType: "receipt", sourceId: r.receiptId, sourceRef: r.voucherNo, date: r.day,
    lines: tidy([{ accountCode: acct, debit: round2(r.amount), credit: 0 },
      ...(tds > 0 ? [{ accountCode: TDS_RECEIVABLE, debit: tds, credit: 0, customerId: r.customerId, memo: "TDS withheld by the customer" }] : []),
      { accountCode: RECEIVABLE, debit: 0, credit: round2(r.amount + tds), customerId: r.customerId }]) }, problems: [] };
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

// ── Part 3c: purchases, supplier payments, debit notes, expenses, the drawer and consumption ──

export const PAYABLE = "2100", CASH = "1100", DRAWINGS = "3100", CASH_SHORT_OVER = "7050";
const INVENTORY: Record<string, string> = { kitchen: "1400", drink: "1410" };
const CONSUMPTION: Record<string, string> = { food: "5000", beverage: "5010" };
export const NC_COST = "5200", WASTE = "5100";
export const STOCK_ADJUSTMENT = "5150";

// Step 3e: a stock change made by hand (Stock Log kind 'adjustment'), valued at the cost per unit recorded with it.
// Increase: Dr 1400/1410 (the ingredient's department), Cr 5150. Decrease: Dr 5150, Cr 1400/1410.
export type AdjustmentSource = { logId: number; day: string; itemName: string; department: string | null; unit: string | null; change: number; unitCost: number | null; reason: string };
export function stockAdjustmentEntry(a: AdjustmentSource): Built {
  const ref = `Stock adjustment #${a.logId}`;
  const size = `${a.change > 0 ? "+" : ""}${a.change}${a.unit ? ` ${a.unit}` : ""}`;
  if (!(a.unitCost && a.unitCost > 0)) return { entry: null, problems: [{ level: "ack", code: "adjustment_no_cost", message: `${ref}: adjustment of ${a.itemName} (${size}) with no cost, not posted.`, ref }] };
  const amount = round2(Math.abs(a.change) * a.unitCost);
  if (amount < 0.01) return { entry: null, problems: [] };
  const stock = INVENTORY[a.department === "drink" ? "drink" : "kitchen"];
  return { entry: { voucherType: "SA", narration: `${ref}: ${a.itemName} ${size} at Rs. ${a.unitCost} (${a.reason})`, sourceType: "stock_adjustment", sourceId: a.logId, sourceRef: ref, date: a.day,
    lines: a.change > 0 ? [{ accountCode: stock, debit: amount, credit: 0 }, { accountCode: STOCK_ADJUSTMENT, debit: 0, credit: amount }]
                        : [{ accountCode: STOCK_ADJUSTMENT, debit: amount, credit: 0 }, { accountCode: stock, debit: 0, credit: amount }] }, problems: [] };
}

export const dayKey = (day: string) => Number(day.replace(/-/g, "")); // a day as a source id (consumption, drawer close)

// Inventory lines by department (kitchen 1400, drink 1410); an unknown department is a must-fix
function inventoryLines(lines: { department: string; lineTotal: number }[], side: "debit" | "credit", ref: string, problems: Problem[]): Line[] {
  const out: Line[] = [];
  for (const l of lines) {
    const acct = INVENTORY[l.department];
    if (!acct) { problems.push({ level: "fix", code: "department", message: `${ref}: a line with department "${l.department}" (not kitchen or drink).`, ref }); continue; }
    out.push({ accountCode: acct, debit: side === "debit" ? round2(l.lineTotal) : 0, credit: side === "credit" ? round2(l.lineTotal) : 0 });
  }
  return out;
}

export type BillSource = { billId: number; pjNumber: string; billNumber: string; day: string; supplierId: number; supplierName: string; terms: string; paidVia: string | null; paidFromAccount: string | null; total: number; lines: { department: string; lineTotal: number }[];
  inputVat?: { claimed: boolean; billType: string; vat: number; supplierVatRegistered: boolean } }; // 5d: lines then carry the amount before VAT
export const INPUT_VAT = "1450";

// A purchase bill increases stock, never cost (step 2 spec section 13). VAT stays in the line cost while VAT is off.
export function purchaseBillEntry(b: BillSource): Built {
  const problems: Problem[] = [];
  // 5d: a bill that claims input VAT: stock at the amount before VAT, the VAT to 1450
  const iv = b.inputVat?.claimed ? b.inputVat : null;
  if (iv && (iv.billType !== "vat" || !(iv.vat > 0))) problems.push({ level: "fix", code: "input_vat", message: `${b.pjNumber}: marked as claiming input VAT but it is not a VAT bill with VAT. Void it and enter it again.`, ref: b.pjNumber });
  if (iv && !iv.supplierVatRegistered) problems.push({ level: "fix", code: "input_vat_supplier", message: `${b.pjNumber}: claims input VAT but ${b.supplierName} is not ticked VAT registered. Tick it on the supplier, or void and re-enter the bill.`, ref: b.pjNumber });
  const stock = [...inventoryLines(b.lines, "debit", b.pjNumber, problems), ...(iv && iv.vat > 0 ? [{ accountCode: INPUT_VAT, debit: round2(iv.vat), credit: 0 }] : [])];
  const linesTotal = round2(stock.reduce((s, l) => s + l.debit, 0));
  if (stock.length && Math.abs(linesTotal - b.total) >= 0.005) {
    const big = stock.reduce((a, c) => (c.debit > a.debit ? c : a));
    big.debit = round2(big.debit + b.total - linesTotal);
    problems.push({ level: "ack", code: "bill_total", message: `${b.pjNumber}: lines add up to Rs. ${linesTotal.toFixed(2)}, the bill is Rs. ${b.total.toFixed(2)}.`, ref: b.pjNumber });
  }
  let credit: Line | null = null;
  if (b.terms === "credit") credit = { accountCode: PAYABLE, debit: 0, credit: round2(b.total), supplierId: b.supplierId };
  else if (b.paidVia === "drawer") credit = { accountCode: CASH, debit: 0, credit: round2(b.total) };
  else if (BANK_ACCOUNT[b.paidFromAccount ?? ""]) credit = { accountCode: BANK_ACCOUNT[b.paidFromAccount!], debit: 0, credit: round2(b.total) };
  else problems.push({ level: "fix", code: "bill_bank", message: `${b.pjNumber}: paid by ${b.paidVia ?? "?"} with no bank recorded.`, ref: b.pjNumber });
  if (problems.some(p => p.level === "fix") || !credit) return { entry: null, problems };
  return { entry: { voucherType: "PB", narration: `${b.pjNumber}: bill ${b.billNumber} from ${b.supplierName}`, sourceType: "purchase_bill", sourceId: b.billId, sourceRef: b.pjNumber, date: b.day, lines: tidy([...stock, credit]) }, problems };
}

export type PaymentSource = { paymentId: number; voucherNo: string; day: string; supplierId: number; paidVia: string; paidFromAccount: string | null; amount: number; tdsAmount?: number; tdsType?: string | null };
export const TDS_PAYABLE = "2250";

// A supplier payment (CV from the drawer, PV by cheque or online); an advance also debits 2100 (the supplier goes negative)
export function supplierPaymentEntry(p: PaymentSource): Built {
  const credit = p.paidVia === "drawer" ? CASH : BANK_ACCOUNT[p.paidFromAccount ?? ""];
  if (!credit) return { entry: null, problems: [{ level: "fix", code: "payment_bank", message: `${p.voucherNo}: paid by ${p.paidVia} with no bank recorded.`, ref: p.voucherNo }] };
  // 5b: TDS withheld: the supplier's balance falls by the gross; the bank pays the net; 2250 owes the tax (supplier on the line)
  const tds = round2(p.tdsAmount ?? 0);
  if (tds > 0 && p.paidVia === "drawer") return { entry: null, problems: [{ level: "fix", code: "tds_drawer", message: `${p.voucherNo}: TDS on cash from the drawer.`, ref: p.voucherNo }] };
  return { entry: { voucherType: "SP", narration: `${p.voucherNo}: supplier payment${tds > 0 ? `, TDS Rs. ${tds.toFixed(2)} withheld` : ""}`, sourceType: "supplier_payment", sourceId: p.paymentId, sourceRef: p.voucherNo, date: p.day,
    lines: [{ accountCode: PAYABLE, debit: round2(p.amount), credit: 0, supplierId: p.supplierId }, { accountCode: credit, debit: 0, credit: round2(p.amount - tds) },
      ...(tds > 0 ? [{ accountCode: TDS_PAYABLE, debit: 0, credit: tds, supplierId: p.supplierId, memo: `TDS ${p.tdsType ?? ""}`.trim() }] : [])] }, problems: [] };
}

export type DebitNoteSource = { noteId: number; noteNo: string; day: string; supplierId: number; total: number; lines: { department: string; lineTotal: number }[];
  inputVat?: { claimed: boolean; vat: number } }; // 5d: a return on a claimed bill: lines carry the amount before VAT, the VAT back out of 1450

// A purchase return lowers what is owed and the stock
export function debitNoteEntry(n: DebitNoteSource): Built {
  const problems: Problem[] = [];
  const stock = [...inventoryLines(n.lines, "credit", n.noteNo, problems), ...(n.inputVat?.claimed && n.inputVat.vat > 0 ? [{ accountCode: INPUT_VAT, debit: 0, credit: round2(n.inputVat.vat) }] : [])];
  if (problems.length) return { entry: null, problems };
  const lines = tidy([{ accountCode: PAYABLE, debit: round2(n.total), credit: 0, supplierId: n.supplierId }, ...stock]);
  if (!balanced(lines)) return { entry: null, problems: [{ level: "fix", code: "unbalanced", message: `${n.noteNo}: lines do not add up to the note.`, ref: n.noteNo }] };
  return { entry: { voucherType: "DJ", narration: `${n.noteNo}: purchase return`, sourceType: "debit_note", sourceId: n.noteId, sourceRef: n.noteNo, date: n.day, lines }, problems: [] };
}

export type ExpenseSource = { expenseId: number; voucherNo: string | null; day: string; category: string; accountCode: string | null; amount: number; paymentMethod: string; paidFromDrawer: boolean; bankAccount: string | null; billNumber: string | null;
  tdsAmount?: number; tdsType?: string | null; payeePan?: string | null; payeeSupplierId?: number | null;
  inputVat?: { claimed: boolean; billType: string | null; vat: number } }; // 5d: the VAT inside the amount goes to 1450

// An expense through expense_account_map. Petty cash with no bill posts the same way, flagged for the accountant's review.
export function expenseEntry(e: ExpenseSource): Built {
  const ref = e.voucherNo ?? `Expense #${e.expenseId}`;
  const problems: Problem[] = [];
  if (!e.accountCode) problems.push({ level: "fix", code: "expense_map", message: `${ref}: expense category "${e.category}" has no account (Chart of Accounts > Expense categories).`, ref });
  let credit: string | null = null;
  if (e.paidFromDrawer) credit = CASH;
  else if (e.paymentMethod === "cash") problems.push({ level: "fix", code: "expense_cash", message: `${ref}: paid in cash but not from the drawer: say which account it came from.`, ref });
  else if (e.paymentMethod === "bank_transfer" || e.paymentMethod === "cheque") {
    credit = BANK_ACCOUNT[e.bankAccount ?? ""] ?? null;
    if (!credit) problems.push({ level: "fix", code: "expense_bank", message: `${ref}: paid by ${e.paymentMethod.replace("_", " ")} with no bank recorded.`, ref });
  } else problems.push({ level: "fix", code: "expense_mode", message: `${ref}: paid by ${e.paymentMethod}; tell the accountant which account it came from.`, ref });
  if (e.paidFromDrawer && !e.billNumber) problems.push({ level: "ack", code: "no_bill", message: `${ref}: petty cash with no bill (Rs. ${e.amount.toFixed(2)}, ${e.category}).`, ref });
  // 5b: TDS withheld: the expense at the gross, the bank pays the net, 2250 owes the tax (the payee on the line)
  const tds = round2(e.tdsAmount ?? 0);
  if (tds > 0 && e.paidFromDrawer) problems.push({ level: "fix", code: "tds_drawer", message: `${ref}: TDS on petty cash from the drawer.`, ref });
  // 5d: input VAT claimed: the expense at the amount less VAT, the VAT to 1450
  const iv = e.inputVat?.claimed ? e.inputVat : null;
  if (iv && (iv.billType !== "vat" || !(iv.vat > 0) || iv.vat >= e.amount)) problems.push({ level: "fix", code: "input_vat", message: `${ref}: marked as claiming input VAT but it is not a VAT bill with VAT below the amount. Correct the bill type or VAT on the expense.`, ref });
  const vat = iv ? round2(iv.vat) : 0;
  if (problems.some(p => p.level === "fix") || !credit) return { entry: null, problems };
  return { entry: { voucherType: "EX", narration: `${ref}: ${e.category}${e.billNumber ? `, bill ${e.billNumber}` : e.paidFromDrawer ? ", no bill" : ""}${tds > 0 ? `, TDS Rs. ${tds.toFixed(2)} withheld` : ""}`, sourceType: "expense", sourceId: e.expenseId, sourceRef: ref, date: e.day,
    lines: [{ accountCode: e.accountCode!, debit: round2(e.amount - vat), credit: 0 }, ...(vat > 0 ? [{ accountCode: INPUT_VAT, debit: vat, credit: 0 }] : []), { accountCode: credit, debit: 0, credit: round2(e.amount - tds) },
      ...(tds > 0 ? [{ accountCode: TDS_PAYABLE, debit: 0, credit: tds, supplierId: e.payeeSupplierId ?? null, memo: `TDS ${e.tdsType ?? ""} · PAN ${e.payeePan ?? ""}`.trim() }] : [])] }, problems };
}

// 5b: the tax payment voucher. A TDS deposit clears 2250 from the bank. (The VAT payment kind is built in 5f.)
export type TaxPaymentSource = { paymentId: number; voucherNo: string; day: string; kind: string; amount: number; bankAccount: string; bsLabel: string; reference: string | null };
export function taxPaymentEntry(t: TaxPaymentSource): Built {
  const bank = BANK_ACCOUNT[t.bankAccount];
  if (!bank) return { entry: null, problems: [{ level: "fix", code: "tax_payment_bank", message: `${t.voucherNo}: no bank recorded.`, ref: t.voucherNo }] };
  if (t.kind !== "tds_deposit") return { entry: null, problems: [{ level: "fix", code: "tax_payment_kind", message: `${t.voucherNo}: a ${t.kind} is posted from step 5f.`, ref: t.voucherNo }] };
  const a = round2(t.amount);
  if (a < 0.005) return { entry: null, problems: [] };
  return { entry: { voucherType: "TX", narration: `${t.voucherNo}: TDS deposit for ${t.bsLabel}${t.reference ? ` (${t.reference})` : ""}`, sourceType: "tax_payment", sourceId: t.paymentId, sourceRef: t.voucherNo, date: t.day,
    lines: [{ accountCode: TDS_PAYABLE, debit: a, credit: 0 }, { accountCode: bank, debit: 0, credit: a }] }, problems: [] };
}

export type MovementSource = { movementId: number; day: string; kind: string; amount: number; bankAccount: string | null; accountCode: string | null; reference: string | null };

export function cashMovementEntry(m: MovementSource): Built {
  const ref = `Drawer ${m.kind.replace("_", " ")} #${m.movementId}`;
  let other: string | null = null, cashIn = false;
  if (m.kind === "deposit") other = BANK_ACCOUNT[m.bankAccount ?? ""] ?? null;
  else if (m.kind === "owner_draw") other = DRAWINGS;
  else if (m.kind === "other_in" || m.kind === "other_out") { other = m.accountCode; cashIn = m.kind === "other_in"; }
  if (!other) return { entry: null, problems: [{ level: "fix", code: m.kind === "deposit" ? "deposit_bank" : "movement_account", message: `${ref}: ${m.kind === "deposit" ? "no bank recorded" : "no account recorded"}.`, ref }] };
  const a = round2(m.amount);
  return { entry: { voucherType: "CM", narration: `${ref}${m.reference ? ` (${m.reference})` : ""}`, sourceType: "cash_movement", sourceId: m.movementId, sourceRef: ref, date: m.day,
    lines: cashIn ? [{ accountCode: CASH, debit: a, credit: 0 }, { accountCode: other, debit: 0, credit: a }] : [{ accountCode: other, debit: a, credit: 0 }, { accountCode: CASH, debit: 0, credit: a }] }, problems: [] };
}

// The closed drawer's counted difference: short (negative) Dr 7050, over (positive) Cr 7050
export function cashCloseEntry(c: { day: string; difference: number }): Built {
  const d = round2(c.difference);
  if (Math.abs(d) < 0.005) return { entry: null, problems: [] };
  const a = Math.abs(d);
  return { entry: { voucherType: "CC", narration: `Cash ${d < 0 ? "short" : "over"} at the close of ${c.day}`, sourceType: "cash_close", sourceId: dayKey(c.day), sourceRef: `Drawer ${c.day}`, date: c.day,
    lines: d < 0 ? [{ accountCode: CASH_SHORT_OVER, debit: a, credit: 0 }, { accountCode: CASH, debit: 0, credit: a }] : [{ accountCode: CASH, debit: a, credit: 0 }, { accountCode: CASH_SHORT_OVER, debit: 0, credit: a }] }, problems: [] };
}

export type ConsumptionSource = {
  day: string;
  sold: { cost: number; kind: string | null; kitchenShare: number }[];      // ingredient cost of the day's sold items
  nc: { cost: number; kitchenShare: number }[];                              // NC bills at ingredient cost
  restored: { cost: number; kind: string | null; kitchenShare: number }[];  // "not served" cancels: stock put back
  waste: { value: number; department: string }[];                            // Waste Log entries (not prep waste)
  uncosted: { count: number; sales: number };                                // sold items with no recipe cost
};

// One entry per day: consumption Dr 5000/5010 (category kind), NC Dr 5200, waste Dr 5100, all against 1400/1410 by
// ingredient department; the stock a "not served" cancel put back reverses its consumption.
export function consumptionEntry(c: ConsumptionSource): Built {
  const problems: Problem[] = [];
  const debit = new Map<string, number>(), credit = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => { if (v > 0.00001) m.set(k, (m.get(k) ?? 0) + v); };
  const stock = (m: Map<string, number>, cost: number, kitchenShare: number) => { add(m, "1400", cost * kitchenShare); add(m, "1410", cost * (1 - kitchenShare)); };
  for (const s of c.sold) { add(debit, CONSUMPTION[s.kind ?? ""] ?? "5000", s.cost); stock(credit, s.cost, s.kitchenShare); }
  for (const n of c.nc) { add(debit, NC_COST, n.cost); stock(credit, n.cost, n.kitchenShare); }
  for (const w of c.waste) { add(debit, WASTE, w.value); add(credit, INVENTORY[w.department] ?? "1400", w.value); }
  const back = new Map<string, number>(), backCr = new Map<string, number>();
  for (const r of c.restored) { stock(back, r.cost, r.kitchenShare); add(backCr, CONSUMPTION[r.kind ?? ""] ?? "5000", r.cost); }
  if (c.uncosted.count) problems.push({ level: "ack", code: "no_recipe_cost", message: `Consumption on ${c.day} is short: ${c.uncosted.count} item${c.uncosted.count === 1 ? "" : "s"} sold with no recipe cost (sales Rs. ${c.uncosted.sales.toFixed(2)}).` });
  const order = ["5000", "5010", NC_COST, WASTE];
  const lines: Line[] = [
    ...[...debit.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([k, v]) => ({ accountCode: k, debit: round2(v), credit: 0 })),
    ...[...back.entries()].sort().map(([k, v]) => ({ accountCode: k, debit: round2(v), credit: 0 })),
    ...[...credit.entries()].sort().map(([k, v]) => ({ accountCode: k, debit: 0, credit: round2(v) })),
    ...[...backCr.entries()].sort().map(([k, v]) => ({ accountCode: k, debit: 0, credit: round2(v) })),
  ].filter(l => l.debit > 0.004 || l.credit > 0.004);
  if (!lines.length) return { entry: null, problems };
  // rounding the splits can leave a paisa: put it on the biggest credit line so the entry balances
  const diff = round2(lines.reduce((s, l) => s + l.debit - l.credit, 0));
  if (Math.abs(diff) >= 0.005) { const big = lines.filter(l => l.credit > 0).reduce((a, b) => (b.credit > a.credit ? b : a)); big.credit = round2(big.credit + diff); }
  return { entry: { voucherType: "CO", narration: `Consumption, NC and waste for ${c.day}`, sourceType: "consumption", sourceId: dayKey(c.day), sourceRef: `Consumption ${c.day}`, date: c.day, lines }, problems };
}
