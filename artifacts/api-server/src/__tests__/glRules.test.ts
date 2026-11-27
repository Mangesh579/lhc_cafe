import { describe, it, expect } from "vitest";
import { checkEntryLines, accountBalance, openingBalancer, mirrorLines, type AccountInfo } from "../lib/glRules";

const acc = (code: string, o: Partial<AccountInfo> = {}): [string, AccountInfo] => [code, { code, name: code, isPostable: true, active: true, normalSide: "debit", ...o }];
const accounts = new Map<string, AccountInfo>([acc("1100"), acc("1300"), acc("2100", { normalSide: "credit" }), acc("4000", { normalSide: "credit" }), acc("1000", { isPostable: false }), acc("7110", { active: false }), acc("3050", { normalSide: "credit" })]);

describe("a journal entry's lines", () => {
  it("balance to the paisa, one side each, rounded", () => {
    const r = checkEntryLines([{ accountCode: "1100", debit: 100.004 }, { accountCode: "4000", credit: "100" }], accounts);
    expect(r).toEqual({ lines: [{ accountCode: "1100", debit: 100, credit: 0, customerId: null, supplierId: null, memo: null }, { accountCode: "4000", debit: 0, credit: 100, customerId: null, supplierId: null, memo: null }], total: 100 });
  });
  it("refuse an unbalanced entry, a single line, a line with both or neither side", () => {
    expect(checkEntryLines([{ accountCode: "1100", debit: 100 }, { accountCode: "4000", credit: 90 }], accounts)).toHaveProperty("error");
    expect(checkEntryLines([{ accountCode: "1100", debit: 100 }], accounts)).toHaveProperty("error");
    expect(checkEntryLines([{ accountCode: "1100", debit: 100, credit: 100 }, { accountCode: "4000", credit: 0 }], accounts)).toHaveProperty("error");
  });
  it("refuse a header, an inactive or an unknown account", () => {
    for (const code of ["1000", "7110", "9999"]) expect(checkEntryLines([{ accountCode: code, debit: 1 }, { accountCode: "4000", credit: 1 }], accounts)).toHaveProperty("error");
  });
  it("need the customer on 1300 and the supplier on 2100 (the sub-ledgers), and nowhere else", () => {
    expect(checkEntryLines([{ accountCode: "1300", debit: 50 }, { accountCode: "4000", credit: 50 }], accounts)).toEqual({ error: "Line 1: choose the customer for 1300 Accounts Receivable." });
    expect(checkEntryLines([{ accountCode: "1100", debit: 50 }, { accountCode: "2100", credit: 50 }], accounts)).toEqual({ error: "Line 2: choose the supplier for 2100 Accounts Payable." });
    expect(checkEntryLines([{ accountCode: "1100", debit: 50, customerId: 3 }, { accountCode: "4000", credit: 50 }], accounts)).toHaveProperty("error");
    expect(checkEntryLines([{ accountCode: "1300", debit: 50, customerId: 3 }, { accountCode: "4000", credit: 50 }], accounts)).toHaveProperty("lines");
  });
});

describe("balances and reversals", () => {
  it("an account's balance follows its normal side", () => {
    expect(accountBalance("debit", 500, 200)).toBe(300);
    expect(accountBalance("credit", 500, 200)).toBe(-300);
  });
  it("a reversal swaps every line's sides and keeps the sub-ledger", () => {
    expect(mirrorLines([{ accountCode: "1300", debit: 50, credit: 0, customerId: 3, supplierId: null, memo: "x" }, { accountCode: "4000", debit: 0, credit: 50, customerId: null, supplierId: null, memo: null }]))
      .toEqual([{ accountCode: "1300", debit: 0, credit: 50, customerId: 3, supplierId: null, memo: "x" }, { accountCode: "4000", debit: 50, credit: 0, customerId: null, supplierId: null, memo: null }]);
  });
});

describe("opening balances", () => {
  it("3050 Opening balance equity takes the difference so the entry balances", () => {
    expect(openingBalancer([{ debit: 5000, credit: 0 }, { debit: 1200, credit: 0 }, { debit: 0, credit: 2000 }])).toEqual({ accountCode: "3050", debit: 0, credit: 4200 });
    expect(openingBalancer([{ debit: 100, credit: 0 }, { debit: 0, credit: 300 }])).toEqual({ accountCode: "3050", debit: 200, credit: 0 });
    expect(openingBalancer([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }])).toBeNull();
  });
});
