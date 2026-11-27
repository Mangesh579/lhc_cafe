import { Router } from "express";
import type { Response } from "express";
import { db, settlementsTable, settlementMachinesTable, settlementSettingsTable, expensesTable, expenseChangesTable } from "@workspace/db";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { isDay, nepalDay, addDays, dayRangeUtc, paidOrdersBetween, receiptsBetween } from "../lib/ledgerData";
import { salesByMachineDay, settlementFigures, validateSettlementInput, MACHINES, type Machine, type FeeRule } from "../lib/settlementRules";
import { round2 } from "../lib/payments";

const router = Router();
const VIEW_ROLES = ["admin", "accountant", "supervisor"];
const WRITE_ROLES = ["admin", "accountant"];
const BANK_LABEL: Record<string, string> = { nabil: "Nabil Bank", hbl: "HBL" };
export const BANK_CHARGE_CATEGORY = "Bank and card charges";
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const idOf = (raw: string | string[]) => parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
const roleOf = (req: AuthRequest) => (req.user?.role as string | undefined) ?? "";

function can(req: AuthRequest, res: Response, roles: string[], msg = "Not allowed"): boolean {
  if (!roles.includes(roleOf(req))) { res.status(403).json({ error: msg }); return false; }
  return true;
}
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

async function loadConfig() {
  const machines = await db.select().from(settlementMachinesTable);
  const [s] = await db.select().from(settlementSettingsTable).where(eq(settlementSettingsTable.id, 1));
  const rules = new Map<string, FeeRule & { bankAccount: string; collectedBy: string }>(machines.map(m => [m.machine, {
    label: m.label, bankAccount: m.bankAccount, collectedBy: m.collectedBy ?? "lhc",
    feeMinPct: m.feeMinPct != null ? num(m.feeMinPct) : null, feeMaxPct: m.feeMaxPct != null ? num(m.feeMaxPct) : null,
  }]));
  return {
    machines: machines.sort((a, b) => MACHINES.indexOf(a.machine as Machine) - MACHINES.indexOf(b.machine as Machine)),
    rules,
    startDate: s?.startDate ?? "2026-11-22",
    tolerance: s ? num(s.toleranceAmount) : 0.5,
  };
}

// Current sales per machine and Nepal day between two days (inclusive)
async function salesBetween(from: string, to: string) {
  const orders = await paidOrdersBetween(dayRangeUtc(from).from, dayRangeUtc(to).to);
  const receipts = await receiptsBetween(from, to); // QR and card receipts count; cash and bank are skipped by machineOfMode
  return salesByMachineDay(orders, receipts);
}

// ── Overview: every machine and day with sales, settled or not ──
router.get("/settlements", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const cfg = await loadConfig();
  const today = nepalDay(new Date());
  const to = isDay(req.query.to) && req.query.to < today ? req.query.to : addDays(today, -1);
  let from = isDay(req.query.from) ? req.query.from : cfg.startDate;
  if (from < cfg.startDate) from = cfg.startDate;
  if (from > to) from = to; // nothing ended yet since the start date: an empty list
  if (from < addDays(to, -366)) { res.status(400).json({ error: "Choose a range of one year or less." }); return; }

  const cells = await salesBetween(from, to);
  const settled = await db.select().from(settlementsTable).where(and(eq(settlementsTable.status, "active"), gte(settlementsTable.salesDay, from), lte(settlementsTable.salesDay, to)));
  const voided = await db.select().from(settlementsTable).where(and(eq(settlementsTable.status, "void"), gte(settlementsTable.salesDay, from), lte(settlementsTable.salesDay, to))).orderBy(desc(settlementsTable.id));
  const key = (d: string, m: string) => `${d}|${m}`;
  const settledBy = new Map(settled.map(s => [key(s.salesDay, s.machine), s]));
  const cellBy = new Map(cells.map(c => [key(c.day, c.machine), c]));

  const rows: any[] = [];
  const keys = new Set<string>([...cells.filter(c => c.machine !== "card_unknown").map(c => key(c.day, c.machine)), ...settled.map(s => key(s.salesDay, s.machine))]);
  for (const k of keys) {
    const [day, machine] = k.split("|");
    const c = cellBy.get(k);
    const s = settledBy.get(k);
    const rule = cfg.rules.get(machine);
    const gross = c?.gross ?? 0;
    rows.push({
      day, machine, label: rule?.label ?? machine, bankAccount: rule?.bankAccount ?? null, collectedBy: rule?.collectedBy ?? "lhc",
      bills: c?.bills ?? 0, gross,
      status: s ? "settled" : "unsettled",
      settlement: s ? {
        id: s.id, bankAccount: s.bankAccount, gross: num(s.gross), received: num(s.received), charge: num(s.charge), chargePct: num(s.chargePct),
        settledOn: s.settledOn, reference: s.reference, note: s.note, warning: s.warning, expenseId: s.expenseId, createdBy: s.createdBy, createdAt: s.createdAt,
      } : null,
      // Sales on a settled day changed later (a late or cancelled bill): settled figures stay; this shows the gap
      changedAfterSettlement: s ? round2(gross - num(s.gross)) : 0,
      voided: voided.filter(v => v.salesDay === day && v.machine === machine).map(v => ({ id: v.id, received: num(v.received), voidReason: v.voidReason, voidedBy: v.voidedBy })),
    });
  }
  rows.sort((a, b) => b.day.localeCompare(a.day) || MACHINES.indexOf(a.machine) - MACHINES.indexOf(b.machine));
  const unsettled = cfg.machines.map(m => {
    const mine = rows.filter(r => r.machine === m.machine && r.status === "unsettled");
    return { machine: m.machine, label: m.label, bankAccount: m.bankAccount, collectedBy: m.collectedBy ?? "lhc", days: mine.length, total: round2(mine.reduce((s, r) => s + r.gross, 0)), oldest: mine.length ? mine[mine.length - 1].day : null };
  });
  const legacyCard = cells.filter(c => c.machine === "card_unknown").map(c => ({ day: c.day, bills: c.bills, gross: c.gross }));
  res.json({
    from, to, today, startDate: cfg.startDate, tolerance: cfg.tolerance,
    machines: cfg.machines.map(m => ({ ...m, feeMinPct: m.feeMinPct != null ? num(m.feeMinPct) : null, feeMaxPct: m.feeMaxPct != null ? num(m.feeMaxPct) : null })),
    rows, unsettled, legacyCard,
  });
});

