import { describe, it, expect } from "vitest";
import { loyaltyBasis, pointsFor } from "../lib/receivableRules";

// Accountant, 2026-11-23: points only on money paid, in proportion to each receipt; none at the credit sale.
// Basis is the pre-VAT amount; points = floor(basis / 10) (existing rate: 1 point per Rs. 10).
describe("loyalty points follow payment", () => {
  it("a cash bill earns in full at payment, as before", () => {
    expect(pointsFor(loyaltyBasis(1000, 0, 1000, 1000))).toBe(100);
  });

  it("a credit sale earns nothing at the sale", () => {
    expect(pointsFor(loyaltyBasis(1000, 0, 0, 1000))).toBe(0);
  });

  it("each receipt earns in proportion to what it pays", () => {
    expect(pointsFor(loyaltyBasis(1000, 0, 400, 1000))).toBe(40);
    expect(pointsFor(loyaltyBasis(1000, 0, 1000, 1000))).toBe(100);
  });

  it("a cash + credit split earns on the cash part now", () => {
    expect(pointsFor(loyaltyBasis(1000, 0, 300, 1000))).toBe(30);
  });

  it("counts the pre-VAT amount on a VAT bill", () => {
    expect(loyaltyBasis(1130, 130, 565, 1130)).toBe(500);
    expect(pointsFor(loyaltyBasis(1130, 130, 1130, 1130))).toBe(100);
  });

  it("thirds add up without losing points to rounding", () => {
    expect([333.33, 666.66, 1000].map(p => pointsFor(loyaltyBasis(1000, 0, p, 1000)))).toEqual([33, 66, 100]);
  });

  it("a voided receipt takes its points back (recomputed on what is still paid)", () => {
    expect(pointsFor(loyaltyBasis(1000, 0, 0, 1000))).toBe(0);
  });

  it("never earns on more than the bill after credit notes", () => {
    expect(pointsFor(loyaltyBasis(1000, 0, 800, 800))).toBe(80);
    expect(pointsFor(loyaltyBasis(1000, 0, 1000, 800))).toBe(80);
  });
});
