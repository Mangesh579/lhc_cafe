import { describe, it, expect } from "vitest";
import { validateSplit, partsFor, summaryMethod, modeOf, cardMachineOf } from "../lib/payments";

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