// Preview the charge and warning before saving (used by the Settle dialog as the user types)
router.get("/settlements/preview", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, VIEW_ROLES)) return;
  const cfg = await loadConfig();
  const machine = String(req.query.machine ?? ""), day = req.query.day;
  const rule = cfg.rules.get(machine);
  if (!rule || !isDay(day)) { res.status(400).json({ error: "Choose a machine and a day." }); return; }
  const cell = (await salesBetween(day, day)).find(c => c.machine === machine && c.day === day);
  const f = settlementFigures(cell?.gross ?? 0, num(req.query.received), rule, cfg.tolerance);
  res.json({ gross: cell?.gross ?? 0, bills: cell?.bills ?? 0, ...f });
});

router.post("/settlements", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, WRITE_ROLES, "Only the admin or the accountant can record settlements.")) return;
  const cfg = await loadConfig();
  const today = nepalDay(new Date());
  const v = validateSettlementInput(req.body, { today, startDate: cfg.startDate });
  if ("error" in v) { res.status(400).json({ error: v.error }); return; }
  const rule = cfg.rules.get(v.machine);
  if (!rule) { res.status(400).json({ error: "That machine is not set up." }); return; }
  const cell = (await salesBetween(v.day, v.day)).find(c => c.machine === v.machine && c.day === v.day);
  const gross = cell?.gross ?? 0;
  // The screen sends the total it showed; if a bill changed since, ask to reload rather than settle a different figure
  if (req.body?.expectedGross != null && Math.abs(num(req.body.expectedGross) - gross) >= 0.005) {
    res.status(409).json({ error: `Sales for that day are now Rs. ${gross.toFixed(2)} (the screen showed Rs. ${num(req.body.expectedGross).toFixed(2)}). Reload and check before settling.` });
    return;
  }
  const f = settlementFigures(gross, v.received, rule, cfg.tolerance);
  if ("error" in f) { res.status(400).json({ error: f.error }); return; }
  // Sulimha Durbar's machines: the money reaches LHC when Sulimha transfers it, into the LHC account chosen here
  const viaSulimha = rule.collectedBy === "sulimha";
  if (viaSulimha && !v.bankAccount) { res.status(400).json({ error: "Choose the LHC account Sulimha Durbar transferred the money into (Nabil or HBL)." }); return; }
  const account = viaSulimha ? v.bankAccount! : rule.bankAccount;
  const user = req.user?.username ?? "user";
  const bank = BANK_LABEL[account] ?? account;
  try {
    const id = await db.transaction(async (tx) => {
      const [exists] = await tx.select({ id: settlementsTable.id }).from(settlementsTable)
        .where(and(eq(settlementsTable.machine, v.machine), eq(settlementsTable.salesDay, v.day), eq(settlementsTable.status, "active")));
      if (exists) throw new HttpError(409, "This machine and day is already settled.");
      let expenseId: number | null = null;
      if (f.charge > 0) {
        const [e] = await tx.insert(expensesTable).values({
          expenseDate: v.settledOn, type: "indirect", category: BANK_CHARGE_CATEGORY, subcategory: rule.label,
          description: `${rule.label} settlement for ${v.day}: Rs. ${gross.toFixed(2)} sales, Rs. ${v.received.toFixed(2)} received${viaSulimha ? ` from Sulimha Durbar into ${bank}` : ""} (${f.chargePct.toFixed(2)}%)`,
          vendor: viaSulimha ? "Sulimha Durbar" : bank, amount: String(f.charge), paymentMethod: "bank_transfer", paidFromDrawer: false,
          billNumber: v.reference, isRecurring: false, createdBy: user,
        } as any).returning();
        expenseId = e.id;
        await tx.insert(expenseChangesTable).values({ expenseId: e.id, action: "created", details: `Bank charge from ${rule.label} settlement of ${v.day}, ref ${v.reference}`, changedBy: user });
      }
      const [row] = await tx.insert(settlementsTable).values({
        machine: v.machine, salesDay: v.day, bankAccount: account, bills: cell?.bills ?? 0,
        gross: String(gross), received: String(v.received), charge: String(f.charge), chargePct: String(f.chargePct),
        settledOn: v.settledOn, reference: v.reference, note: v.note, warning: f.warning, expenseId, createdBy: user,
      }).returning();
      return row.id;
    });
    const [row] = await db.select().from(settlementsTable).where(eq(settlementsTable.id, id));
    res.status(201).json({ ...row, warning: f.warning });
  } catch (e: any) {
    if (e instanceof HttpError) { res.status(e.status).json({ error: e.message }); return; }
    if (String(e?.code) === "23505") { res.status(409).json({ error: "This machine and day is already settled." }); return; }
    throw e;
  }
});

