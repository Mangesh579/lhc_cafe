import { Router } from "express";
import type { Response } from "express";
import { db, cashDaysTable, cashMovementsTable, expensesTable, creditNotesTable, loyaltyCustomersTable, settlementsTable } from "@workspace/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { isDay, dayRangeUtc, paidOrdersBetween, modeOf, nepalDay, addDays, collectionsByDay, receiptsBetween, creditNotesBetween, reissuedOrderIds, sulimhaTransfersBetween, type CollectionRow } from "../lib/ledgerData";
import { MODE_LABEL } from "../lib/payments";
import { supplierPaymentsBetween, bankPaidBillsBetween } from "../lib/supplierPaymentsRead";

const router = Router();
const LEDGER_ROLES = ["admin", "accountant", "supervisor"];
const LEDGER_MODES = ["cash", "qr", "card", "bank", "credit", "other"];
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => parseFloat(String(v));
const IN_KINDS = ["other_in"];
const KIND_LABEL: Record<string, string> = { deposit: "Deposit to bank", owner_draw: "Owner withdrawal", other_in: "Other cash in", other_out: "Other cash out" };

function allowed(req: AuthRequest, res: Response): boolean {
  if (!LEDGER_ROLES.includes((req.user?.role as string | undefined) ?? "")) { res.status(403).json({ error: "Not allowed" }); return false; }
  return true;
}
function range(req: AuthRequest) {
  const to = isDay(req.query.to) ? req.query.to : nepalDay(new Date());
  const from = isDay(req.query.from) ? req.query.from : addDays(to, -29);
  return { from, to };
}
const saleRef = (o: { id: number; invoiceNumber?: string | null }) => `Sale #${o.id}${o.invoiceNumber ? ` · ${o.invoiceNumber}` : ""}`;

// Per day: bills by payment mode (from order_payments, falling back to payment_method), customer receipts, money received
router.get("/ledger/collections", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!allowed(req, res)) return;
  const { from, to } = range(req);
  if (from > to) { res.status(400).json({ error: "The start date is after the end date." }); return; }
  const orders = await paidOrdersBetween(dayRangeUtc(from).from, dayRangeUtc(to).to);
  const receipts = await receiptsBetween(from, to);
  const rows = collectionsByDay(orders, receipts, { notes: await creditNotesBetween(from, to), reissued: await reissuedOrderIds(), sulimhaTransfers: await sulimhaTransfersBetween(from, to) });
  const totals: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (typeof v === "number") totals[k] = (totals[k] ?? 0) + v;
  for (const k of Object.keys(totals)) if (k !== "orders") totals[k] = round2(totals[k]);
  // "total" kept for older screens: it is the money received (credit excluded)
  res.json({ from, to, rows: rows.map((r: CollectionRow) => ({ ...r, total: r.received })), totals: { ...totals, total: totals.received ?? 0 } });
});

