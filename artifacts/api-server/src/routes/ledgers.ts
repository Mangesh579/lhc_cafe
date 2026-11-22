import { Router } from "express";
import type { Response } from "express";
import { db, cashDaysTable, cashMovementsTable, expensesTable } from "@workspace/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { isDay, dayRangeUtc, paidOrdersBetween, modeOf, nepalDay, addDays } from "../lib/ledgerData";

const router = Router();
const LEDGER_ROLES = ["admin", "accountant", "supervisor"];
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

// Money received per day, by payment mode
router.get("/ledger/collections", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!allowed(req, res)) return;
  const { from, to } = range(req);
  if (from > to) { res.status(400).json({ error: "The start date is after the end date." }); return; }
  const orders = await paidOrdersBetween(dayRangeUtc(from).from, dayRangeUtc(to).to);
  const byDay = new Map<string, any>();
  for (const o of orders) {
    const day = nepalDay(o.at);
    const row = byDay.get(day) ?? { day, orders: 0, cash: 0, qr: 0, card: 0, credit: 0, other: 0, total: 0, vat: 0 };
    const amt = num(o.totalAmount);
    row[modeOf(o.paymentMethod)] += amt;
    row.total += amt;
    row.vat += num((o as any).vatAmount ?? 0);
    row.orders++;
    byDay.set(day, row);
  }
  const rows = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)).map(r => ({
    ...r, cash: round2(r.cash), qr: round2(r.qr), card: round2(r.card), credit: round2(r.credit), other: round2(r.other), total: round2(r.total), vat: round2(r.vat),
  }));
  const totals = rows.reduce((t, r) => ({
    orders: t.orders + r.orders, cash: t.cash + r.cash, qr: t.qr + r.qr, card: t.card + r.card, credit: t.credit + r.credit, other: t.other + r.other, total: t.total + r.total, vat: t.vat + r.vat,
  }), { orders: 0, cash: 0, qr: 0, card: 0, credit: 0, other: 0, total: 0, vat: 0 });
  res.json({ from, to, rows, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round2(v as number)])) });
});

async function cashLedger(from: string, to: string) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const dayRows = await db.select().from(cashDaysTable).where(and(gte(cashDaysTable.day, from), lte(cashDaysTable.day, to)));
  const dayMap = new Map(dayRows.map(r => [r.day, r]));
  const sales = (await paidOrdersBetween(dayRangeUtc(from).from, dayRangeUtc(to).to)).filter(o => modeOf(o.paymentMethod) === "cash");
  const exps = await db.select().from(expensesTable).where(and(
    gte(expensesTable.expenseDate, from), lte(expensesTable.expenseDate, to), eq(expensesTable.status, "active"), eq(expensesTable.paidFromDrawer, true)));
  const moves = await db.select().from(cashMovementsTable).where(and(
    gte(cashMovementsTable.day, from), lte(cashMovementsTable.day, to), eq(cashMovementsTable.status, "active")));

  const entries: any[] = [];
  let bal = 0, started = false;
  for (const day of days) {
    const rec = dayMap.get(day);
    const items: { t: number; type: string; ref: string; description: string; amount: number; dir: "in" | "out" }[] = [
      ...sales.filter(o => nepalDay(o.at) === day).map(o => ({ t: o.at.getTime(), type: "sale", ref: `Sale #${o.id}${(o as any).invoiceNumber ? ` · ${(o as any).invoiceNumber}` : ""}`, description: "Cash sale", amount: num(o.totalAmount), dir: "in" as const })),
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

router.get("/ledger/mode", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!allowed(req, res)) return;
  const { from, to } = range(req);
  const mode = String(req.query.mode ?? "cash");
  if (!["cash", "qr", "card", "credit", "other"].includes(mode)) { res.status(400).json({ error: "Unknown payment mode." }); return; }
  if (from > to) { res.status(400).json({ error: "The start date is after the end date." }); return; }

  let entries: any[];
  if (mode === "cash") entries = await cashLedger(from, to);
  else {
    const orders = (await paidOrdersBetween(dayRangeUtc(from).from, dayRangeUtc(to).to))
      .filter(o => modeOf(o.paymentMethod) === mode).sort((a, b) => a.at.getTime() - b.at.getTime());
    let bal = 0;
    entries = orders.map(o => {
      const amt = num(o.totalAmount); bal += amt;
      return { day: nepalDay(o.at), time: o.at.toISOString(), type: "sale", ref: `Sale #${o.id}${(o as any).invoiceNumber ? ` · ${(o as any).invoiceNumber}` : ""}`, description: "Sale received", inAmt: round2(amt), outAmt: 0, balance: round2(bal) };
    });
  }
  const totalIn = round2(entries.reduce((s, e) => s + e.inAmt, 0));
  const totalOut = round2(entries.reduce((s, e) => s + e.outAmt, 0));
  res.json({ mode, from, to, entries, totalIn, totalOut, closing: entries.length ? entries[entries.length - 1].balance : 0 });
});

export default router;