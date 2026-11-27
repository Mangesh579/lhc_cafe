// Opening balances (step 3a; owner, 2026-11-27): a draft, editable with an audit trail and marked dummy until the owner
// confirms it. Receivables, payables, inventory and cash are filled from the app's own figures; banks, equipment and anything
// else are typed; 3050 Opening balance equity balances the entry. Confirming posts one opening journal entry on the start date.
import { openingBalanceLinesTable, openingBalanceLogTable, ledgerSettingsTable, accountsTable, loyaltyCustomersTable, suppliersTable, cashDaysTable, inventoryItemsTable, purchaseBillsTable } from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { checkEntryLines, openingBalancer, RECEIVABLE, PAYABLE, OPENING_EQUITY } from "./glRules";
import { ledgerSettings, accountMap, postEntry, LedgerError } from "./ledger";
import { customerBalances } from "./receivables";
import { loadBills, advancesBySupplier } from "./payables";
import { round2 } from "./payments";

type Db = any;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

async function log(tx: Db, action: string, details: string, user: string) {
  await tx.insert(openingBalanceLogTable).values({ action, details, changedBy: user });
}

async function mustBeDraft(tx: Db) {
  const s = await ledgerSettings(tx);
  if (s.openingStatus !== "draft") throw new LedgerError(400, "The opening balances are confirmed and posted. Correct them with a journal voucher.");
  return s;
}

export async function openingDraft(ex: Db) {
  const s = await ledgerSettings(ex);
  const lines = await ex.select({ l: openingBalanceLinesTable, accountName: accountsTable.name, customerName: loyaltyCustomersTable.name, supplierName: suppliersTable.name })
    .from(openingBalanceLinesTable)
    .leftJoin(accountsTable, eq(accountsTable.code, openingBalanceLinesTable.accountCode))
    .leftJoin(loyaltyCustomersTable, eq(loyaltyCustomersTable.id, openingBalanceLinesTable.customerId))
    .leftJoin(suppliersTable, eq(suppliersTable.id, openingBalanceLinesTable.supplierId))
    .orderBy(asc(openingBalanceLinesTable.accountCode), asc(openingBalanceLinesTable.id));
  const rows = lines.map((r: any) => ({ ...r.l, debit: num(r.l.debit), credit: num(r.l.credit), accountName: r.accountName, customerName: r.customerName, supplierName: r.supplierName }));
  const balancer = openingBalancer(rows);
  const logRows = await ex.select().from(openingBalanceLogTable).orderBy(desc(openingBalanceLogTable.id)).limit(100);
  return {
    status: s.openingStatus, dummy: s.openingStatus === "draft", startDate: s.startDate, entryId: s.openingEntryId, confirmedBy: s.openingConfirmedBy, confirmedAt: s.openingConfirmedAt,
    lines: rows, balancer, totalDebit: round2(rows.reduce((t: number, r: any) => t + r.debit, 0) + (balancer?.debit ?? 0)), totalCredit: round2(rows.reduce((t: number, r: any) => t + r.credit, 0) + (balancer?.credit ?? 0)),
    log: logRows,
  };
}

// The app's own figures as at now (fill again on the start date): drawer cash, each customer's balance, each supplier's
// balance (bills less advances), and stock x cost per unit by department. Replaces the earlier "system" lines only.
export async function fillFromSystem(tx: Db, user: string) {
  await mustBeDraft(tx);
  await tx.delete(openingBalanceLinesTable).where(eq(openingBalanceLinesTable.source, "system"));
  const lines: { accountCode: string; customerId?: number; supplierId?: number; debit: number; credit: number; memo: string }[] = [];
  const side = (v: number) => (v >= 0 ? { debit: round2(v), credit: 0 } : { debit: 0, credit: round2(-v) });

  const [day] = await tx.select().from(cashDaysTable).where(eq(cashDaysTable.status, "closed")).orderBy(desc(cashDaysTable.day)).limit(1);
  if (day?.countedClosing != null && num(day.countedClosing) > 0) lines.push({ accountCode: "1100", ...side(num(day.countedClosing)), memo: `Drawer counted at the close of ${day.day}` });

  for (const c of await customerBalances(undefined, tx)) {
    if (Math.abs(c.balance) >= 0.005) lines.push({ accountCode: RECEIVABLE, customerId: c.customerId, ...side(c.balance), memo: `${c.name}: balance in Receivables` });
  }

  const bySupplier = new Map<number, number>();
  for (const b of await loadBills(tx, eq(purchaseBillsTable.status, "active"))) if (b.balance) bySupplier.set(b.supplierId, round2((bySupplier.get(b.supplierId) ?? 0) + b.balance));
  for (const [id, adv] of await advancesBySupplier(tx)) if (adv) bySupplier.set(id, round2((bySupplier.get(id) ?? 0) - adv));
  for (const [supplierId, owed] of bySupplier) {
    if (Math.abs(owed) >= 0.005) lines.push({ accountCode: PAYABLE, supplierId, ...(owed > 0 ? { debit: 0, credit: owed } : { debit: -owed, credit: 0 }), memo: owed > 0 ? "Unpaid bills" : "Advance with the supplier" });
  }

  const stock = { kitchen: 0, drink: 0 }; let noCost = 0;
  for (const i of await tx.select().from(inventoryItemsTable)) {
    const q = num(i.currentStock);
    if (!(q > 0)) continue;
    if (i.costPerUnit == null) { noCost++; continue; }
    stock[i.department === "drink" ? "drink" : "kitchen"] += q * num(i.costPerUnit);
  }
  const note = noCost ? ` (${noCost} item${noCost === 1 ? "" : "s"} in stock with no cost per unit left out)` : "";
  if (stock.kitchen >= 0.005) lines.push({ accountCode: "1400", debit: round2(stock.kitchen), credit: 0, memo: `Stock x cost per unit, kitchen${note}` });
  if (stock.drink >= 0.005) lines.push({ accountCode: "1410", debit: round2(stock.drink), credit: 0, memo: `Stock x cost per unit, drinks${note}` });

  for (const l of lines) await tx.insert(openingBalanceLinesTable).values({ accountCode: l.accountCode, customerId: l.customerId ?? null, supplierId: l.supplierId ?? null, debit: String(l.debit), credit: String(l.credit), source: "system", memo: l.memo, updatedBy: user });
  await log(tx, "filled", `Filled ${lines.length} line(s) from the app's figures (cash, receivables, payables, stock)`, user);
  return lines.length;
}