async function cashLedger(from: string, to: string) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const dayRows = await db.select().from(cashDaysTable).where(and(gte(cashDaysTable.day, from), lte(cashDaysTable.day, to)));
  const dayMap = new Map(dayRows.map(r => [r.day, r]));
  const orders = await paidOrdersBetween(dayRangeUtc(from).from, dayRangeUtc(to).to);
  const sales = orders
    .map(o => ({ o, amount: round2(o.parts.filter(p => modeOf(p.mode) === "cash").reduce((s, p) => s + p.amount, 0)) }))
    .filter(x => x.amount > 0);
  const receipts = await receiptsBetween(from, to, "cash");
  const supplierCash = await supplierPaymentsBetween(from, to, ["drawer"]);
  const exps = await db.select().from(expensesTable).where(and(
    gte(expensesTable.expenseDate, from), lte(expensesTable.expenseDate, to), eq(expensesTable.status, "active"), eq(expensesTable.paidFromDrawer, true)));
  const moves = await db.select().from(cashMovementsTable).where(and(
    gte(cashMovementsTable.day, from), lte(cashMovementsTable.day, to), eq(cashMovementsTable.status, "active")));

  const entries: any[] = [];
  let bal = 0, started = false;
  for (const day of days) {
    const rec = dayMap.get(day);
    const items: { t: number; type: string; ref: string; description: string; amount: number; dir: "in" | "out" }[] = [
      ...sales.filter(x => nepalDay(x.o.at) === day).map(x => ({ t: x.o.at.getTime(), type: "sale", ref: saleRef(x.o), description: x.o.parts.length > 1 ? "Cash part of a split bill" : "Cash sale", amount: x.amount, dir: "in" as const })),
      ...receipts.filter(r => r.receiptDate === day).map(r => ({ t: r.createdAt.getTime(), type: "receipt", ref: r.voucherNo, description: `Received from ${r.customerName ?? `customer #${r.customerId}`}`, amount: r.amount, dir: "in" as const })),
      ...supplierCash.filter(p => p.paymentDate === day).map(p => ({ t: new Date(p.createdAt).getTime(), type: "supplier_payment", ref: p.voucherNo, description: `Paid to ${p.supplierName}`, amount: p.amount, dir: "out" as const })),
      ...exps.filter(e => e.expenseDate === day).map(e => ({ t: new Date(e.createdAt).getTime(), type: "payout", ref: `Expense #${e.id}`, description: `${e.category}${e.vendor ? ` · ${e.vendor}` : ""}`, amount: num(e.amount), dir: "out" as const })),
      ...moves.filter(m => m.day === day).map(m => ({ t: new Date(m.createdAt).getTime(), type: m.kind, ref: m.reference ?? "", description: `${KIND_LABEL[m.kind] ?? m.kind}${m.description ? ` · ${m.description}` : ""}`, amount: num(m.amount), dir: (IN_KINDS.includes(m.kind) ? "in" : "out") as "in" | "out" })),
    ].sort((a, b) => a.t - b.t);
    if (!rec && items.length === 0) continue;

    if (rec) {
      const op = num(rec.openingBalance);
      if (!started) {
        bal = op; started = true;
        entries.push({ day, time: null, type: "opening", ref: "", description: "Opening balance", inAmt: round2(op), outAmt: 0, balance: round2(bal) });
      } else if (Math.abs(op - bal) > 0.004) {
        const d = op - bal; bal = op;
        entries.push({ day, time: null, type: "adjustment", ref: "", description: "Opening differs from the previous closing", inAmt: d > 0 ? round2(d) : 0, outAmt: d < 0 ? round2(-d) : 0, balance: round2(bal) });
      }
    }
    for (const it of items) {
      bal += it.dir === "in" ? it.amount : -it.amount;
      entries.push({ day, time: new Date(it.t).toISOString(), type: it.type, ref: it.ref, description: it.description, inAmt: it.dir === "in" ? round2(it.amount) : 0, outAmt: it.dir === "out" ? round2(it.amount) : 0, balance: round2(bal) });
    }
    if (rec?.status === "closed" && rec.difference != null && Math.abs(num(rec.difference)) >= 0.005) {
      const d = num(rec.difference); bal += d;
      entries.push({ day, time: null, type: "shortover", ref: "", description: d < 0 ? "Cash short at day close" : "Cash over at day close", inAmt: d > 0 ? round2(d) : 0, outAmt: d < 0 ? round2(-d) : 0, balance: round2(bal) });
    }
    if (rec?.status === "closed") {
      entries.push({ day, time: null, type: "closing", ref: "", description: `Day closed. Counted ${round2(num(rec.countedClosing))}`, inAmt: 0, outAmt: 0, balance: round2(bal) });
    }
  }
  return entries;
}

// QR, card, bank, credit and other: bill parts in that mode, plus customer receipts where they apply.
// The credit ledger is the receivable control: credit sales in, customer receipts (any mode) out.
async function modeLedger(mode: string, from: string, to: string) {
  const orders = await paidOrdersBetween(dayRangeUtc(from).from, dayRangeUtc(to).to);
  const items: { t: number; day: string; type: string; ref: string; description: string; inAmt: number; outAmt: number }[] = [];
  if (mode !== "bank") {
    for (const o of orders) {
      for (const p of o.parts) {
        if (modeOf(p.mode) !== mode) continue;
        const what = mode === "credit" ? "Credit sale (receivable)" : `${MODE_LABEL[p.mode] ?? p.mode}${o.parts.length > 1 ? " · part of a split bill" : ""}`;
        items.push({ t: o.at.getTime(), day: nepalDay(o.at), type: "sale", ref: saleRef(o), description: `${what}${p.reference ? ` · ref ${p.reference}` : ""}`, inAmt: p.amount, outAmt: 0 });
      }
    }
  }
  const receiptMode = mode === "qr" ? "nabil_qr" : mode === "bank" ? "bank" : mode === "credit" || mode === "card" ? undefined : null;
  if (receiptMode !== null) {
    for (const r of await receiptsBetween(from, to, receiptMode)) {
      if (mode === "card" && modeOf(r.mode) !== "card") continue; // card receipts (hotel check-out) on the card ledger
      const who = r.customerName ?? `customer #${r.customerId}`;
      if (mode === "credit") items.push({ t: r.createdAt.getTime(), day: r.receiptDate, type: "receipt", ref: r.voucherNo, description: `Received from ${who} (${MODE_LABEL[r.mode] ?? (r.mode === "bank" ? "Bank" : r.mode)})`, inAmt: 0, outAmt: r.amount });
      else items.push({ t: r.createdAt.getTime(), day: r.receiptDate, type: "receipt", ref: r.voucherNo, description: `Received from ${who}`, inAmt: r.amount, outAmt: 0 });
    }
  }
  if (mode === "credit") {
    const notes = await db.select({ noteNo: creditNotesTable.noteNo, noteDate: creditNotesTable.noteDate, total: creditNotesTable.total, createdAt: creditNotesTable.createdAt, customerName: loyaltyCustomersTable.name, reason: creditNotesTable.reason })
      .from(creditNotesTable).leftJoin(loyaltyCustomersTable, eq(creditNotesTable.customerId, loyaltyCustomersTable.id))
      .where(and(eq(creditNotesTable.status, "active"), gte(creditNotesTable.noteDate, from), lte(creditNotesTable.noteDate, to)));
    for (const n of notes) {
      items.push({ t: new Date(n.createdAt).getTime(), day: n.noteDate, type: "credit_note", ref: n.noteNo, description: `Credit note · ${n.customerName ?? ""} · ${n.reason}`, inAmt: 0, outAmt: num(n.total) });
    }
  }
  if (mode === "bank") {
    // Money out of the bank: supplier payments by cheque or online (PV) and bills paid by cheque or online when bought
    const bankName = (a: string | null) => a === "hbl" ? "HBL" : a === "nabil" ? "Nabil Bank" : "bank";
    for (const p of await supplierPaymentsBetween(from, to, ["cheque", "online"])) {
      items.push({ t: new Date(p.createdAt).getTime(), day: p.paymentDate, type: "supplier_payment", ref: p.voucherNo, description: `Paid to ${p.supplierName} by ${p.paidVia === "cheque" ? "cheque" : "online transfer"} ${p.reference ?? ""} from ${bankName(p.paidFromAccount)}`, inAmt: 0, outAmt: p.amount });
    }
    for (const b of await bankPaidBillsBetween(from, to)) {
      items.push({ t: new Date(b.createdAt).getTime(), day: b.billDate, type: "purchase", ref: b.pjNumber, description: `Purchase bill ${b.billNumber} from ${b.supplierName}, ${b.paidVia === "cheque" ? "cheque" : "online"} ${b.paymentReference ?? ""} from ${bankName(b.paidFromAccount)}`, inAmt: 0, outAmt: b.total });
    }
  }
  if (mode === "card" || mode === "qr" || mode === "bank") {
    // Settlements: card/QR money leaves the machine's ledger (to the bank, and the bank charge) and arrives in the bank
    const cards = ["nabil_pos", "hbl_pos", "sulimha_nabil_pos", "sulimha_hbl_pos"];
    const machines = mode === "card" ? cards : mode === "qr" ? ["qr"] : [...cards, "qr"];
    const rows = await db.select().from(settlementsTable)
      .where(and(eq(settlementsTable.status, "active"), gte(settlementsTable.settledOn, from), lte(settlementsTable.settledOn, to)));
    const LABEL: Record<string, string> = { nabil_pos: "Card - LHC Nabil POS", hbl_pos: "Card - LHC HBL POS", sulimha_nabil_pos: "Card - Sulimha Nabil POS", sulimha_hbl_pos: "Card - Sulimha HBL POS", qr: "QR Payment" };
    const label = (m: string) => LABEL[m] ?? m;
    const via = (m: string) => m.startsWith("sulimha_") ? " (transferred by Sulimha Durbar)" : "";
    const bank = (b: string) => b === "hbl" ? "HBL" : "Nabil Bank";
    for (const st of rows.filter(r => machines.includes(r.machine))) {
      const t = new Date(st.createdAt).getTime();
      if (mode === "bank") {
        items.push({ t, day: st.settledOn, type: "settlement", ref: st.reference, description: `${label(st.machine)} settlement of ${st.salesDay} into ${bank(st.bankAccount)}${via(st.machine)}`, inAmt: num(st.received), outAmt: 0 });
      } else {
        items.push({ t, day: st.settledOn, type: "settlement", ref: st.reference, description: `${label(st.machine)} sales of ${st.salesDay} settled to ${bank(st.bankAccount)}${via(st.machine)}`, inAmt: 0, outAmt: num(st.received) });
        if (num(st.charge) > 0) items.push({ t, day: st.settledOn, type: "bank_charge", ref: st.reference, description: `Bank charge on ${label(st.machine)} settlement of ${st.salesDay} (${num(st.chargePct).toFixed(2)}%)`, inAmt: 0, outAmt: num(st.charge) });
      }
    }
  }
  items.sort((a, b) => a.day.localeCompare(b.day) || a.t - b.t);
  let bal = 0;
  return items.map(it => {
    bal += it.inAmt - it.outAmt;
    return { day: it.day, time: new Date(it.t).toISOString(), type: it.type, ref: it.ref, description: it.description, inAmt: round2(it.inAmt), outAmt: round2(it.outAmt), balance: round2(bal) };
  });
}

router.get("/ledger/mode", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!allowed(req, res)) return;
  const { from, to } = range(req);
  const mode = String(req.query.mode ?? "cash");
  if (!LEDGER_MODES.includes(mode)) { res.status(400).json({ error: "Unknown payment mode." }); return; }
  if (from > to) { res.status(400).json({ error: "The start date is after the end date." }); return; }

  const entries = mode === "cash" ? await cashLedger(from, to) : await modeLedger(mode, from, to);
  const totalIn = round2(entries.reduce((s, e) => s + e.inAmt, 0));
  const totalOut = round2(entries.reduce((s, e) => s + e.outAmt, 0));
  res.json({ mode, from, to, entries, totalIn, totalOut, closing: entries.length ? entries[entries.length - 1].balance : 0 });
});

export default router;