// Settled days are read-only. A wrong settlement is voided (admin only, with a reason); its bank charge expense is voided too.
router.post("/settlements/:id/void", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, ["admin"], "Only the admin can void a settlement.")) return;
  const id = idOf(req.params.id);
  const reason = clean(req.body?.reason, 300);
  if (!reason) { res.status(400).json({ error: "A reason is required." }); return; }
  const user = req.user?.username ?? "admin";
  try {
    await db.transaction(async (tx) => {
      const [s] = await tx.select().from(settlementsTable).where(eq(settlementsTable.id, id));
      if (!s || s.status !== "active") throw new HttpError(404, "Settlement not found");
      await tx.update(settlementsTable).set({ status: "void", voidReason: reason, voidedBy: user, voidedAt: new Date() }).where(eq(settlementsTable.id, id));
      if (s.expenseId) {
        await tx.update(expensesTable).set({ status: "void", voidReason: `Settlement voided: ${reason}`, voidedBy: user, voidedAt: new Date() }).where(eq(expensesTable.id, s.expenseId));
        await tx.insert(expenseChangesTable).values({ expenseId: s.expenseId, action: "voided", details: `Settlement #${id} voided: ${reason}`, changedBy: user });
      }
    });
    res.json({ success: true });
  } catch (e: any) {
    if (e instanceof HttpError) { res.status(e.status).json({ error: e.message }); return; }
    throw e;
  }
});

// ── Settings: start date, rounding allowance, fee range per machine ──
router.patch("/settlements/settings", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!can(req, res, WRITE_ROLES, "Only the admin or the accountant can change settlement settings.")) return;
  const b = req.body ?? {};
  const user = req.user?.username ?? "user";
  if (b.startDate !== undefined || b.toleranceAmount !== undefined) {
    const cfg = await loadConfig();
    const startDate = b.startDate !== undefined ? b.startDate : cfg.startDate;
    const tol = b.toleranceAmount !== undefined ? num(b.toleranceAmount) : cfg.tolerance;
    if (!isDay(startDate)) { res.status(400).json({ error: "Enter a valid start date." }); return; }
    if (!(tol >= 0 && tol <= 100)) { res.status(400).json({ error: "The rounding allowance must be from 0 to 100 rupees." }); return; }
    const values = { startDate, toleranceAmount: String(round2(tol)), updatedBy: user, updatedAt: new Date() };
    await db.insert(settlementSettingsTable).values({ id: 1, ...values }).onConflictDoUpdate({ target: settlementSettingsTable.id, set: values });
  }
  if (Array.isArray(b.machines)) {
    for (const m of b.machines) {
      if (!(MACHINES as readonly string[]).includes(m?.machine)) { res.status(400).json({ error: "Unknown machine." }); return; }
      const min = m.feeMinPct === null || m.feeMinPct === "" ? null : num(m.feeMinPct);
      const max = m.feeMaxPct === null || m.feeMaxPct === "" ? null : num(m.feeMaxPct);
      if ((min == null) !== (max == null) || (min != null && !(min >= 0 && max! >= min && max! < 100))) {
        res.status(400).json({ error: "Enter both fee percentages (lowest first), or leave both empty for no fee." }); return;
      }
      await db.update(settlementMachinesTable).set({ feeMinPct: min == null ? null : String(min), feeMaxPct: max == null ? null : String(max) })
        .where(eq(settlementMachinesTable.machine, m.machine));
    }
  }
  const cfg = await loadConfig();
  res.json({ startDate: cfg.startDate, tolerance: cfg.tolerance, machines: cfg.machines });
});

export default router;
