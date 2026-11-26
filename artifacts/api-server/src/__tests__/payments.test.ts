import { describe, it, expect } from "vitest";
import { validateSplit, partsFor, summaryMethod, modeOf, cardMachineOf, billDiscount } from "../lib/payments";

describe("payment modes", () => {
  it("keeps old stored values working", () => {
    expect(modeOf("nabil_qr")).toBe("qr");
    expect(modeOf("card")).toBe("card");
    expect(modeOf("esewa")).toBe("card");
    expect(modeOf("card_nabil")).toBe("card");
    expect(modeOf("card_hbl")).toBe("card");
    expect(cardMachineOf("esewa")).toBe("unknown");
    expect(cardMachineOf("card_hbl")).toBe("hbl");
  });
});

describe("validateSplit", () => {
  it("accepts parts that add up to the bill", () => {
    const r = validateSplit([{ mode: "cash", amount: 500 }, { mode: "nabil_qr", amount: "500" }], 1000, { hasCustomer: false });
    expect(r).toEqual({ parts: [{ mode: "cash", amount: 500, reference: null }, { mode: "nabil_qr", amount: 500, reference: null }] });
  });

  it("rejects parts that do not add up to the bill", () => {
    const r = validateSplit([{ mode: "cash", amount: 500 }, { mode: "nabil_qr", amount: 400 }], 1000, { hasCustomer: false });
    expect(r).toHaveProperty("error");
  });

  it("works to the paisa (a 10% discount on 355 is 319.50)", () => {
    expect(validateSplit([{ mode: "cash", amount: 119.5 }, { mode: "card_nabil", amount: 200 }], 319.5, { hasCustomer: false })).toHaveProperty("parts");
    expect(validateSplit([{ mode: "cash", amount: 119 }, { mode: "card_nabil", amount: 200 }], 319.5, { hasCustomer: false })).toHaveProperty("error");
  });

  it("merges the same mode entered twice", () => {
    const r = validateSplit([{ mode: "cash", amount: 100 }, { mode: "cash", amount: 50 }], 150, { hasCustomer: false });
    expect(r).toEqual({ parts: [{ mode: "cash", amount: 150, reference: null }] });
  });

  it("rejects unknown modes, zero and negative amounts", () => {
    expect(validateSplit([{ mode: "esewa", amount: 100 }], 100, { hasCustomer: false })).toHaveProperty("error");
    expect(validateSplit([{ mode: "cash", amount: 0 }, { mode: "nabil_qr", amount: 100 }], 100, { hasCustomer: false })).toHaveProperty("error");
    expect(validateSplit([{ mode: "cash", amount: -50 }, { mode: "nabil_qr", amount: 150 }], 100, { hasCustomer: false })).toHaveProperty("error");
    expect(validateSplit([], 100, { hasCustomer: false })).toHaveProperty("error");
  });

  it("needs a customer for credit", () => {
    expect(validateSplit([{ mode: "credit", amount: 100 }], 100, { hasCustomer: false })).toHaveProperty("error");
    expect(validateSplit([{ mode: "credit", amount: 100 }], 100, { hasCustomer: true })).toHaveProperty("parts");
  });

  it("summarises the stored method", () => {
    expect(summaryMethod([{ mode: "cash", amount: 1 }])).toBe("cash");
    expect(summaryMethod([{ mode: "cash", amount: 1 }, { mode: "credit", amount: 1 }])).toBe("split");
  });

  it("partsFor falls back to payment_method only when there are no rows", () => {
    expect(partsFor({ totalAmount: "450.00", paymentMethod: "nabil_qr" }, [])).toEqual([{ mode: "nabil_qr", amount: 450, reference: null }]);
    expect(partsFor({ totalAmount: "450.00", paymentMethod: "split" }, [{ mode: "cash", amount: "200.00" }, { mode: "credit", amount: "250.00" }]))
      .toEqual([{ mode: "cash", amount: 200, reference: null }, { mode: "credit", amount: 250, reference: null }]);
  });
});

// Owner, 2026-11-26: a 100% discount (e.g. a loyalty reward) leaves a Rs 0 bill. Nothing is paid, so no mode and no card fee.
describe("a Rs 0 bill", () => {
  it("settles with no payment parts, whatever mode was picked", () => {
    expect(validateSplit([{ mode: "card_nabil", amount: 0 }], 0, { hasCustomer: false })).toEqual({ parts: [] });
    expect(validateSplit([], 0, { hasCustomer: false })).toEqual({ parts: [] });
    expect(validateSplit([{ mode: "cash", amount: 0 }, { mode: "card_hbl", amount: "" }], 0.001, { hasCustomer: false })).toEqual({ parts: [] });
    expect(summaryMethod([])).toBe("none");
  });

  it("still refuses money entered against a Rs 0 bill, and Rs 0 parts on a real bill", () => {
    expect(validateSplit([{ mode: "cash", amount: 50 }], 0, { hasCustomer: false })).toHaveProperty("error");
    expect(validateSplit([{ mode: "cash", amount: 0 }], 100, { hasCustomer: false })).toHaveProperty("error");
  });
});

// Owner, 2026-11-26: "Reward item" takes one unit of a chosen item off the bill (a loyalty reward), then any staff % on the rest.
describe("bill discount with a reward item", () => {
  it("takes the reward item's price off, then the staff % on what is left", () => {
    expect(billDiscount(450, 0, 150)).toEqual({ discount: 150, total: 300 });
    expect(billDiscount(450, 10, 150)).toEqual({ discount: 180, total: 270 });
    expect(billDiscount(333.33, 10, 0)).toEqual({ discount: 33.33, total: 300 });
  });
  it("a reward bigger than the bill leaves Rs 0, never less", () => {
    expect(billDiscount(120, 0, 150)).toEqual({ discount: 120, total: 0 });
  });
  it("refuses a staff % outside 0 to 100", () => {
    expect(billDiscount(100, 101, 0)).toHaveProperty("error");
    expect(billDiscount(100, -5, 0)).toHaveProperty("error");
  });
});