// Add or change one line (typed, or an adjustment of a filled one). 3050 is worked out, not typed.
export async function saveLine(tx: Db, id: number | null, raw: any, user: string) {
  await mustBeDraft(tx);
  if (String(raw?.accountCode ?? "") === OPENING_EQUITY) throw new LedgerError(400, "3050 Opening balance equity is worked out from the other lines.");
  const v = checkEntryLines([raw, { accountCode: OPENING_EQUITY, debit: num(raw?.credit), credit: num(raw?.debit) }], await accountMap(tx));
  if ("error" in v) throw new LedgerError(400, v.error.replace("Line 1: ", ""));
  const l = v.lines[0];
  const values = { accountCode: l.accountCode, customerId: l.customerId, supplierId: l.supplierId, debit: String(l.debit), credit: String(l.credit), memo: l.memo, updatedBy: user, updatedAt: new Date() };
  if (id) {
    const [old] = await tx.select().from(openingBalanceLinesTable).where(eq(openingBalanceLinesTable.id, id));
    if (!old) throw new LedgerError(404, "Line not found.");
    await tx.update(openingBalanceLinesTable).set(values).where(eq(openingBalanceLinesTable.id, id));
    await log(tx, "changed", `${old.accountCode} Dr ${num(old.debit).toFixed(2)} Cr ${num(old.credit).toFixed(2)} -> ${l.accountCode} Dr ${l.debit.toFixed(2)} Cr ${l.credit.toFixed(2)}${l.memo ? ` (${l.memo})` : ""}`, user);
    return id;
  }
  const [row] = await tx.insert(openingBalanceLinesTable).values({ ...values, source: "typed" }).returning();
  await log(tx, "added", `${l.accountCode} Dr ${l.debit.toFixed(2)} Cr ${l.credit.toFixed(2)}${l.memo ? ` (${l.memo})` : ""}`, user);
  return row.id;
}

export async function removeLine(tx: Db, id: number, user: string) {
  await mustBeDraft(tx);
  const [old] = await tx.select().from(openingBalanceLinesTable).where(eq(openingBalanceLinesTable.id, id));
  if (!old) throw new LedgerError(404, "Line not found.");
  await tx.delete(openingBalanceLinesTable).where(eq(openingBalanceLinesTable.id, id));
  await log(tx, "removed", `${old.accountCode} Dr ${num(old.debit).toFixed(2)} Cr ${num(old.credit).toFixed(2)}${old.memo ? ` (${old.memo})` : ""}`, user);
}

// The owner confirms: one opening entry on the start date (3050 balances it); the draft becomes read-only
export async function confirmOpening(tx: Db, user: string) {
  const s = await mustBeDraft(tx);
  const rows = await tx.select().from(openingBalanceLinesTable).orderBy(asc(openingBalanceLinesTable.accountCode), asc(openingBalanceLinesTable.id));
  if (!rows.length) throw new LedgerError(400, "There are no opening balances to confirm. Fill them from the app or type them first.");
  const lines: any[] = rows.map((r: any) => ({ accountCode: r.accountCode, customerId: r.customerId, supplierId: r.supplierId, debit: num(r.debit), credit: num(r.credit), memo: r.memo }));
  const b = openingBalancer(lines);
  if (b) lines.push({ ...b, memo: "Difference to opening balance equity" });
  const entry = await postEntry(tx, { entryDate: s.startDate, voucherType: "OPEN", narration: `Opening balances at ${s.startDate}`, kind: "opening", sourceType: "opening", sourceId: 1, lines, user });
  await tx.update(ledgerSettingsTable).set({ openingStatus: "confirmed", openingEntryId: entry.id, openingConfirmedBy: user, openingConfirmedAt: new Date(), updatedBy: user, updatedAt: new Date() }).where(eq(ledgerSettingsTable.id, 1));
  await log(tx, "confirmed", `Confirmed and posted as ${entry.entryNo}`, user);
  return entry;
}
