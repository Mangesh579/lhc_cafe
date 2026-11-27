import { describe, it, expect } from "vitest";
import { salesByMachineDay, settlementFigures, validateSettlementInput, machineOfMode } from "../lib/settlementRules";
import { order } from "./helpers";

const NABIL = { label: "Card - Nabil POS", feeMinPct: 2.75, feeMaxPct: 2.75 };
const HBL = { label: "Card - HBL POS", feeMinPct: 3.0, feeMaxPct: 3.25 };
const QR = { label: "QR Payment", feeMinPct: null, feeMaxPct: null };
const warn = (...a: Parameters<typeof settlementFigures>) => { const r = settlementFigures(...a); if ("error" in r) throw new Error(r.error); return r.warning; };

describe("which machine took the money", () => {
  it("maps payment modes to machines", () => {
    expect(machineOfMode("card_nabil")).toBe("nabil_pos");
    expect(machineOfMode("card_hbl")).toBe("hbl_pos");
    expect(machineOfMode("nabil_qr")).toBe("qr");
    expect(machineOfMode("card")).toBe("card_unknown");
    expect(machineOfMode("esewa")).toBe("card_unknown");
    expect(machineOfMode("cash")).toBeNull();
    expect(machineOfMode("credit")).toBeNull();
  });
});

describe("unsettled sales per machine and day (from order_payments)", () => {
  it("counts each part of a split bill on its own machine", () => {
    const cells = salesByMachineDay([
      order({ total: 1000, rows: [{ mode: "card_nabil", amount: 600 }, { mode: "nabil_qr", amount: 300 }, { mode: "cash", amount: 100 }] }),
      order({ total: 500, rows: [{ mode: "card_hbl", amount: 500 }] }),
      order({ total: 250, rows: [{ mode: "card_nabil", amount: 250 }] }),
    ]);
    expect(cells).toEqual([
      { day: "2026-11-20", machine: "hbl_pos", bills: 1, gross: 500 },
      { day: "2026-11-20", machine: "nabil_pos", bills: 2, gross: 850 },
      { day: "2026-11-20", machine: "qr", bills: 1, gross: 300 },
    ]);
  });

  it("never counts cash, credit, NC or unpaid bills", () => {
    expect(salesByMachineDay([
      order({ total: 400, rows: [{ mode: "cash", amount: 400 }] }),
      order({ total: 400, rows: [{ mode: "credit", amount: 400 }] }),
      order({ total: 400, method: "nabil_qr", isNc: true }),
      order({ total: 400, method: "card_nabil", status: "pending" }),
      order({ total: 400, method: "nabil_qr", status: "cancelled" }),
    ])).toEqual([]);
  });

  it("falls back to payment_method for older orders without rows", () => {
    expect(salesByMachineDay([order({ total: 700, method: "nabil_qr" })])).toEqual([{ day: "2026-11-20", machine: "qr", bills: 1, gross: 700 }]);
  });

  it("keeps legacy card (machine not recorded) apart", () => {
    expect(salesByMachineDay([order({ total: 300, method: "esewa" })])).toEqual([{ day: "2026-11-20", machine: "card_unknown", bills: 1, gross: 300 }]);
  });

  it("uses the Nepal day: 11:50 pm on that day, 12:10 am on the next", () => {
    const cells = salesByMachineDay([
      order({ total: 500, method: "card_nabil", at: "2026-11-20T18:05:00.000Z" }),
      order({ total: 300, method: "card_nabil", at: "2026-11-20T18:25:00.000Z" }),
    ]);
    expect(cells.map(c => [c.day, c.gross])).toEqual([["2026-11-20", 500], ["2026-11-21", 300]]);
  });

  it("adds QR receipt vouchers to QR on their receipt date; cash and bank receipts are not settled", () => {
    const cells = salesByMachineDay([], [
      { receiptDate: "2026-11-21", mode: "nabil_qr", amount: 400 },
      { receiptDate: "2026-11-21", mode: "cash", amount: 100 },
      { receiptDate: "2026-11-21", mode: "bank", amount: 900 },
    ]);
    expect(cells).toEqual([{ day: "2026-11-21", machine: "qr", bills: 1, gross: 400 }]);
  });

  it("adds card receipts (a hotel guest paying at check-out, 2026-11-26) to that card machine", () => {
    const cells = salesByMachineDay([], [
      { receiptDate: "2026-11-26", mode: "card_hbl", amount: 300 },
      { receiptDate: "2026-11-26", mode: "card_sulimha_nabil", amount: 1000 },
    ]);
    expect(cells).toEqual([
      { day: "2026-11-26", machine: "hbl_pos", bills: 1, gross: 300 },
      { day: "2026-11-26", machine: "sulimha_nabil_pos", bills: 1, gross: 1000 },
    ]);
  });
});

