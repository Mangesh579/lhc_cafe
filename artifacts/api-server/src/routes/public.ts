import { Router } from "express";
import { db, menuItemsTable, menuCategoriesTable, ordersTable, orderItemsTable, cafeTablesTable, tableSessionsTable, recipesTable, inventoryItemsTable, inventoryLogsTable, bestsellerCacheTable } from "@workspace/db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { randomBytes } from "crypto";

const router = Router();

const SESSION_IDLE_MINUTES = 30;
const BESTSELLER_CACHE_DAYS = 30;

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

  // Check the table is still occupied AND hasn't been reopened since this session was created.
  // If staff closed and reopened the table, openedAt changes — old sessions die instantly.
  const [table] = await db.select().from(cafeTablesTable).where(eq(cafeTablesTable.id, session.tableId)).limit(1);
  if (!table || !table.isOccupied) {
    await db.delete(tableSessionsTable).where(eq(tableSessionsTable.id, session.id));
    return null;
  }
  const tableOpenedAtMs = table.openedAt ? new Date(table.openedAt).getTime() : null;
  const sessionOpenedAtMs = session.tableOpenedAt ? new Date(session.tableOpenedAt).getTime() : null;
  if (tableOpenedAtMs !== sessionOpenedAtMs) {
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

    if (!table.isOccupied) {
      res.status(403).json({ error: "This table is not currently active. Please ask staff to seat you." });
      return;
    }

    // Only reuse an existing session if it was created under the SAME opening event.
    // A session from a previous opening (even if not yet cleaned up) is never reused.
    const [existing] = await db
      .select()
      .from(tableSessionsTable)
      .where(eq(tableSessionsTable.tableId, table.id))
      .limit(1);

    const tableOpenedAtMs = table.openedAt ? new Date(table.openedAt).getTime() : null;

    if (existing) {
      const idleCutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000);
      const hardExpired = existing.expiresAt && new Date() > existing.expiresAt;
      const idleExpired = existing.lastActivityAt < idleCutoff;
      const existingOpenedAtMs = existing.tableOpenedAt ? new Date(existing.tableOpenedAt).getTime() : null;
      const sameOpening = existingOpenedAtMs === tableOpenedAtMs;

      if (!hardExpired && !idleExpired && sameOpening) {
        await db.update(tableSessionsTable)
          .set({ lastActivityAt: new Date() })
          .where(eq(tableSessionsTable.id, existing.id));
        res.json({ sessionToken: existing.sessionToken, tableNumber: table.tableNumber });
        return;
      }
      // Stale session from a previous opening, or expired — remove it
      await db.delete(tableSessionsTable).where(eq(tableSessionsTable.id, existing.id));
    }

    const sessionToken = randomBytes(32).toString("hex");
    await db.insert(tableSessionsTable).values({
      tableId: table.id,
      sessionToken,
      lastActivityAt: new Date(),
      tableOpenedAt: table.openedAt ?? null,
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

async function getBestsellerIds(): Promise<Set<number>> {
  const [latest] = await db.select().from(bestsellerCacheTable).orderBy(desc(bestsellerCacheTable.computedAt)).limit(1);
  const cacheAge = latest ? (Date.now() - new Date(latest.computedAt).getTime()) / (1000 * 60 * 60 * 24) : Infinity;

  if (latest && cacheAge < BESTSELLER_CACHE_DAYS) {
    const cached = await db.select().from(bestsellerCacheTable);
    return new Set(cached.map(c => c.menuItemId));
  }

  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

  const sold = await db
    .select({
      menuItemId: orderItemsTable.menuItemId,
      categoryId: menuItemsTable.categoryId,
      totalQty: sql<number>`SUM(${orderItemsTable.quantity})`.as("total_qty"),
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .innerJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
    .where(and(eq(ordersTable.paymentStatus, "paid"), gte(ordersTable.createdAt, twoMonthsAgo)))
    .groupBy(orderItemsTable.menuItemId, menuItemsTable.categoryId)
    .orderBy(desc(sql`total_qty`));

  const byCategory = new Map<number, { menuItemId: number; totalQty: number }[]>();
  for (const row of sold) {
    const catId = row.categoryId ?? 0;
    if (!byCategory.has(catId)) byCategory.set(catId, []);
    byCategory.get(catId)!.push({ menuItemId: row.menuItemId, totalQty: Number(row.totalQty) });
  }

  await db.delete(bestsellerCacheTable);
  const newIds = new Set<number>();
  for (const [catId, items] of byCategory.entries()) {
    const top3 = items.slice(0, 3);
    for (let i = 0; i < top3.length; i++) {
      await db.insert(bestsellerCacheTable).values({
        menuItemId: top3[i].menuItemId,
        categoryId: catId || null,
        rank: i + 1,
        totalQuantity: top3[i].totalQty,
      });
      newIds.add(top3[i].menuItemId);
    }
  }

  return newIds;
}

// GET /api/public/menu?sessionToken=xxx
router.get("/menu", async (req, res): Promise<void> => {
  const { sessionToken } = req.query as { sessionToken: string };
  const session = await resolveSession(sessionToken);
  if (!session) { res.status(401).json({ error: "Session expired" }); return; }

  const categories = await db.select().from(menuCategoriesTable);
  const items = await db.select().from(menuItemsTable).where(eq(menuItemsTable.isAvailable, true));
  const bestsellerIds = await getBestsellerIds();
  const itemsWithBadge = items.map(item => ({ ...item, isBestseller: bestsellerIds.has(item.id) }));

  res.json({ categories, items: itemsWithBadge });
});

// GET /api/public/my-orders?sessionToken=xxx
router.get("/my-orders", async (req, res): Promise<void> => {
  const { sessionToken } = req.query as { sessionToken: string };
  const session = await resolveSession(sessionToken);
  if (!session) { res.status(401).json({ error: "Session expired" }); return; }

  const myOrders = await db
    .select({
      id: ordersTable.id,
      orderStatus: ordersTable.orderStatus,
      paymentStatus: ordersTable.paymentStatus,
      totalAmount: ordersTable.totalAmount,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(eq(ordersTable.tableId, session.tableId))
    .orderBy(ordersTable.createdAt);

  const ordersWithItems = await Promise.all(
    myOrders.map(async (order) => {
      const items = await db
        .select({
          id: orderItemsTable.id,
          menuItemId: orderItemsTable.menuItemId,
          menuItemName: menuItemsTable.name,
          quantity: orderItemsTable.quantity,
          subtotal: orderItemsTable.subtotal,
        })
        .from(orderItemsTable)
        .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
        .where(eq(orderItemsTable.orderId, order.id));
      return { ...order, items };
    })
  );

  res.json(ordersWithItems);
});

// POST /api/public/order
router.post("/order", async (req, res): Promise<void> => {
  try {
    const { sessionToken, items, customerNote, paymentMethod } = req.body;
    const session = await resolveSession(sessionToken);
    if (!session) { res.status(401).json({ error: "Session expired. Please scan the QR code again." }); return; }

    const [table] = await db.select().from(cafeTablesTable).where(eq(cafeTablesTable.id, session.tableId)).limit(1);
    if (!table) { res.status(404).json({ error: "Table not found" }); return; }
    if (!table.isOccupied) {
      await db.delete(tableSessionsTable).where(eq(tableSessionsTable.id, session.id));
      res.status(403).json({ error: "This table has been closed. Please ask staff for assistance." });
      return;
    }

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

    for (const item of resolvedItems) {
      const recipes = await db.select().from(recipesTable).where(eq(recipesTable.menuItemId, item.menuItemId));
      for (const recipe of recipes) {
        const needed = parseFloat(String(recipe.quantityRequired)) * item.quantity;
        const [inv] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, recipe.inventoryItemId));
        if (inv) {
          const stockBefore = parseFloat(String(inv.currentStock));
          const stockAfter = Math.max(0, stockBefore - needed);
          await db.update(inventoryItemsTable).set({ currentStock: String(stockAfter) }).where(eq(inventoryItemsTable.id, inv.id));
          await db.insert(inventoryLogsTable).values({
            inventoryItemId: inv.id,
            changeAmount: String(-needed),
            stockBefore: String(stockBefore),
            stockAfter: String(stockAfter),
            reason: `QR Order #${order.id} (Table ${table.tableNumber})`,
            orderId: order.id,
          });
        }
      }
    }

    res.json({ success: true, orderId: order.id, totalAmount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to place order" });
  }
});

export default router;