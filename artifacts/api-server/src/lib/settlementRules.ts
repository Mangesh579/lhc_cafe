// Card and QR settlement rules. Pure functions only (no database), unit tested.
import { round2 } from "./payments";
import { nepalDay, type LedgerOrder, type LedgerReceipt } from "./ledgerData";

// nabil_pos / hbl_pos are LHC's machines; sulimha_* are Sulimha Durbar's, settled when Sulimha transfers the money to an LHC account.
export const MACHINES = ["nabil_pos", "hbl_pos", "sulimha_nabil_pos", "sulimha_hbl_pos", "qr"] as const;
export type Machine = (typeof MACHINES)[number];

// Which machine took a payment part. Legacy "card"/"esewa" has no machine recorded and cannot be settled to one.
export function machineOfMode(mode: string | null | undefined): Machine | "card_unknown" | null {
  if (mode === "card_nabil") return "nabil_pos";
  if (mode === "card_hbl") return "hbl_pos";
  if (mode === "card_sulimha_nabil") return "sulimha_nabil_pos";
  if (mode === "card_sulimha_hbl") return "sulimha_hbl_pos";
  if (mode === "nabil_qr" || mode === "qr") return "qr";
  if (mode === "card" || mode === "esewa") return "card_unknown";
  return null;
}

export type SalesCell = { day: string; machine: Machine | "card_unknown"; bills: number; gross: number };

// Sales per Nepal day and machine, from order payment parts (order_payments, or payment_method for older orders).
// A split bill counts each part on its own machine. NC, credit, cash and unpaid bills never count.
// Customer receipts taken by QR (receipt vouchers) are QR money too, on their receipt date.
export function salesByMachineDay(orders: LedgerOrder[], receipts: Pick<LedgerReceipt, "receiptDate" | "mode" | "amount">[] = []): SalesCell[] {
  const cells = new Map<string, SalesCell>();
  const cell = (day: string, machine: SalesCell["machine"]) => {
    const k = `${day}|${machine}`;
    let c = cells.get(k);
    if (!c) { c = { day, machine, bills: 0, gross: 0 }; cells.set(k, c); }
    return c;
  };
  for (const o of orders) {
    if (o.paymentStatus !== "paid" || o.isNc) continue;
    const day = nepalDay(o.at);
    const seen = new Set<string>();
    for (const p of o.parts) {
      const m = machineOfMode(p.mode);
      if (!m) continue;
      const c = cell(day, m);
      c.gross += p.amount;
      if (!seen.has(m)) { c.bills++; seen.add(m); }
    }
  }
  for (const r of receipts) {
    if (machineOfMode(r.mode) !== "qr") continue;
    const c = cell(r.receiptDate, "qr");
    c.gross += r.amount;
    c.bills++;
  }
  return Array.from(cells.values())
    .map(c => ({ ...c, gross: round2(c.gross) }))
    .filter(c => c.gross > 0)
    .sort((a, b) => a.day.localeCompare(b.day) || a.machine.localeCompare(b.machine));
}

export type FeeRule = { label: string; feeMinPct: number | null; feeMaxPct: number | null };

// Works out the bank charge for a settlement and whether it is outside the machine's expected fee.
// The warning never blocks. tolerance (Rs.) allows for the bank rounding its deduction.
export function settlementFigures(gross: number, received: number, rule: FeeRule, tolerance = 0.5):
  { charge: number; chargePct: number; expectedMin: number; expectedMax: number; warning: string | null } | { error: string } {
  gross = round2(gross); received = round2(received);
  if (!(gross > 0)) return { error: "There are no unsettled sales for this machine and day." };
  if (!Number.isFinite(received) || received <= 0) return { error: "Enter the amount that reached the bank (above 0)." };
  if (received - gross >= 0.005) return { error: `The bank received Rs. ${received.toFixed(2)}, more than the sales of Rs. ${gross.toFixed(2)}. Check the amount.` };
  const charge = round2(gross - received);
  const chargePct = Math.round((charge / gross) * 100000) / 1000; // 3 decimals
  if (rule.feeMinPct == null || rule.feeMaxPct == null) {
    const warning = charge >= 0.005 ? `${rule.label} has no fee, but Rs. ${charge.toFixed(2)} (${chargePct.toFixed(2)}%) is missing. Check the bank statement.` : null;
    return { charge, chargePct, expectedMin: 0, expectedMax: 0, warning };
  }
  const expectedMin = round2(gross * rule.feeMinPct / 100);
  const expectedMax = round2(gross * rule.feeMaxPct / 100);
  const range = rule.feeMinPct === rule.feeMaxPct ? `${rule.feeMinPct.toFixed(2)}%` : `${rule.feeMinPct.toFixed(2)}-${rule.feeMaxPct.toFixed(2)}%`;
  const expected = expectedMin === expectedMax ? `Rs. ${expectedMin.toFixed(2)}` : `Rs. ${expectedMin.toFixed(2)}-${expectedMax.toFixed(2)}`;
  const outside = charge < expectedMin - tolerance || charge > expectedMax + tolerance;
  const warning = outside ? `${rule.label} charge is ${chargePct.toFixed(2)}% (Rs. ${charge.toFixed(2)}); expected ${range} (${expected}). Check the bank statement.` : null;
  return { charge, chargePct, expectedMin, expectedMax, warning };
}

const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Checks a settlement entry. The sales day must be from the start date and before today (a day is
// settled after it ends); the money cannot reach the bank before the sales day or after today.
export function validateSettlementInput(body: any, ctx: { today: string; startDate: string }):
  { machine: Machine; day: string; received: number; settledOn: string; reference: string; note: string | null; bankAccount: "nabil" | "hbl" | null } | { error: string } {
  const machine = String(body?.machine ?? "");
  if (!(MACHINES as readonly string[]).includes(machine)) return { error: "Choose the card machine or QR." };
  if (!isDay(body?.day)) return { error: "Choose the sales day." };
  const day = body.day;
  if (day < ctx.startDate) return { error: `Settlements are tracked from ${ctx.startDate}.` };
  if (day >= ctx.today) return { error: "A day can be settled only after it has ended." };
  const settledOn = isDay(body?.settledOn) ? body.settledOn : ctx.today;
  if (settledOn < day) return { error: "The money cannot reach the bank before the sales day." };
  if (settledOn > ctx.today) return { error: "The settlement date cannot be in the future." };
  const received = round2(parseFloat(String(body?.received ?? "")));
  if (!Number.isFinite(received) || received <= 0) return { error: "Enter the amount that reached the bank (above 0)." };
  const reference = clean(body?.reference, 80);
  if (!reference) return { error: "Enter the bank statement or settlement reference." };
  const bankAccount = body?.bankAccount === "nabil" || body?.bankAccount === "hbl" ? body.bankAccount : null;
  return { machine: machine as Machine, day, received, settledOn, reference, note: clean(body?.note, 300), bankAccount };
}
