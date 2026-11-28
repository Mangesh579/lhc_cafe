// Step 4a: drill-down (docs/specs/step4-reports.md section 3). A journal line opens its entry; an entry opens its source
// document. The document is shown read-only here (its own fields, not ledger figures) with a link to its page; only the
// purchase bill page opens one document from the URL today (/suppliers?bill=<id>). Read-only: SELECTs only.
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { round2 } from "../payments";
import { bsLabel } from "../fiscal";
import { kindOf } from "./books";

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const dayOf = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
const rows = async (q: SQL): Promise<any[]> => ((await db.execute(q)) as any).rows;
const keyDay = (k: number) => `${String(k).slice(0, 4)}-${String(k).slice(4, 6)}-${String(k).slice(6, 8)}`;
const at = (v: unknown) => v ? new Date(v as any).toISOString().slice(0, 16).replace("T", " ") + " UTC" : null;

// Every source_type the posting rules use, and where its document lives. A test checks this covers them all.
export const SOURCE_LINKS: Record<string, { page: string; label: string; path: (id: number) => string }> = {
  order: { page: "Order Log", label: "Sale (invoice)", path: () => "/order-log" },
  credit_note: { page: "Receivables", label: "Credit note", path: () => "/receivables" },
  receipt: { page: "Receivables", label: "Receipt voucher", path: () => "/receivables" },
  settlement: { page: "Settlements", label: "Settlement", path: () => "/settlements" },
  purchase_bill: { page: "Suppliers", label: "Purchase bill", path: (id) => `/suppliers?bill=${id}` },
  supplier_payment: { page: "Suppliers", label: "Supplier payment", path: () => "/suppliers" },
  debit_note: { page: "Suppliers", label: "Debit note", path: () => "/suppliers" },
  expense: { page: "Expenses", label: "Expense", path: () => "/expenses" },
  cash_movement: { page: "Cash Drawer", label: "Drawer movement", path: () => "/cash-drawer" },
  cash_close: { page: "Cash Drawer", label: "Drawer close", path: () => "/cash-drawer" },
  consumption: { page: "Reports", label: "Consumption of the day", path: (id) => `/reports?consumption=${keyDay(id)}` },
  stock_adjustment: { page: "Inventory", label: "Stock adjustment (Stock Log)", path: () => "/inventory" },
  opening: { page: "Chart of Accounts", label: "Opening balances", path: () => "/chart-of-accounts" },
  tax_payment: { page: "Chart of Accounts", label: "Tax payment (TDS deposit)", path: () => "/chart-of-accounts" },
};
const MANUAL_LINK = { page: "Chart of Accounts", label: "Journal voucher", path: () => "/chart-of-accounts" };
export const linkFor = (sourceType: string | null, sourceId: number | null) => {
  const l = sourceType ? SOURCE_LINKS[sourceType] : MANUAL_LINK;
  return l ? { type: sourceType, id: sourceId, page: l.page, label: l.label, path: l.path(sourceId ?? 0), viewable: !!sourceType && sourceType !== "opening" } : null;
};

async function linesWithNames(entryIds: number[]) {
  if (!entryIds.length) return new Map<number, any[]>();
  const r = await rows(sql`SELECT jl.*, a.name AS account_name, c.name AS customer_name, s.name AS supplier_name FROM journal_lines jl
    JOIN accounts a ON a.code = jl.account_code LEFT JOIN loyalty_customers c ON c.id = jl.customer_id LEFT JOIN suppliers s ON s.id = jl.supplier_id
    WHERE jl.entry_id IN (${sql.join(entryIds.map(i => sql`${i}`), sql`, `)}) ORDER BY jl.entry_id, jl.line_no`);
  const m = new Map<number, any[]>();
  for (const l of r) m.set(Number(l.entry_id), [...(m.get(Number(l.entry_id)) ?? []), { accountCode: l.account_code, accountName: l.account_name, debit: num(l.debit), credit: num(l.credit), memo: l.memo, customerName: l.customer_name, supplierName: l.supplier_name }]);
  return m;
}
const entryOut = (e: any, lines: any[]) => ({ id: Number(e.id), entryNo: e.entry_no, date: dayOf(e.entry_date), dateBs: bsLabel(dayOf(e.entry_date)), voucherType: e.voucher_type, kind: kindOf(e),
  narration: e.narration, sourceType: e.source_type, sourceId: e.source_id == null ? null : Number(e.source_id), sourceRef: e.source_ref, revision: e.revision, createdBy: e.created_by, createdAt: e.created_at, lines });