describe("bank charge and fee warnings", () => {
  it("Nabil POS at exactly 2.75% does not warn", () => {
    expect(settlementFigures(10000, 9725, NABIL)).toMatchObject({ charge: 275, chargePct: 2.75, warning: null });
  });

  it("Nabil POS allows bank rounding within the allowance", () => {
    expect(warn(1234, 1200.3, NABIL)).toBeNull(); // 33.70 vs 33.94 expected
  });

  it("Nabil POS outside 2.75% warns (too low and too high)", () => {
    expect(warn(10000, 9750, NABIL)).toMatch(/2\.50%.*expected 2\.75%/);
    expect(warn(10000, 9700, NABIL)).toMatch(/3\.00%.*expected 2\.75%/);
  });

  it("HBL POS inside 3.00-3.25% does not warn; outside warns", () => {
    expect(warn(10000, 9700, HBL)).toBeNull();   // 3.00%
    expect(warn(10000, 9680, HBL)).toBeNull();   // 3.20%
    expect(warn(10000, 9675, HBL)).toBeNull();   // 3.25%
    expect(warn(10000, 9720, HBL)).toMatch(/2\.80%.*3\.00-3\.25%/);
    expect(warn(10000, 9650, HBL)).toMatch(/3\.50%/);
  });

  it("QR has no expected fee: a full settlement is fine, any shortfall warns", () => {
    expect(settlementFigures(5000, 5000, QR)).toMatchObject({ charge: 0, warning: null });
    expect(warn(5000, 4990, QR)).toMatch(/no fee.*Rs\. 10\.00/);
  });

  it("the warning never blocks; impossible amounts are refused", () => {
    expect(settlementFigures(10000, 9000, NABIL)).toHaveProperty("charge", 1000);
    expect(settlementFigures(10000, 10001, NABIL)).toHaveProperty("error");
    expect(settlementFigures(10000, 0, NABIL)).toHaveProperty("error");
    expect(settlementFigures(0, 100, NABIL)).toHaveProperty("error");
  });

  it("works to the paisa", () => {
    expect(settlementFigures(355.5, 345.72, NABIL)).toMatchObject({ charge: 9.78 });
  });
});

describe("settlement entry checks", () => {
  const ctx = { today: "2026-11-25", startDate: "2026-11-22" };
  const ok = { machine: "nabil_pos", day: "2026-11-23", received: "9725", settledOn: "2026-11-24", reference: "STMT-1" };

  it("accepts a valid entry", () => {
    expect(validateSettlementInput(ok, ctx)).toMatchObject({ machine: "nabil_pos", day: "2026-11-23", received: 9725, settledOn: "2026-11-24", reference: "STMT-1" });
  });

  it("refuses today (not ended), days before the start date, and future or early bank dates", () => {
    expect(validateSettlementInput({ ...ok, day: "2026-11-25" }, ctx)).toHaveProperty("error");
    expect(validateSettlementInput({ ...ok, day: "2026-11-21" }, ctx)).toHaveProperty("error");
    expect(validateSettlementInput({ ...ok, settledOn: "2026-11-26" }, ctx)).toHaveProperty("error");
    expect(validateSettlementInput({ ...ok, settledOn: "2026-11-22" }, ctx)).toHaveProperty("error");
  });

  it("needs a known machine, an amount and a bank reference", () => {
    expect(validateSettlementInput({ ...ok, machine: "card" }, ctx)).toHaveProperty("error");
    expect(validateSettlementInput({ ...ok, received: "" }, ctx)).toHaveProperty("error");
    expect(validateSettlementInput({ ...ok, reference: "  " }, ctx)).toHaveProperty("error");
  });
});
