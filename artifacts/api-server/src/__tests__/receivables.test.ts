import { describe, it, expect } from "vitest";
import { validateAllocations, autoAllocate, creditLimitWarning, dueDateOf, DEFAULT_CREDIT_DAYS } from "../lib/receivableRules";

const invoices = new Map([
  [10, { orderId: 10, customerId: 7, outstanding: 600 }],
  [11, { orderId: 11, customerId: 7, outstanding: 400 }],
  [20, { orderId: 20, customerId: 8, outstanding: 300 }],
]);

describe("receipt allocation", () => {
  it("allocates a receipt fully over two invoices", () => {
    expect(validateAllocations([{ orderId: 10, amount: 600 }, { orderId: 11, amount: 400 }], 1000, 7, invoices)).toEqual({
      allocations: [{ orderId: 10, amount: 600 }, { orderId: 11, amount: 400 }], total: 1000,
    });
  });

  it("allows part of an invoice and leaves the rest of the receipt unallocated", () => {
    expect(validateAllocations([{ orderId: 10, amount: 250 }], 1000, 7, invoices)).toEqual({ allocations: [{ orderId: 10, amount: 250 }], total: 250 });
  });

  it("refuses more than an invoice's outstanding", () => {
    expect(validateAllocations([{ orderId: 11, amount: 401 }], 1000, 7, invoices)).toHaveProperty("error");
  });

  it("refuses more than the receipt amount", () => {
    expect(validateAllocations([{ orderId: 10, amount: 600 }, { orderId: 11, amount: 400 }], 900, 7, invoices)).toHaveProperty("error");
  });

  it("refuses another customer's invoice and unknown invoices", () => {
    expect(validateAllocations([{ orderId: 20, amount: 100 }], 1000, 7, invoices)).toHaveProperty("error");
    expect(validateAllocations([{ orderId: 99, amount: 100 }], 1000, 7, invoices)).toHaveProperty("error");
  });

  it("autoAllocate settles the oldest invoices first", () => {
    expect(autoAllocate(700, [{ orderId: 10, outstanding: 600 }, { orderId: 11, outstanding: 400 }])).toEqual([{ orderId: 10, amount: 600 }, { orderId: 11, amount: 100 }]);
  });
});

describe("credit terms", () => {
  it("warns, without blocking, when a sale goes over the credit limit", () => {
    expect(creditLimitWarning(5000, 4500, 400)).toBeNull();
    expect(creditLimitWarning(5000, 4500, 600)).toMatch(/over the credit limit/);
    expect(creditLimitWarning(null, 99999, 1000)).toBeNull();
  });

  it("works out due dates from credit days, with a default", () => {
    expect(dueDateOf("2026-11-20", 15)).toBe("2026-12-05");
    expect(DEFAULT_CREDIT_DAYS).toBe(30);
    expect(dueDateOf("2026-11-20", null)).toBe("2026-12-20");
  });
});
