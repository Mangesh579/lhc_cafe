// Dry run for retiring monthly accounts: how each open monthly-account bill would be split into
// individual credit invoices, one per visit. Pure functions only: nothing here reads or writes the database.
import { round2 } from "./payments";
import { nepalDay } from "./ledgerData";

// How KOTs are grouped into one invoice.
//  visit: same Nepal day and same table label (the working reading of "one per visit")
//  kot:   one invoice per KOT
//  day:   one invoice per Nepal day, whatever the table
export type GroupBy = "visit" | "kot" | "day";

export type BillIn = {
  id: number; customerId: number | null; customerName: string | null; customerPhone: string | null; customerPaysMonthly: boolean | null;
  createdAt: Date; backdatedAt: Date | null; totalAmount: number; discountAmount: number; vatAmount: number;
  invoiceNumber: string | null; isNc: boolean; paymentStatus: string; notes: string | null; paymentRows: number;
};
export type ItemIn = {
  id: number; orderId: number; name: string; quantity: number; unitPrice: number; subtotal: number;
  kotNumber: number; kotAt: Date | null; kotTable: string | null; kotBy: string | null; kotNote: string | null;
};
export type CancelIn = { orderId: number; kotNumber: number; itemsText: string; amount: number; reason: string | null; cancelledBy: string; cancelledAt: Date };
export type RedemptionIn = { orderId: number; level: number; redeemedAt: Date };

export type Issue = { level: "blocker" | "check"; code: string; message: string };

export type PlannedKot = { kot: number; at: string | null; day: string; table: string; by: string | null; note: string | null; items: { name: string; quantity: number; unitPrice: number; subtotal: number }[]; subtotal: number };
export type PlannedInvoice = { key: string; day: string; table: string; firstAt: string | null; lastAt: string | null; fiscalYear: string; kots: PlannedKot[]; subtotal: number; discountShare: number; total: number };
export type PlannedBill = {
  billId: number; customer: { id: number | null; name: string | null; phone: string | null; paysMonthly: boolean | null };
  openedAt: string; itemsSubtotal: number; discount: number; vat: number; billTotal: number; kotCount: number;
  invoices: PlannedInvoice[]; invoicesTotal: number; cancelledKots: CancelIn[]; redemptions: RedemptionIn[]; issues: Issue[]; clean: boolean;
};

const UNKNOWN_TABLE = "(table not recorded)";

// Splits a discount across invoices in proportion to their subtotals, to the paisa, so the shares add up exactly.
export function allocateDiscount(subtotals: number[], discount: number): number[] {
  const total = subtotals.reduce((s, x) => s + x, 0);
  if (!(discount > 0) || !(total > 0)) return subtotals.map(() => 0);
  const paise = Math.round(discount * 100);
  const raw = subtotals.map(s => (s / total) * paise);
  const base = raw.map(Math.floor);
  let left = paise - base.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) { if (left <= 0) break; base[o.i]++; left--; }
  return base.map(p => p / 100);
}

