import { db, orderRequestsTable } from "@workspace/db";
import { eq, and, isNull, lt } from "drizzle-orm";

export type Claim =
  | { state: "new" }
  | { state: "done"; orderId: number; kotNumber: number | null; merged: boolean }
  | { state: "busy" };

// Claims a request id. Only the first caller gets "new"; repeats get the finished result.
export async function claimOrderRequest(requestId: string): Promise<Claim> {
  if (Math.random() < 0.02) {
    db.delete(orderRequestsTable).where(lt(orderRequestsTable.createdAt, new Date(Date.now() - 3 * 24 * 3600 * 1000))).catch(() => {});
  }
  for (let attempt = 0; attempt < 14; attempt++) {
    const inserted = await db.insert(orderRequestsTable).values({ requestId }).onConflictDoNothing().returning();
    if (inserted.length > 0) return { state: "new" };

    const [row] = await db.select().from(orderRequestsTable).where(eq(orderRequestsTable.requestId, requestId));
    if (row?.orderId != null) return { state: "done", orderId: row.orderId, kotNumber: row.kotNumber, merged: row.merged };
    if (row && Date.now() - new Date(row.createdAt).getTime() > 30_000) {
      // An earlier attempt died before finishing: free the id so this one can proceed
      await db.delete(orderRequestsTable).where(and(eq(orderRequestsTable.requestId, requestId), isNull(orderRequestsTable.orderId)));
      continue;
    }
    await new Promise(r => setTimeout(r, 500)); // the first attempt is still running: wait for it
  }
  return { state: "busy" };
}

export async function completeOrderRequest(requestId: string, orderId: number, kotNumber: number, merged: boolean) {
  await db.update(orderRequestsTable).set({ orderId, kotNumber, merged }).where(eq(orderRequestsTable.requestId, requestId));
}