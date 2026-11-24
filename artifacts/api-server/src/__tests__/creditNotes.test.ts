import { describe, it, expect } from "vitest";
import { buildCreditNote, type InvoiceItem } from "../lib/receivableRules";

// Invoice: 2 x Latte @ 355 + 1 x Momo @ 250 = 960, 10% staff discount -> 864 before VAT
const items: InvoiceItem[] = [
  { id: 1, name: "Latte", quantity: 2, unitPrice: 355, creditedQty: 0 },
  { id: 2, name: "Momo", quantity: 1, unitPrice: 250, creditedQty: 0 },
];
const panInvoice = { items, itemsSubtotal: 960, netPreVat: 864, vatAmount: 0, maxCredit: 864 };
const vatInvoice = { items, itemsSubtotal: 960, netPreVat: 864, vatAmount: 112.32, maxCredit: 976.32 };

describe("item-wise credit notes", () => {
  it("credits an item at the price actually charged (after the bill's discount)", () => {
    expect(buildCreditNote([{ orderItemId: 1, quantity: 1 }], panInvoice)).toEqual({
      lines: [{ orderItemId: 1, description: "Latte", quantity: 1, unitPrice: 319.5, amount: 319.5 }], subtotal: 319.5, vatAmount: 0, total: 319.5,
    });
  });

  it("credits VAT at the invoice's rate on a VAT bill", () => {
    expect(buildCreditNote([{ orderItemId: 2, quantity: 1 }], vatInvoice)).toMatchObject({ subtotal: 225, vatAmount: 29.25, total: 254.25 });
  });

  it("allows a lower amount (price allowance) but not a higher one", () => {
    expect(buildCreditNote([{ orderItemId: 1, quantity: 1, amount: 100 }], panInvoice)).toMatchObject({ total: 100 });
    expect(buildCreditNote([{ orderItemId: 1, quantity: 1, amount: 400 }], panInvoice)).toHaveProperty("error");
  });

  it("cannot credit more of an item than was sold, counting earlier credit notes", () => {
    expect(buildCreditNote([{ orderItemId: 1, quantity: 3 }], panInvoice)).toHaveProperty("error");
    const once = { ...panInvoice, items: [{ ...items[0], creditedQty: 1 }, items[1]] };
    expect(buildCreditNote([{ orderItemId: 1, quantity: 2 }], once)).toHaveProperty("error");
    expect(buildCreditNote([{ orderItemId: 1, quantity: 1 }, { orderItemId: 1, quantity: 1 }], once)).toHaveProperty("error");
    expect(buildCreditNote([{ orderItemId: 1, quantity: 1 }], once)).toHaveProperty("lines");
  });

  it("cannot credit more than is still owed on the invoice", () => {
    expect(buildCreditNote([{ orderItemId: 1, quantity: 1 }], { ...panInvoice, maxCredit: 200 })).toHaveProperty("error");
  });

  it("refuses items not on the invoice, empty notes and zero quantities", () => {
    expect(buildCreditNote([{ orderItemId: 9, quantity: 1 }], panInvoice)).toHaveProperty("error");
    expect(buildCreditNote([], panInvoice)).toHaveProperty("error");
    expect(buildCreditNote([{ orderItemId: 1, quantity: 0 }], panInvoice)).toHaveProperty("error");
  });
});
