// Part 3f: the history of a stay (docs/specs/stays-guests-3f.md section 5). Insert-only (a trigger refuses UPDATE and
// DELETE). Always called with the transaction of the change it records, so a failed change leaves no history row.
import { stayEventsTable, ordersTable, loyaltyCustomersTable, customerReceiptsTable, creditNotesTable, hotelSettingsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

export type StayEvent = "opened" | "edited" | "closed" | "cancelled" | "order_charged" | "order_moved_out" | "order_moved_in" | "order_cancelled" | "order_credited" | "bill_printed" | "guest_unarchived";

export async function stayEvent(tx: any, stayId: number, event: StayEvent, detail: Record<string, unknown>, user: string) {
  await tx.insert(stayEventsTable).values({ stayId, event, detail, userName: user || "user" });
}

// For a change to an order: written on the order's stay, if it has one
export async function orderStayEvent(tx: any, orderId: number, event: StayEvent, detail: Record<string, unknown>, user: string) {
  const [o] = await tx.select({ roomStayId: ordersTable.roomStayId, invoiceNumber: ordersTable.invoiceNumber, stayCharge: ordersTable.stayCharge }).from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!o?.roomStayId) return;
  await stayEvent(tx, o.roomStayId, event, { orderId, invoice: o.invoiceNumber, charge: o.stayCharge, ...detail }, user);
}

// A customer has been billed when anything financial points at them: an order, a receipt, a credit note or a journal line.
// A billed customer is never archived (the receivable, the journal and the statements need them).
export async function billedCounts(ex: any, customerId: number) {
  const one = async (q: any) => Number(((await ex.execute(q)) as any).rows[0]?.n ?? 0);
  return {
    orders: await one(sql`SELECT count(*)::int AS n FROM orders WHERE loyalty_customer_id = ${customerId}`),
    receipts: await one(sql`SELECT count(*)::int AS n FROM customer_receipts WHERE customer_id = ${customerId}`),
    creditNotes: await one(sql`SELECT count(*)::int AS n FROM credit_notes WHERE customer_id = ${customerId}`),
    journalLines: await one(sql`SELECT count(*)::int AS n FROM journal_lines WHERE customer_id = ${customerId}`),
  };
}
export const isBilled = (c: Awaited<ReturnType<typeof billedCounts>>) => c.orders + c.receipts + c.creditNotes + c.journalLines > 0;

export async function sulimhaId(ex: any): Promise<number | null> {
  const [s] = await ex.select({ id: hotelSettingsTable.sulimhaCustomerId }).from(hotelSettingsTable).where(eq(hotelSettingsTable.id, 1));
  return s?.id ?? null;
}
void loyaltyCustomersTable; void customerReceiptsTable; void creditNotesTable; void and;