// One entry: its lines, what it reverses or what reversed it, the other revisions of the same source, and the source link
export async function entryDetail(id: number) {
  const [e] = await rows(sql`SELECT * FROM journal_entries WHERE id = ${id}`);
  if (!e) return null;
  const related = e.source_type ? await rows(sql`SELECT * FROM journal_entries WHERE source_type = ${e.source_type} AND source_id = ${e.source_id} AND id <> ${id} ORDER BY id`)
    : await rows(sql`SELECT * FROM journal_entries WHERE (id = ${e.reverses_entry_id ?? -1} OR reverses_entry_id = ${id}) ORDER BY id`);
  const lines = await linesWithNames([id]);
  return {
    entry: entryOut(e, lines.get(id) ?? []),
    reverses: e.reverses_entry_id ? related.find(r => Number(r.id) === Number(e.reverses_entry_id)) ? { id: Number(e.reverses_entry_id), entryNo: related.find(r => Number(r.id) === Number(e.reverses_entry_id))!.entry_no } : { id: Number(e.reverses_entry_id), entryNo: null } : null,
    reversedBy: (() => { const r = related.find(x => Number(x.reverses_entry_id) === id); return r ? { id: Number(r.id), entryNo: r.entry_no, date: dayOf(r.entry_date) } : null; })(),
    related: related.map(r => ({ id: Number(r.id), entryNo: r.entry_no, date: dayOf(r.entry_date), kind: kindOf(r), revision: r.revision, narration: r.narration })),
    source: linkFor(e.source_type, e.source_id == null ? null : Number(e.source_id)),
  };
}

