import { describe, it, expect } from "vitest";
import { validateCheckIn, breakfastBill, breakfastCost, allocateTotal, stayText, breakfastWarning } from "../lib/stayRules";

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

// 2026-11-27: the Rs 800 x breakfasts total is spread over the item lines, so item and category reports add up to the invoice
describe("breakfast lines share the invoice total", () => {
  it("in proportion to their menu value, to the paisa, the last line taking the remainder", () => {
    const r = allocateTotal([{ id: 1, quantity: 2, subtotal: 900 }, { id: 2, quantity: 2, subtotal: 500 }], 1600);
    expect(r).toEqual([{ id: 1, subtotal: 1028.57, unitPrice: 514.29 }, { id: 2, subtotal: 571.43, unitPrice: 285.71 }]);
    expect(r.reduce((s, l) => s + l.subtotal, 0)).toBeCloseTo(1600, 2);
  });
  it("lines with no menu value share by quantity", () => {
    expect(allocateTotal([{ id: 1, quantity: 1, subtotal: 0 }, { id: 2, quantity: 3, subtotal: 0 }], 800)).toEqual([{ id: 1, subtotal: 200, unitPrice: 200 }, { id: 2, subtotal: 600, unitPrice: 200 }]);
  });
});

// 2026-11-27: breakfast invoices name the guest, the room and the breakfasts (invoice, printed bill, Sulimha statement)
describe("stay label on an invoice", () => {
  it("a breakfast bill says how many, which room and which guest; an extra says the room and guest", () => {
    expect(stayText({ room: "103", guestName: "Ram Thapa", stayCharge: "breakfast", breakfastCount: 2 })).toBe("Hotel breakfast x 2 · Room 103 · Ram Thapa");
    expect(stayText({ room: "201", guestName: "Sita Rai", stayCharge: "extra", breakfastCount: null })).toBe("Room 201 · Sita Rai (charged to room)");
    expect(stayText(null)).toBe("");
  });
});

describe("breakfasts over guests (a warning, never a block)", () => {
  it("warns only when today's breakfasts with this bill are more than the guests", () => {
    expect(breakfastWarning(0, 2, 2, 0)).toBeNull();
    expect(breakfastWarning(2, 1, 2, 1)).toBeNull();
    expect(breakfastWarning(2, 1, 2, 0)).toBe("3 breakfasts today for 2 guests in this room (2 already billed). Check before the next one.");
  });
});