export function planBill(
  bill: BillIn, items: ItemIn[], cancels: CancelIn[], redemptions: RedemptionIn[],
  opts: { groupBy: GroupBy; fiscalYearOf: (d: Date) => string; currentFiscalYear: string; otherOpenBills: number },
): PlannedBill {
  const issues: Issue[] = [];
  const add = (level: Issue["level"], code: string, message: string) => issues.push({ level, code, message });

  // ── the bill itself ──
  if (!bill.customerId || !bill.customerName) add("blocker", "no_customer", "The bill has no customer on the loyalty list, so it cannot become credit invoices.");
  else if (bill.customerPaysMonthly === false) add("check", "not_monthly", "The customer is no longer marked as a monthly account.");
  if (bill.paymentStatus !== "pending") add("blocker", "not_open", `The bill is ${bill.paymentStatus}, not open.`);
  if (bill.invoiceNumber) add("blocker", "has_invoice", `The bill already has invoice number ${bill.invoiceNumber}.`);
  if (bill.paymentRows > 0) add("blocker", "has_payments", "The bill already has payment rows.");
  if (bill.isNc) add("blocker", "is_nc", "The bill is marked Not Chargeable.");
  if (bill.vatAmount > 0) add("check", "has_vat", `The bill carries VAT of Rs. ${bill.vatAmount.toFixed(2)}; VAT is not yet split per invoice.`);
  if (bill.backdatedAt) add("check", "backdated", "The bill was logged as a missed (backdated) order.");
  if (opts.otherOpenBills > 0) add("check", "several_open", `The customer has ${opts.otherOpenBills + 1} open monthly-account bills; normally there is one.`);
  if (items.length === 0) add(bill.totalAmount > 0 ? "blocker" : "check", "no_items", bill.totalAmount > 0 ? `The bill has no items but a total of Rs. ${bill.totalAmount.toFixed(2)}.` : "The bill has no items (nothing to convert).");

  // ── items and KOTs ──
  const noTime = items.filter(i => !i.kotAt);
  if (noTime.length) add("check", "no_kot_time", `${noTime.length} item(s) have no KOT time; the bill's opening time (${bill.createdAt.toISOString()}) is used for them.`);
  const noTable = items.filter(i => !i.kotTable);
  if (noTable.length && opts.groupBy === "visit") add("check", "no_table", `${noTable.length} item(s) have no table recorded; they are grouped as "${UNKNOWN_TABLE}".`);
  const badLine = items.filter(i => Math.abs(round2(i.unitPrice * i.quantity) - i.subtotal) >= 0.005);
  if (badLine.length) add("check", "line_mismatch", `${badLine.length} item line(s) where price x quantity differs from the line total (${badLine.map(i => `#${i.id} ${i.name}`).join(", ")}).`);
  if (items.some(i => i.quantity <= 0 || i.subtotal < 0)) add("blocker", "bad_line", "Some item lines have a zero or negative quantity or amount.");

  const kots = new Map<number, ItemIn[]>();
  for (const it of items) kots.set(it.kotNumber ?? 1, [...(kots.get(it.kotNumber ?? 1) ?? []), it]);
  const plannedKots: PlannedKot[] = [];
  for (const [kot, its] of [...kots.entries()].sort((a, b) => a[0] - b[0])) {
    const times = its.map(i => (i.kotAt ?? bill.createdAt).getTime());
    const at = new Date(Math.min(...times));
    const days = new Set(its.map(i => nepalDay(i.kotAt ?? bill.createdAt)));
    const tables = new Set(its.map(i => i.kotTable ?? UNKNOWN_TABLE));
    if (days.size > 1) add("check", "kot_split_days", `KOT ${kot} has items on different days (${[...days].join(", ")}); the earliest is used.`);
    if (tables.size > 1) add("check", "kot_split_tables", `KOT ${kot} has items from different tables (${[...tables].join(", ")}); the first is used.`);
    plannedKots.push({
      kot, at: at.toISOString(), day: nepalDay(at), table: its[0].kotTable ?? UNKNOWN_TABLE, by: its[0].kotBy, note: its[0].kotNote,
      items: its.map(i => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, subtotal: round2(i.subtotal) })),
      subtotal: round2(its.reduce((s, i) => s + i.subtotal, 0)),
    });
  }

  // ── group KOTs into invoices ──
  const keyOf = (k: PlannedKot) => opts.groupBy === "kot" ? `${k.day}|KOT ${k.kot}` : opts.groupBy === "day" ? k.day : `${k.day}|${k.table}`;
  const groups = new Map<string, PlannedKot[]>();
  for (const k of plannedKots) groups.set(keyOf(k), [...(groups.get(keyOf(k)) ?? []), k]);
  const ordered = [...groups.entries()].sort((a, b) => (a[1][0].at ?? "").localeCompare(b[1][0].at ?? ""));
  const subtotals = ordered.map(([, ks]) => round2(ks.reduce((s, k) => s + k.subtotal, 0)));
  const shares = allocateDiscount(subtotals, bill.discountAmount);
  const invoices: PlannedInvoice[] = ordered.map(([key, ks], i) => {
    const times = ks.map(k => k.at).filter((x): x is string => !!x).sort();
    const first = times[0] ?? null;
    return {
      key, day: ks[0].day, table: opts.groupBy === "day" ? [...new Set(ks.map(k => k.table))].join(", ") : ks[0].table,
      firstAt: first, lastAt: times[times.length - 1] ?? null, fiscalYear: opts.fiscalYearOf(new Date(first ?? bill.createdAt)),
      kots: ks, subtotal: subtotals[i], discountShare: shares[i], total: round2(subtotals[i] - shares[i]),
    };
  });

  // ── totals and amounts ──
  const itemsSubtotal = round2(items.reduce((s, i) => s + i.subtotal, 0));
  const invoicesTotal = round2(invoices.reduce((s, x) => s + x.total, 0));
  const expectedTotal = round2(itemsSubtotal - bill.discountAmount + bill.vatAmount);
  if (Math.abs(expectedTotal - bill.totalAmount) >= 0.01) {
    add("blocker", "total_mismatch", `The bill total (Rs. ${bill.totalAmount.toFixed(2)}) does not equal its items (Rs. ${itemsSubtotal.toFixed(2)}) minus discount (Rs. ${bill.discountAmount.toFixed(2)})${bill.vatAmount > 0 ? ` plus VAT (Rs. ${bill.vatAmount.toFixed(2)})` : ""}. Difference Rs. ${(bill.totalAmount - expectedTotal).toFixed(2)}.`);
  }
  if (bill.discountAmount > 0 && invoices.length > 1) {
    add("check", "discount_split", `A discount of Rs. ${bill.discountAmount.toFixed(2)} is recorded for the whole bill, not per visit; it is shared across the ${invoices.length} invoices in proportion to their amounts.`);
  }
  if (invoices.some(x => x.total <= 0)) add("blocker", "zero_invoice", "After the discount, an invoice would be Rs. 0 or less.");
  if (redemptions.length) add("check", "redemptions", `${redemptions.length} loyalty reward(s) were redeemed on this bill (level ${redemptions.map(r => r.level).join(", ")}); decide which invoice each belongs to.`);
  const oldFy = invoices.filter(x => x.fiscalYear !== opts.currentFiscalYear);
  if (oldFy.length) add("check", "old_fiscal_year", `${oldFy.length} visit(s) fall in an earlier fiscal year (${[...new Set(oldFy.map(x => x.fiscalYear))].join(", ")}).`);

  return {
    billId: bill.id,
    customer: { id: bill.customerId, name: bill.customerName, phone: bill.customerPhone, paysMonthly: bill.customerPaysMonthly },
    openedAt: bill.createdAt.toISOString(), itemsSubtotal, discount: round2(bill.discountAmount), vat: round2(bill.vatAmount), billTotal: round2(bill.totalAmount),
    kotCount: plannedKots.length, invoices, invoicesTotal, cancelledKots: cancels, redemptions, issues,
    clean: !issues.some(i => i.level === "blocker"),
  };
}

export function summarise(bills: PlannedBill[]) {
  return {
    bills: bills.length,
    customers: new Set(bills.map(b => b.customer.id)).size,
    kots: bills.reduce((s, b) => s + b.kotCount, 0),
    invoices: bills.reduce((s, b) => s + b.invoices.length, 0),
    total: round2(bills.reduce((s, b) => s + b.billTotal, 0)),
    invoicesTotal: round2(bills.reduce((s, b) => s + b.invoicesTotal, 0)),
    cleanBills: bills.filter(b => b.clean).length,
    blockedBills: bills.filter(b => !b.clean).length,
    billsWithChecks: bills.filter(b => b.issues.some(i => i.level === "check")).length,
  };
}
