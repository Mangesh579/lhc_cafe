// Converting an open monthly-account bill into individual credit invoices (one per visit, dated on the visit day).
// Preview and conversion use the same plan (lib/accountConversion.ts planBill, groupBy "visit").
// Every function takes the database (or transaction) to use, so tests can run it on an in-memory Postgres.
import { createHash } from "node:crypto";
import {
  ordersTable, orderItemsTable, menuItemsTable, loyaltyCustomersTable, orderKotCancellationsTable, loyaltyRedemptionsTable,
  orderPaymentsTable, accountConversionsTable, accountConversionInvoicesTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { planBill, type PlannedBill, type Issue, type BillIn, type ItemIn } from "./accountConversion";
import { fiscalLabel, nextInvoiceNumber } from "./fiscal";
import { customerBalances } from "./receivables";
import { nepalDay } from "./ledgerData";
import { round2 } from "./payments";

type Db = any; // a drizzle database or transaction
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

export class ConversionError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

export function safeFiscalLabel(d: Date): string {
  try { return fiscalLabel(d); } catch { return "unknown"; }
}

// Everything about one open bill needed to plan it (and, for conversion, to copy its items)
export async function loadBill(ex: Db, billId: number) {
  const [b] = await ex.select({
    id: ordersTable.id, customerId: ordersTable.loyaltyCustomerId, customerName: loyaltyCustomersTable.name, customerPhone: loyaltyCustomersTable.phone,
    customerPaysMonthly: loyaltyCustomersTable.paysMonthly, createdAt: ordersTable.createdAt, createdBy: ordersTable.createdBy, backdatedAt: ordersTable.backdatedAt,
    totalAmount: ordersTable.totalAmount, discountAmount: ordersTable.discountAmount, vatAmount: ordersTable.vatAmount,
    invoiceNumber: ordersTable.invoiceNumber, isNc: ordersTable.isNc, paymentStatus: ordersTable.paymentStatus, orderStatus: ordersTable.orderStatus,
    accountBill: ordersTable.accountBill, notes: ordersTable.notes,
  }).from(ordersTable).leftJoin(loyaltyCustomersTable, eq(ordersTable.loyaltyCustomerId, loyaltyCustomersTable.id)).where(eq(ordersTable.id, billId));
  if (!b) return null;
  const rows = await ex.select({ item: orderItemsTable, name: menuItemsTable.name })
    .from(orderItemsTable).leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
    .where(eq(orderItemsTable.orderId, billId)).orderBy(orderItemsTable.kotNumber, orderItemsTable.id);
  const cancels = await ex.select().from(orderKotCancellationsTable).where(eq(orderKotCancellationsTable.orderId, billId));
  const redemptions = await ex.select().from(loyaltyRedemptionsTable).where(eq(loyaltyRedemptionsTable.orderId, billId));
  const pays = await ex.select({ id: orderPaymentsTable.id }).from(orderPaymentsTable).where(eq(orderPaymentsTable.orderId, billId));
  const others = b.customerId ? await ex.select({ id: ordersTable.id }).from(ordersTable).where(and(
    eq(ordersTable.loyaltyCustomerId, b.customerId), eq(ordersTable.accountBill, true), eq(ordersTable.paymentStatus, "pending"),
    sql`${ordersTable.orderStatus} <> 'cancelled'`, sql`${ordersTable.id} <> ${billId}`)) : [];
  const [already] = await ex.select({ id: accountConversionsTable.id }).from(accountConversionsTable).where(eq(accountConversionsTable.oldOrderId, billId));

  const billIn: BillIn = {
    id: b.id, customerId: b.customerId, customerName: b.customerName ?? null, customerPhone: b.customerPhone ?? null, customerPaysMonthly: b.customerPaysMonthly ?? null,
    createdAt: new Date(b.createdAt), backdatedAt: b.backdatedAt ? new Date(b.backdatedAt) : null,
    totalAmount: num(b.totalAmount), discountAmount: num(b.discountAmount), vatAmount: num(b.vatAmount),
    invoiceNumber: b.invoiceNumber, isNc: b.isNc, paymentStatus: b.paymentStatus, notes: b.notes, paymentRows: pays.length,
  };
  const itemsIn: ItemIn[] = rows.map((r: any) => ({
    id: r.item.id, orderId: r.item.orderId, name: r.name ?? `Item #${r.item.id}`, quantity: r.item.quantity, unitPrice: num(r.item.unitPrice), subtotal: num(r.item.subtotal),
    kotNumber: r.item.kotNumber ?? 1, kotAt: r.item.kotAt ? new Date(r.item.kotAt) : null, kotTable: r.item.kotTable, kotBy: r.item.kotBy, kotNote: r.item.kotNote,
  }));
  return {
    raw: b, billIn, itemsIn, itemRows: rows.map((r: any) => r.item),
    cancels: cancels.map((c: any) => ({ orderId: c.orderId, kotNumber: c.kotNumber, itemsText: c.itemsText, amount: num(c.amount), reason: c.reason, cancelledBy: c.cancelledBy, cancelledAt: new Date(c.cancelledAt) })),
    redemptions: redemptions.map((r: any) => ({ orderId: r.orderId, level: r.level, redeemedAt: new Date(r.redeemedAt) })),
    otherOpenBills: others.length, alreadyConverted: !!already,
  };
}

// Extra reasons a bill cannot be converted, on top of the dry run's blockers
export function conversionRefusals(plan: PlannedBill, bill: { accountBill: boolean; paymentStatus: string; vatAmount: number }, currentFiscalYear: string, alreadyConverted: boolean): Issue[] {
  const out: Issue[] = plan.issues.filter(i => i.level === "blocker");
  if (alreadyConverted || bill.paymentStatus === "converted") out.push({ level: "blocker", code: "already_converted", message: "This bill has already been converted." });
  if (!bill.accountBill) out.push({ level: "blocker", code: "not_account_bill", message: "This is not a monthly-account bill." });
  if (bill.vatAmount > 0) out.push({ level: "blocker", code: "vat", message: "The bill carries VAT, which cannot yet be split per invoice." });
  if (plan.invoices.length === 0) out.push({ level: "blocker", code: "nothing", message: "There is nothing to convert." });
  const unknown = plan.invoices.filter(i => i.fiscalYear === "unknown");
  if (unknown.length) out.push({ level: "blocker", code: "fiscal_year_unknown", message: `The fiscal year of ${unknown.length} visit(s) could not be worked out.` });
  const other = plan.invoices.filter(i => i.fiscalYear !== "unknown" && i.fiscalYear !== currentFiscalYear);
  if (other.length) {
    out.push({ level: "blocker", code: "fiscal_year", message: `${other.length} visit(s) fall in fiscal year ${[...new Set(other.map(i => i.fiscalYear))].join(", ")}, not the current ${currentFiscalYear}. Issuing invoices in an earlier year's series could change a year whose sales register may already be filed, so this bill is refused. Ask the accountant how to handle it.` });
  }
  // de-duplicate by code
  return out.filter((x, i) => out.findIndex(y => y.code === x.code) === i);
}

// A digest of what the preview showed. The confirm step must send it back; if the bill changed in between, conversion is refused.
export function fingerprintOf(plan: PlannedBill, items: ItemIn[]): string {
  const body = JSON.stringify({
    bill: plan.billId, total: plan.billTotal, discount: plan.discount, vat: plan.vat, customer: plan.customer.id,
    items: items.map(i => [i.id, i.kotNumber, i.quantity, i.subtotal, i.kotAt?.toISOString() ?? null, i.kotTable]),
    invoices: plan.invoices.map(i => [i.key, i.firstAt, i.total, i.discountShare]),
  });
  return createHash("sha256").update(body).digest("hex").slice(0, 32);
}

export async function previewConversion(ex: Db, billId: number, now = new Date()) {
  const data = await loadBill(ex, billId);
  if (!data) throw new ConversionError(404, "Bill not found");
  const currentFiscalYear = safeFiscalLabel(now);
  const plan = planBill(data.billIn, data.itemsIn, data.cancels, data.redemptions, {
    groupBy: "visit", fiscalYearOf: safeFiscalLabel, currentFiscalYear, otherOpenBills: data.otherOpenBills,
  });
  const refusals = conversionRefusals(plan, { accountBill: data.raw.accountBill, paymentStatus: data.raw.paymentStatus, vatAmount: num(data.raw.vatAmount) }, currentFiscalYear, data.alreadyConverted);
  const balanceBefore = data.billIn.customerId ? ((await customerBalances(data.billIn.customerId, ex))[0]?.balance ?? 0) : 0;
  return {
    data, plan, refusals, canConvert: refusals.length === 0, currentFiscalYear,
    checks: plan.issues.filter(i => i.level === "check"),
    fingerprint: fingerprintOf(plan, data.itemsIn),
    balanceBefore, expectedBalanceAfter: round2(balanceBefore + plan.invoicesTotal),
  };
}

export type ConvertResult = {
  conversionId: number; billId: number; customerId: number; invoices: { orderId: number; invoiceNumber: string; day: string; table: string; kots: number[]; total: number }[];
  billTotal: number; discount: number; invoicesTotal: number; balanceBefore: number; balanceAfter: number;
};

// Converts one bill in ONE transaction. Anything wrong (a refusal, a changed bill, a failed check) rolls everything back.
// `beforeCommit` lets tests fail the transaction at the very end to prove nothing is left behind.
export async function convertBill(dbx: Db, args: { billId: number; customerId: number; fingerprint: string; user: string; now?: Date; beforeCommit?: (tx: Db) => Promise<void> }): Promise<ConvertResult> {
  const now = args.now ?? new Date();
  return dbx.transaction(async (tx: Db) => {
    // Lock the bill (a second confirm, or a new KOT arriving, waits here), and the customer's row
    await tx.execute(sql`SELECT id FROM orders WHERE id = ${args.billId} FOR UPDATE`);
    if (args.customerId) await tx.execute(sql`SELECT id FROM loyalty_customers WHERE id = ${args.customerId} FOR UPDATE`);
    const p = await previewConversion(tx, args.billId, now);
    if (p.data.billIn.customerId !== args.customerId) throw new ConversionError(400, "That bill does not belong to this customer.");
    if (p.refusals.length) throw new ConversionError(p.refusals.some(r => r.code === "already_converted") ? 409 : 400, p.refusals.map(r => r.message).join(" "), p.refusals);
    if (p.fingerprint !== args.fingerprint) throw new ConversionError(409, "The bill changed since the preview (a new or cancelled KOT, or a discount). Preview it again before converting.");

    const { data, plan } = p;
    const customerId = args.customerId;
    const createdBy = data.raw.createdBy ?? args.user;
    const balanceBefore = p.balanceBefore;
    const made: ConvertResult["invoices"] = [];

    for (const inv of plan.invoices) {
      const visitAt = new Date(inv.firstAt ?? data.billIn.createdAt);
      const invoiceNumber = await nextInvoiceNumber(tx, visitAt);
      const kotNos = inv.kots.map(k => k.kot);
      const firstBy = data.itemRows.find((r: any) => r.kotNumber === kotNos[0])?.kotBy ?? createdBy;
      const [o] = await tx.insert(ordersTable).values({
        tableId: null, totalAmount: String(inv.total), discountAmount: String(inv.discountShare), vatAmount: "0", billType: "pan",
        paymentMethod: "credit", paymentStatus: "paid", orderStatus: "completed", loyaltyCustomerId: customerId,
        loyaltyPointsEarned: 0, loyaltyPaidBasis: "0", // points come when the customer pays (accountant, 2026-11-23)
        invoiceNumber, paidAt: visitAt, backdatedAt: visitAt, createdBy: firstBy, accountBill: false, isNc: false,
        convertedFromOrderId: data.billIn.id,
        notes: `Credit invoice for the visit of ${inv.day} (${inv.table}, KOT ${kotNos.join(", ")}), converted from monthly-account bill #${data.billIn.id}`,
      }).returning();
      // Items keep their KOT numbers, times, tables and cost snapshot. Stock was already deducted when they were ordered.
      for (const it of data.itemRows.filter((r: any) => kotNos.includes(r.kotNumber ?? 1))) {
        await tx.insert(orderItemsTable).values({
          orderId: o.id, menuItemId: it.menuItemId, quantity: it.quantity, unitPrice: it.unitPrice, subtotal: it.subtotal, notes: it.notes,
          kotNumber: it.kotNumber ?? 1, kotAt: it.kotAt ?? data.billIn.createdAt, kotNote: it.kotNote, kotBy: it.kotBy, kotTable: it.kotTable,
          unitCost: it.unitCost, costComplete: it.costComplete, costEstimated: it.costEstimated,
        });
      }
      await tx.insert(orderPaymentsTable).values({ orderId: o.id, mode: "credit", amount: String(inv.total), reference: `Monthly bill #${data.billIn.id}`, paidAt: visitAt, createdBy: args.user });
      made.push({ orderId: o.id, invoiceNumber, day: inv.day, table: inv.table, kots: kotNos, total: inv.total });
    }

    // Close the old bill as converted: never deleted, keeps its items, linked to the new invoices
    const today = nepalDay(now);
    await tx.update(ordersTable).set({
      paymentStatus: "converted", orderStatus: "completed",
      notes: [data.raw.notes, `Converted on ${today} by ${args.user} into credit invoices ${made.map(m => m.invoiceNumber).join(", ")}`].filter(Boolean).join(" | "),
    }).where(eq(ordersTable.id, data.billIn.id));
    // Each invoice is a visit; no points now
    await tx.update(loyaltyCustomersTable).set({ totalOrders: sql`${loyaltyCustomersTable.totalOrders} + ${made.length}` }).where(eq(loyaltyCustomersTable.id, customerId));

    // The customer's balance must go up by exactly the bill total (items minus the shared discount)
    const balanceAfter = (await customerBalances(customerId, tx))[0]?.balance ?? 0;
    const invoicesTotal = round2(made.reduce((s, m) => s + m.total, 0));
    if (Math.abs(invoicesTotal - plan.billTotal) >= 0.005 || Math.abs(round2(balanceAfter - balanceBefore) - invoicesTotal) >= 0.005) {
      throw new ConversionError(500, `Balance check failed: before Rs. ${balanceBefore.toFixed(2)}, after Rs. ${balanceAfter.toFixed(2)}, invoices Rs. ${invoicesTotal.toFixed(2)}, bill Rs. ${plan.billTotal.toFixed(2)}. Nothing was changed.`);
    }

    const [conv] = await tx.insert(accountConversionsTable).values({
      oldOrderId: data.billIn.id, customerId, billTotal: String(plan.billTotal), itemsSubtotal: String(plan.itemsSubtotal), discount: String(plan.discount),
      invoicesTotal: String(invoicesTotal), invoiceCount: made.length, balanceBefore: String(balanceBefore), balanceAfter: String(balanceAfter),
      fingerprint: args.fingerprint, checks: p.checks, convertedBy: args.user,
    }).returning();
    for (const [i, m] of made.entries()) {
      const inv = plan.invoices[i];
      await tx.insert(accountConversionInvoicesTable).values({
        conversionId: conv.id, newOrderId: m.orderId, invoiceNumber: m.invoiceNumber, visitDay: inv.day, tableLabel: inv.table,
        kotNumbers: m.kots.join(","), subtotal: String(inv.subtotal), discountShare: String(inv.discountShare), total: String(inv.total),
      });
    }
    if (args.beforeCommit) await args.beforeCommit(tx);
    return { conversionId: conv.id, billId: data.billIn.id, customerId, invoices: made, billTotal: plan.billTotal, discount: plan.discount, invoicesTotal, balanceBefore, balanceAfter };
  });
}
