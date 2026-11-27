// Double-entry rules (step 3a). Pure functions, unit tested. The database enforces the same (013 triggers) as a backstop.
import { round2 } from "./payments";

export type AccountInfo = { code: string; name: string; isPostable: boolean; active: boolean; normalSide: string };
export type EntryLine = { accountCode: string; debit: number; credit: number; customerId: number | null; supplierId: number | null; memo: string | null };

export const RECEIVABLE = "1300";   // customers are its sub-ledger
export const PAYABLE = "2100";      // suppliers are its sub-ledger
export const OPENING_EQUITY = "3050";

const amt = (v: unknown) => { const n = round2(parseFloat(String(v ?? 0)) || 0); return n > 0 ? n : 0; };

// Cleans and checks an entry's lines: at least two, exactly one side each, postable active accounts, the customer on 1300
// and the supplier on 2100 (and only there), total debit = total credit to the paisa.
export function checkEntryLines(raw: unknown, accounts: Map<string, AccountInfo>): { lines: EntryLine[]; total: number } | { error: string } {
  if (!Array.isArray(raw) || raw.length < 2) return { error: "An entry needs at least two lines." };
  if (raw.length > 200) return { error: "Too many lines." };
  const lines: EntryLine[] = [];
  for (const [i, r] of (raw as any[]).entries()) {
    const n = i + 1;
    const accountCode = String(r?.accountCode ?? "").trim();
    const a = accounts.get(accountCode);
    if (!a) return { error: `Line ${n}: choose an account.` };
    if (!a.isPostable) return { error: `Line ${n}: ${a.code} ${a.name} is a header and cannot be posted to.` };
    if (!a.active) return { error: `Line ${n}: ${a.code} ${a.name} is inactive.` };
    const debit = amt(r?.debit), credit = amt(r?.credit);
    if ((debit > 0) === (credit > 0)) return { error: `Line ${n}: enter a debit or a credit (one, above 0).` };
    const customerId = r?.customerId ? Number(r.customerId) : null;
    const supplierId = r?.supplierId ? Number(r.supplierId) : null;
    if (accountCode === RECEIVABLE && !customerId) return { error: `Line ${n}: choose the customer for 1300 Accounts Receivable.` };
    if (accountCode === PAYABLE && !supplierId) return { error: `Line ${n}: choose the supplier for 2100 Accounts Payable.` };
    if (customerId && accountCode !== RECEIVABLE) return { error: `Line ${n}: a customer belongs only on 1300.` };
    if (supplierId && accountCode !== PAYABLE) return { error: `Line ${n}: a supplier belongs only on 2100.` };
    const memo = String(r?.memo ?? "").trim().slice(0, 200) || null;
    lines.push({ accountCode, debit, credit, customerId, supplierId, memo });
  }
  const d = round2(lines.reduce((s, l) => s + l.debit, 0)), c = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(d - c) >= 0.005) return { error: `The entry does not balance: debit Rs. ${d.toFixed(2)}, credit Rs. ${c.toFixed(2)}.` };
  return { lines, total: d };
}

// Balance in the account's normal direction: a debit account shows debit - credit, a credit account credit - debit
// (a negative balance is on the unusual side, e.g. a customer who paid in advance)
export function accountBalance(normalSide: string, debit: number, credit: number): number {
  return normalSide === "credit" ? round2(credit - debit) : round2(debit - credit);
}

// A reversing entry: every line with its sides swapped, sub-ledger kept
export function mirrorLines(lines: EntryLine[]): EntryLine[] {
  return lines.map(l => ({ ...l, debit: l.credit, credit: l.debit }));
}

// The opening entry's balancing line on 3050 Opening balance equity (owner, 2026-11-27), or null when it already balances
export function openingBalancer(lines: { debit: number; credit: number }[]): { accountCode: string; debit: number; credit: number } | null {
  const diff = round2(lines.reduce((s, l) => s + l.debit - l.credit, 0));
  if (Math.abs(diff) < 0.005) return null;
  return diff > 0 ? { accountCode: OPENING_EQUITY, debit: 0, credit: diff } : { accountCode: OPENING_EQUITY, debit: -diff, credit: 0 };
}
