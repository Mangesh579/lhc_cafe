import { describe, it, expect } from "vitest";
import { nepalDay, dayRangeUtc, cashSalesOf, ordersOnDay } from "../lib/ledgerData";
import { order } from "./helpers";

// Nepal is UTC+5:45. 11:50 pm Nepal on 20 Nov = 18:05 UTC on 20 Nov; 12:10 am Nepal on 21 Nov = 18:25 UTC on 20 Nov.
const AT_2350_NPT = "2026-11-20T18:05:00.000Z";
const AT_0010_NPT = "2026-11-20T18:25:00.000Z";

describe("Nepal day boundary", () => {
  it("puts an order paid at 11:50 pm Nepal time on that Nepal day", () => {
    expect(nepalDay(AT_2350_NPT)).toBe("2026-11-20");
  });

  it("puts an order paid at 12:10 am Nepal time on the next Nepal day", () => {
    expect(nepalDay(AT_0010_NPT)).toBe("2026-11-21");
  });

  it("does not use the UTC date (both moments are 20 Nov in UTC)", () => {
    expect(AT_2350_NPT.slice(0, 10)).toBe(AT_0010_NPT.slice(0, 10));
    expect(nepalDay(AT_2350_NPT)).not.toBe(nepalDay(AT_0010_NPT));
  });

  it("dayRangeUtc covers 00:00 to 23:59:59.999 Nepal time", () => {
    const r = dayRangeUtc("2026-11-20");
    expect(r.from.toISOString()).toBe("2026-11-19T18:15:00.000Z");
    expect(r.to.toISOString()).toBe("2026-11-20T18:14:59.999Z");
    const t2350 = new Date(AT_2350_NPT).getTime(), t0010 = new Date(AT_0010_NPT).getTime();
    expect(t2350 >= r.from.getTime() && t2350 <= r.to.getTime()).toBe(true);
    expect(t0010 > r.to.getTime()).toBe(true);
    const next = dayRangeUtc("2026-11-21");
    expect(t0010 >= next.from.getTime() && t0010 <= next.to.getTime()).toBe(true);
  });

  it("the cash drawer of each day gets the right bill", () => {
    const late = order({ total: 500, method: "cash", at: AT_2350_NPT });
    const early = order({ total: 300, method: "cash", at: AT_0010_NPT });
    expect(cashSalesOf(ordersOnDay([late, early], "2026-11-20")).map(x => x.amount)).toEqual([500]);
    expect(cashSalesOf(ordersOnDay([late, early], "2026-11-21")).map(x => x.amount)).toEqual([300]);
  });

  it("handles the exact edges of the day", () => {
    expect(nepalDay("2026-11-19T18:15:00.000Z")).toBe("2026-11-20"); // 00:00:00 Nepal
    expect(nepalDay("2026-11-19T18:14:59.999Z")).toBe("2026-11-19"); // 23:59:59.999 Nepal, day before
  });
});
