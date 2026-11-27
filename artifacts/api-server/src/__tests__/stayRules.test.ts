import { describe, it, expect } from "vitest";
import { validateCheckIn, breakfastBill, breakfastCost } from "../lib/stayRules";

const TODAY = "2026-11-26";
const ok = { tableId: 10, guestName: " Ram Thapa ", phone: "9800000009", adults: 2, children: 1, breakfastIncluded: true, checkIn: TODAY, checkOut: "2026-11-28" };

describe("check-in (Sulimha's reception)", () => {
  it("cleans a good check-in; email is optional", () => {
    expect(validateCheckIn(ok, TODAY)).toMatchObject({ tableId: 10, guestName: "Ram Thapa", phone: "9800000009", email: null, adults: 2, children: 1, breakfastIncluded: true });
  });
  it("needs a room, a name, a phone and at least one adult", () => {
    for (const bad of [{ tableId: 0 }, { guestName: " " }, { phone: "12" }, { adults: 0 }, { children: -1 }]) {
      expect(validateCheckIn({ ...ok, ...bad }, TODAY)).toHaveProperty("error");
    }
  });
  it("checks the dates: check-out not before check-in, check-in not in the future", () => {
    expect(validateCheckIn({ ...ok, checkOut: "2026-11-25" }, TODAY)).toHaveProperty("error");
    expect(validateCheckIn({ ...ok, checkIn: "2026-11-27", checkOut: "2026-11-28" }, TODAY)).toHaveProperty("error");
    expect(validateCheckIn({ ...ok, checkIn: "2026-11-24" }, TODAY)).toHaveProperty("checkIn", "2026-11-24"); // entered late
  });
});

describe("included breakfast bill (owner: Rs 800 per person)", () => {
  const items = [{ name: "Eggs on toast", isBreakfast: true }, { name: "Americano", isBreakfast: true }];
  it("is the fixed price times the breakfasts, whatever the items cost", () => {
    expect(breakfastBill(items, 2, 800)).toEqual({ total: 1600 });
  });
  it("refuses an item not marked breakfast, and a count below 1", () => {
    expect(breakfastBill([...items, { name: "Club sandwich", isBreakfast: false }], 2, 800)).toEqual({ error: "Club sandwich is not a breakfast item. Put it on a separate bill as an extra for the guest." });
    expect(breakfastBill(items, 0, 800)).toHaveProperty("error");
  });
});

describe("LHC's cost of a breakfast (admin and accountant only)", () => {
  it("adds the recipe costs; an item with no recipe cost uses its menu price for now, and is named", () => {
    const r = breakfastCost([
      { name: "Eggs on toast", quantity: 2, unitCost: "95.5000", unitPrice: "450" },
      { name: "Americano", quantity: 2, unitCost: null, unitPrice: "250" },
    ]);
    expect(r).toEqual({ cost: 691, noRecipeCost: ["Americano"] });
  });
});
