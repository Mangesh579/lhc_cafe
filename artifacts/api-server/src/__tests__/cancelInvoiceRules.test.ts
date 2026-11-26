import { describe, it, expect } from "vitest";
import { fullCreditNote, type InvoiceItem } from "../lib/receivableRules";

const item = (o: Partial<InvoiceItem>): InvoiceItem => ({ id: 1, name: "Latte", quantity: 1, unitPrice: 100, creditedQty: 0, ...o });

describe("full credit note (cancel or wrong customer)", () => {
  it("credits every item still on the invoice, to the paisa of what is owed", () => {
    // 3 lattes at 100 with a 10 discount: sold for 290; each line 96.67, the last takes the remainder
    const r = fullCreditNote({ items: [item({ quantity: 3 })], itemsSubtotal: 300, netPreVat: 290, vatAmount: 0, maxCredit: 290 }) as any;
    expect(r.total).toBe(290);
    expect(r.lines).toEqual([{ orderItemId: 1, description: "Latte", quantity: 3, unitPrice: 96.67, amount: 290 }]);
  });

  it("splits a rounding paisa onto the last line and keeps VAT on the bill's ratio", () => {
    // two items, 33.33 + 66.67 after a third off; VAT 13%: owed 113.00
    const items = [item({ id: 1, name: "Tea", unitPrice: 50 }), item({ id: 2, name: "Cake", unitPrice: 100 })];
    const r = fullCreditNote({ items, itemsSubtotal: 150, netPreVat: 100, vatAmount: 13, maxCredit: 113 }) as any;
    expect([r.subtotal, r.vatAmount, r.total]).toEqual([100, 13, 113]);
    expect(r.lines.map((l: any) => l.amount)).toEqual([33.33, 66.67]);
  });

  it("credits only what an earlier item-wise credit note left", () => {
    const r = fullCreditNote({ items: [item({ id: 1, quantity: 2, creditedQty: 1 }), item({ id: 2, name: "Cake", creditedQty: 1 })], itemsSubtotal: 300, netPreVat: 300, vatAmount: 0, maxCredit: 100 }) as any;
    expect(r.lines).toEqual([{ orderItemId: 1, description: "Latte", quantity: 1, unitPrice: 100, amount: 100 }]);
    expect(r.total).toBe(100);
  });

  it("refuses when nothing is left to credit", () => {
    expect(fullCreditNote({ items: [item({ creditedQty: 1 })], itemsSubtotal: 100, netPreVat: 100, vatAmount: 0, maxCredit: 0 })).toHaveProperty("error");
  });
});
