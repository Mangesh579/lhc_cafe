import { ordersTable, orderItemsTable, wasteLogsTable, orderKotCancellationsTable, loyaltyRedemptionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// Moves every item of `source` onto `target` as new KOTs, then marks `source` cancelled ("merged").
export async function mergeOrderInto(tx: any, source: any, target: any, username: string, sourceTableLabel: string | null, why: string, keepStatus = false) {
  const [mk] = await tx.select({ m: sql<number>`COALESCE(MAX(${orderItemsTable.kotNumber}), 0)` }).from(orderItemsTable).where(eq(orderItemsTable.orderId, target.id));
  const [ck] = await tx.select({ m: sql<number>`COALESCE(MAX(${orderKotCancellationsTable.kotNumber}), 0)` }).from(orderKotCancellationsTable).where(eq(orderKotCancellationsTable.orderId, target.id));
  const offset = Math.max(Number(mk?.m ?? 0), Number(ck?.m ?? 0));
  const intoAccount = !!target.accountBill;

  const srcItems = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, source.id));
  for (const it of srcItems) {
    await tx.update(orderItemsTable).set({
      orderId: target.id,
      kotNumber: offset + (it.kotNumber ?? 1),
      kotAt: it.kotAt ?? source.createdAt,
      kotNote: it.kotNote ?? ((it.kotNumber ?? 1) === 1 ? source.notes : null),
      kotBy: it.kotBy ?? source.createdBy,
      kotTable: it.kotTable ?? (intoAccount ? sourceTableLabel : null),
    }).where(eq(orderItemsTable.id, it.id));
  }
  const srcWaste = await tx.select().from(wasteLogsTable).where(eq(wasteLogsTable.orderId, source.id));
  for (const w of srcWaste) {
    await tx.update(wasteLogsTable).set({ orderId: target.id, kotNumber: offset + (w.kotNumber ?? 1) }).where(eq(wasteLogsTable.id, w.id));
  }
  const srcCancels = await tx.select().from(orderKotCancellationsTable).where(eq(orderKotCancellationsTable.orderId, source.id));
  for (const c of srcCancels) {
    await tx.update(orderKotCancellationsTable).set({ orderId: target.id, kotNumber: offset + c.kotNumber }).where(eq(orderKotCancellationsTable.id, c.id));
  }
  await tx.update(loyaltyRedemptionsTable).set({ orderId: target.id }).where(eq(loyaltyRedemptionsTable.orderId, source.id));

  await tx.update(ordersTable).set({
    totalAmount: String(parseFloat(String(target.totalAmount)) + parseFloat(String(source.totalAmount))),
    discountAmount: String(parseFloat(String(target.discountAmount ?? 0)) + parseFloat(String(source.discountAmount ?? 0))),
    notes: [target.notes, source.notes].filter(Boolean).join(" | ") || null,
    ...(keepStatus ? {} : { orderStatus: "pending" }),
    loyaltyCustomerId: target.loyaltyCustomerId ?? source.loyaltyCustomerId ?? null,
  }).where(eq(ordersTable.id, target.id));
  await tx.update(ordersTable).set({
    orderStatus: "cancelled", paymentStatus: "cancelled", totalAmount: "0", discountAmount: "0",
    notes: [source.notes, `Merged into order #${target.id} (${why} by ${username})`].filter(Boolean).join(" | "),
  }).where(eq(ordersTable.id, source.id));
}