// The source document, read-only: a title, its fields and its items
type Doc = { title: string; fields: [string, string | number | null][]; items?: { cols: string[]; rows: (string | number | null)[][] } };
const one = async (q: SQL) => (await rows(q))[0];
export async function sourceDocument(type: string, id: number): Promise<Doc | null> {
  const rs = (v: unknown) => v == null ? null : round2(num(v));
  switch (type) {
    case "order": {
      const o = await one(sql`SELECT o.*, c.name AS customer FROM orders o LEFT JOIN loyalty_customers c ON c.id = o.loyalty_customer_id WHERE o.id = ${id}`);
      if (!o) return null;
      const it = await rows(sql`SELECT oi.quantity, oi.unit_price, oi.subtotal, m.name FROM order_items oi LEFT JOIN menu_items m ON m.id = oi.menu_item_id WHERE oi.order_id = ${id} ORDER BY oi.id`);
      return { title: `Invoice ${o.invoice_number ?? `#${id}`}`, fields: [["Paid", at(o.paid_at)], ["Payment", o.payment_method], ["Customer", o.customer], ["Discount", rs(o.discount_amount)], ["VAT", rs(o.vat_amount)], ["Total", rs(o.total_amount)], ["Status", o.payment_status], ["NC for", o.nc_person_name]],
        items: { cols: ["Item", "Qty", "Price", "Amount"], rows: it.map(i => [i.name, Number(i.quantity), rs(i.unit_price), rs(i.subtotal)]) } };
    }
    case "credit_note": {
      const n = await one(sql`SELECT n.*, c.name AS customer, o.invoice_number FROM credit_notes n LEFT JOIN loyalty_customers c ON c.id = n.customer_id LEFT JOIN orders o ON o.id = n.order_id WHERE n.id = ${id}`);
      if (!n) return null;
      const it = await rows(sql`SELECT description, quantity, amount FROM credit_note_items WHERE note_id = ${id} ORDER BY id`);
      return { title: `Credit note ${n.note_no}`, fields: [["Date", dayOf(n.note_date)], ["Against invoice", n.invoice_number], ["Customer", n.customer], ["Kind", n.kind], ["Reason", n.reason], ["VAT", rs(n.vat_amount)], ["Total", rs(n.total)], ["Status", n.status], ["Void reason", n.void_reason]],
        items: { cols: ["Item", "Qty", "Amount"], rows: it.map(i => [i.description, Number(i.quantity), rs(i.amount)]) } };
    }
    case "receipt": {
      const r = await one(sql`SELECT r.*, c.name AS customer FROM customer_receipts r LEFT JOIN loyalty_customers c ON c.id = r.customer_id WHERE r.id = ${id}`);
      return r ? { title: `Receipt ${r.voucher_no}`, fields: [["Date", dayOf(r.receipt_date)], ["Customer", r.customer], ["Mode", r.mode], ["Bank", r.bank_account], ["Reference", r.reference], ["Amount", rs(r.amount)], ["Status", r.status], ["Void reason", r.void_reason]] } : null;
    }
    case "settlement": {
      const s = await one(sql`SELECT * FROM settlements WHERE id = ${id}`);
      return s ? { title: `Settlement #${id}`, fields: [["Machine", s.machine], ["Sales day", dayOf(s.sales_day)], ["Settled on", dayOf(s.settled_on)], ["Bank", s.bank_account], ["Gross", rs(s.gross)], ["Received", rs(s.received)], ["Charge", rs(s.charge)], ["Reference", s.reference], ["Status", s.status]] } : null;
    }
    case "purchase_bill": {
      const b = await one(sql`SELECT * FROM purchase_bills WHERE id = ${id}`);
      if (!b) return null;
      const it = await rows(sql`SELECT item_name, quantity, unit, rate, line_total FROM purchase_bill_items WHERE bill_id = ${id} ORDER BY id`);
      return { title: `Purchase bill ${b.pj_number}`, fields: [["Supplier", b.supplier_name], ["PAN", b.supplier_pan], ["Bill no.", b.bill_number], ["Date", dayOf(b.bill_date)], ["Terms", b.terms], ["Paid via", b.paid_via], ["Total", rs(b.total)], ["Status", b.status]],
        items: { cols: ["Item", "Qty", "Rate", "Amount"], rows: it.map(i => [i.item_name, `${num(i.quantity)} ${i.unit ?? ""}`.trim(), rs(i.rate), rs(i.line_total)]) } };
    }
    case "supplier_payment": {
      const p = await one(sql`SELECT p.*, s.name AS supplier FROM supplier_payments p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ${id}`);
      return p ? { title: `Supplier payment ${p.voucher_no}`, fields: [["Supplier", p.supplier], ["Date", dayOf(p.payment_date)], ["Paid via", p.paid_via], ["From account", p.paid_from_account], ["Reference", p.reference], ["Amount", rs(p.amount)], ["Status", p.status]] } : null;
    }
    case "debit_note": {
      const n = await one(sql`SELECT n.*, s.name AS supplier FROM debit_notes n LEFT JOIN suppliers s ON s.id = n.supplier_id WHERE n.id = ${id}`);
      if (!n) return null;
      const it = await rows(sql`SELECT item_name, quantity, unit, line_total FROM debit_note_items WHERE debit_note_id = ${id} ORDER BY id`);
      return { title: `Debit note ${n.note_no}`, fields: [["Supplier", n.supplier], ["Date", dayOf(n.note_date)], ["Reason", n.reason], ["Total", rs(n.total)], ["Status", n.status]],
        items: { cols: ["Item", "Qty", "Amount"], rows: it.map(i => [i.item_name, `${num(i.quantity)} ${i.unit ?? ""}`.trim(), rs(i.line_total)]) } };
    }
    case "expense": {
      const x = await one(sql`SELECT * FROM expenses WHERE id = ${id}`);
      return x ? { title: `Expense #${id}${x.voucher_no ? ` (${x.voucher_no})` : ""}`, fields: [["Date", dayOf(x.expense_date)], ["Category", x.category], ["Vendor", x.vendor], ["Description", x.description], ["Bill no.", x.bill_number], ["Paid by", x.payment_method], ["From the drawer", x.paid_from_drawer ? "yes" : "no"], ["Bank", x.bank_account], ["Amount", rs(x.amount)], ["Status", x.status]] } : null;
    }
    case "cash_movement": {
      const m = await one(sql`SELECT * FROM cash_movements WHERE id = ${id}`);
      return m ? { title: `Drawer movement #${id}`, fields: [["Day", dayOf(m.day)], ["Kind", m.kind], ["Amount", rs(m.amount)], ["Bank", m.bank_account], ["Account", m.account_code], ["Description", m.description], ["Reference", m.reference], ["Status", m.status]] } : null;
    }
    case "cash_close": {
      const d = await one(sql`SELECT * FROM cash_days WHERE day = ${keyDay(id)}`);
      return d ? { title: `Drawer of ${keyDay(id)}`, fields: [["Opening", rs(d.opening_balance)], ["Expected", rs(d.expected_closing)], ["Counted", rs(d.counted_closing)], ["Difference", rs(d.difference)], ["Status", d.status], ["Note", d.note], ["Closed by", d.closed_by]] } : null;
    }
    case "stock_adjustment": {
      const l = await one(sql`SELECT l.*, i.name, i.unit, i.department FROM inventory_logs l LEFT JOIN inventory_items i ON i.id = l.inventory_item_id WHERE l.id = ${id}`);
      return l ? { title: `Stock adjustment #${id}`, fields: [["Ingredient", l.name], ["Department", l.department], ["Change", `${num(l.change_amount)} ${l.unit ?? ""}`.trim()], ["Stock before", num(l.stock_before)], ["Stock after", num(l.stock_after)], ["Cost per unit", l.unit_cost == null ? null : num(l.unit_cost)], ["Reason", l.reason], ["By", l.changed_by], ["When", at(l.created_at)]] } : null;
    }
    case "tax_payment": {
      const t = await one(sql`SELECT * FROM tax_payments WHERE id = ${id}`);
      return t ? { title: `Tax payment ${t.voucher_no}`, fields: [["Kind", t.kind === "tds_deposit" ? "TDS deposit" : "VAT payment"], ["For", `${t.bs_year}-${String(t.bs_month).padStart(2, "0")}`], ["Paid on", dayOf(t.payment_date)], ["Bank", t.bank_account], ["Reference", t.reference], ["Amount", rs(t.amount)], ["Status", t.status], ["Void reason", t.void_reason]] } : null;
    }
    case "consumption": {
      const c = await consumptionView(keyDay(id));
      return { title: `Consumption of ${keyDay(id)}`, fields: [["Entries", c.entries.length], ["In force", c.entries.find(e => e.inForce)?.entryNo ?? null]] };
    }
    default: return null;
  }
}

// The Consumption view: every consumption entry of a day (the posted one, any reversal and correction), from the journal
export async function consumptionView(day: string) {
  const key = Number(day.replace(/-/g, ""));
  const es = await rows(sql`SELECT * FROM journal_entries WHERE source_type = 'consumption' AND source_id = ${key} ORDER BY id`);
  const lines = await linesWithNames(es.map(e => Number(e.id)));
  const reversed = new Set(es.filter(e => e.reverses_entry_id).map(e => Number(e.reverses_entry_id)));
  return { day, dayBs: bsLabel(day), entries: es.map(e => ({ ...entryOut(e, lines.get(Number(e.id)) ?? []), inForce: e.kind === "post" && !reversed.has(Number(e.id)) })) };
}
