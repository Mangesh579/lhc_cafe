import { db, supplierPaymentsTable, suppliersTable, purchaseBillsTable } from "@workspace/db";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { round2 } from "./payments";

// Active supplier payments in a range of days, for the cash drawer and the ledgers (paid_via: drawer | cheque | online)
export async function supplierPaymentsBetween(fromDay: string, toDay: string, via: string[]) {
  const rows = await db.select({ p: supplierPaymentsTable, supplierName: suppliersTable.name })
    .from(supplierPaymentsTable).innerJoin(suppliersTable, eq(supplierPaymentsTable.supplierId, suppliersTable.id))
    .where(and(eq(supplierPaymentsTable.status, "active"), gte(supplierPaymentsTable.paymentDate, fromDay), lte(supplierPaymentsTable.paymentDate, toDay), inArray(supplierPaymentsTable.paidVia, via)))
    .orderBy(supplierPaymentsTable.id);
  return rows.map(r => ({ ...r.p, supplierName: r.supplierName, amount: round2(parseFloat(String(r.p.amount))) }));
}

// Purchase bills paid when bought by cheque or online (part A), for the bank ledger
export async function bankPaidBillsBetween(fromDay: string, toDay: string) {
  const rows = await db.select().from(purchaseBillsTable).where(and(
    eq(purchaseBillsTable.status, "active"), eq(purchaseBillsTable.terms, "cash"), inArray(purchaseBillsTable.paidVia, ["cheque", "online"]),
    gte(purchaseBillsTable.billDate, fromDay), lte(purchaseBillsTable.billDate, toDay)));
  return rows.map(b => ({ ...b, total: round2(parseFloat(String(b.total))) }));
}
