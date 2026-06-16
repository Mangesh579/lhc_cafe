import { Router } from "express";
import { db, menuItemsTable, menuCategoriesTable, ordersTable, orderItemsTable, cafeTablesTable, tableSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";

const router = Router();

const SESSION_IDLE_MINUTES = 2;

async function resolveSession(sessionToken: string) {
  const [session] = await db
    .select()
    .from(tableSessionsTable)
    .where(eq(tableSessionsTable.sessionToken, sessionToken))
    .limit(1);

  if (!session) return null;

  if (session.expiresAt && new Date() > session.expiresAt) {
    await db.delete(tableSessionsTable).where(eq(tableSessionsTable.id, session.id));
    return null;
  }

  const idleCutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000);
  if (session.lastActivityAt < idleCutoff) {
    await db.delete(tableSessionsTable).where(eq(tableSessionsTable.id, session.id));
    return null;
  }

  await db
    .update(tableSessionsTable)
    .set({ lastActivityAt: new Date() })
    .where(eq(tableSessionsTable.id, session.id));

  return session;
}

// POST /api/public/session/start
router.post("/session/start", async (req, res): Promise<void> => {
  try {
    const { tableToken } = req.body;
    if (!tableToken) { res.status(400).json({ error: "tableToken required" }); return; }

    const [table] = await db
      .select()
      .from(cafeTablesTable)
      .where(eq(cafeTablesTable.token, tableToken))
      .limit(1);

    if (!table) { res.status(404).json({ error: "Invalid QR code" }); return; }

    // Check for existing active session on this table
    const [existing] = await db
      .select()
      .from(tableSessionsTable)
      .where(eq(tableSessionsTable.tableId, table.id))
      .limit(1);

    if (existing) {
      const idleCutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000);
      const hardExpired = existing.expiresAt && new Date() > existing.expiresAt;
      const idleExpired = existing.lastActivityAt < idleCutoff;

      if (!hardExpired && !idleExpired) {
        await db.update(tableSessionsTable)
          .set({ lastActivityAt: new Date() })
          .where(eq(tableSessionsTable.id, existing.id));
        res.json({ sessionToken: existing.sessionToken, tableNumber: table.tableNumber });
        return;
      }
      await db.delete(tableSessionsTable).where(eq(tableSessionsTable.id, existing.id));
    }

    const sessionToken = randomBytes(32).toString("hex");
    await db.insert(tableSessionsTable).values({
      tableId: table.id,
      sessionToken,
      lastActivityAt: new Date(),
    });

    res.json({ sessionToken, tableNumber: table.tableNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/public/session/validate?sessionToken=xxx
router.get("/session/validate", async (req, res): Promise<void> => {
  const { sessionToken } = req.query as { sessionToken: string };
  if (!sessionToken) { res.status(400).json({ valid: false }); return; }

  const session = await resolveSession(sessionToken);
  if (!session) { res.status(401).json({ valid: false, reason: "expired" }); return; }

  const [table] = await db.select().from(cafeTablesTable).where(eq(cafeTablesTable.id, session.tableId)).limit(1);
  res.json({ valid: true, tableNumber: table?.tableNumber });
});

// GET /api/public/menu?sessionToken=xxx
router.get("/menu", async (req, res): Promise<void> => {
  const { sessionToken } = req.query as { sessionToken: string };
  const session = await resolveSession(sessionToken);
  if (!session) { res.status(401).json({ error: "Session expired" }); return; }

  const categories = await db.select().from(menuCategoriesTable);
  const items = await db.select().from(menuItemsTable).where(eq(menuItemsTable.isAvailable, true));
  res.json({ categories, items });
});

// POST /api/public/order
router.post("/order", async (req, res): Promise<void> => {
  try {
    const { sessionToken, items, customerNote, paymentMethod } = req.body;
    const session = await resolveSession(sessionToken);
    if (!session) { res.status(401).json({ error: "Session expired. Please scan the QR code again." }); return; }

    const [table] = await db.select().from(cafeTablesTable).where(eq(cafeTablesTable.id, session.tableId)).limit(1);
    if (!table) { res.status(404).json({ error: "Table not found" }); return; }

    let totalAmount = 0;
    const resolvedItems: Array<{ menuItemId: number; quantity: number; unitPrice: number; subtotal: number; notes?: string }> = [];

    for (const item of items) {
      const [menuItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, item.menuItemId)).limit(1);
      if (!menuItem) continue;
      const unitPrice = parseFloat(String(menuItem.price));
      const subtotal = unitPrice * item.quantity;
      totalAmount += subtotal;
      resolvedItems.push({ menuItemId: item.menuItemId, quantity: item.quantity, unitPrice, subtotal, notes: item.notes });
    }

    const [order] = await db.insert(ordersTable).values({
      tableId: table.id,
      totalAmount: String(totalAmount),
      paymentMethod: paymentMethod ?? "cash",
      paymentStatus: "pending",
      orderStatus: "pending",
      notes: customerNote ?? null,
    }).returning();

    for (const item of resolvedItems) {
      await db.insert(orderItemsTable).values({
        orderId: order.id,
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice: String(item.unitPrice),
        subtotal: String(item.subtotal),
        notes: item.notes ?? null,
      });
    }

    res.json({ success: true, orderId: order.id, totalAmount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to place order" });
  }
});

export default router;