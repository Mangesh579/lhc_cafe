import { Router } from "express";
import { db, ordersTable, orderItemsTable, menuItemsTable, inventoryItemsTable, inventoryLogsTable, recipesTable, loyaltyCustomersTable, cafeTablesTable, tableSessionsTable } from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router = Router();

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

async function getOrderWithItems(orderId: number) {
  const [order] = await db
    .select({
      id: ordersTable.id,
      tableId: ordersTable.tableId,
      tableNumber: cafeTablesTable.tableNumber,
      totalAmount: ordersTable.totalAmount,
      paymentMethod: ordersTable.paymentMethod,
      paymentStatus: ordersTable.paymentStatus,
      orderStatus: ordersTable.orderStatus,
      loyaltyCustomerId: ordersTable.loyaltyCustomerId,
      loyaltyCustomerName: loyaltyCustomersTable.name,
      loyaltyPointsEarned: ordersTable.loyaltyPointsEarned,
      discountAmount: ordersTable.discountAmount,
      notes: ordersTable.notes,
      createdAt: ordersTable.createdAt,
      updatedAt: ordersTable.updatedAt,
    })
    .from(ordersTable)
    .leftJoin(cafeTablesTable, eq(ordersTable.tableId, cafeTablesTable.id))
    .leftJoin(loyaltyCustomersTable, eq(ordersTable.loyaltyCustomerId, loyaltyCustomersTable.id))
    .where(eq(ordersTable.id, orderId));

  if (!order) return null;

  const items = await db
    .select({
      id: orderItemsTable.id,
      menuItemId: orderItemsTable.menuItemId,
      menuItemName: menuItemsTable.name,
      quantity: orderItemsTable.quantity,
      unitPrice: orderItemsTable.unitPrice,
      subtotal: orderItemsTable.subtotal,
      notes: orderItemsTable.notes,
    })
    .from(orderItemsTable)
    .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
    .where(eq(orderItemsTable.orderId, orderId));

  return { ...order, items };
}

router.get("/orders", authenticate, async (req, res): Promise<void> => {
  const { status, date, paymentMethod } = req.query;
  const conditions = [];
  if (status) conditions.push(eq(ordersTable.orderStatus, status as string));
  if (paymentMethod) conditions.push(eq(ordersTable.paymentMethod, paymentMethod as string));
  if (date) {
    const startDate = new Date(date as string); startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date as string); endDate.setHours(23, 59, 59, 999);
    conditions.push(gte(ordersTable.createdAt, startDate));
    conditions.push(lte(ordersTable.createdAt, endDate));
  }

  const ordersList = await db
    .select({
      id: ordersTable.id,
      tableId: ordersTable.tableId,
      tableNumber: cafeTablesTable.tableNumber,
      totalAmount: ordersTable.totalAmount,
      paymentMethod: ordersTable.paymentMethod,
      paymentStatus: ordersTable.paymentStatus,
      orderStatus: ordersTable.orderStatus,
      loyaltyCustomerId: ordersTable.loyaltyCustomerId,
      loyaltyCustomerName: loyaltyCustomersTable.name,
      loyaltyPointsEarned: ordersTable.loyaltyPointsEarned,
      discountAmount: ordersTable.discountAmount,
      notes: ordersTable.notes,
      createdAt: ordersTable.createdAt,
      updatedAt: ordersTable.updatedAt,
    })
    .from(ordersTable)
    .leftJoin(cafeTablesTable, eq(ordersTable.tableId, cafeTablesTable.id))
    .leftJoin(loyaltyCustomersTable, eq(ordersTable.loyaltyCustomerId, loyaltyCustomersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(ordersTable.createdAt));

  const ordersWithItems = await Promise.all(
    ordersList.map(async (order) => {
      const items = await db
        .select({
          id: orderItemsTable.id,
          menuItemId: orderItemsTable.menuItemId,
          menuItemName: menuItemsTable.name,
          quantity: orderItemsTable.quantity,
          unitPrice: orderItemsTable.unitPrice,
          subtotal: orderItemsTable.subtotal,
          notes: orderItemsTable.notes,
        })
        .from(orderItemsTable)
        .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
        .where(eq(orderItemsTable.orderId, order.id));
      return { ...order, items };
    })
  );

  res.json(ordersWithItems);
});

router.post("/orders", authenticate, async (req, res): Promise<void> => {
  const { tableId, paymentMethod, loyaltyCustomerId, notes, items, discountAmount } = req.body;
  if (!items?.length) { res.status(400).json({ error: "Order must have at least one item" }); return; }

  let totalAmount = 0;
  const resolvedItems: Array<{ menuItemId: number; quantity: number; unitPrice: number; subtotal: number; notes?: string }> = [];
  for (const item of items) {
    const [menuItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, item.menuItemId));
    if (!menuItem) { res.status(400).json({ error: `Menu item ${item.menuItemId} not found` }); return; }
    const unitPrice = parseFloat(String(menuItem.price));
    const subtotal = unitPrice * item.quantity;
    totalAmount += subtotal;
    resolvedItems.push({ menuItemId: item.menuItemId, quantity: item.quantity, unitPrice, subtotal, notes: item.notes });
  }

  const [order] = await db.insert(ordersTable).values({
    tableId: tableId ?? null,
    totalAmount: String(totalAmount),
    paymentMethod: paymentMethod ?? "cash",
    paymentStatus: "pending",
    orderStatus: "pending",
    loyaltyCustomerId: loyaltyCustomerId ?? null,
    notes: notes ?? null,
    discountAmount: discountAmount ? String(discountAmount) : "0",
  }).returning();

  for (const item of resolvedItems) {
    await db.insert(orderItemsTable).values({ orderId: order.id, menuItemId: item.menuItemId, quantity: item.quantity, unitPrice: String(item.unitPrice), subtotal: String(item.subtotal), notes: item.notes ?? null });
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
        await db.insert(inventoryLogsTable).values({ inventoryItemId: inv.id, changeAmount: String(-needed), stockBefore: String(stockBefore), stockAfter: String(stockAfter), reason: `Order #${order.id}`, orderId: order.id });
      }
    }
  }

  const result = await getOrderWithItems(order.id);
  res.status(201).json(result);
});

router.get("/orders/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const order = await getOrderWithItems(id);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(order);
});

router.patch("/orders/:id/status", authenticate, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { status } = req.body;
  if (!status) { res.status(400).json({ error: "status required" }); return; }

  if (status === "completed") {
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    if (order && order.paymentStatus === "pending") {
      res.status(400).json({ error: "Cannot complete order: payment is still pending. Please process payment first." });
      return;
    }
  }

  await db.update(ordersTable).set({ orderStatus: status }).where(eq(ordersTable.id, id));
  const result = await getOrderWithItems(id);
  if (!result) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(result);
});

router.patch("/orders/:id/payment", authenticate, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { paymentMethod, paymentStatus, loyaltyCustomerId } = req.body;
  const updateData: Record<string, unknown> = {};
  if (paymentMethod) updateData.paymentMethod = paymentMethod;
  if (paymentStatus) updateData.paymentStatus = paymentStatus;

  if (paymentStatus === "paid") {
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    if (order) {
      const customerId = loyaltyCustomerId ?? order.loyaltyCustomerId;
      if (customerId) {
        const points = Math.floor(parseFloat(String(order.totalAmount)) / 10);
        updateData.loyaltyPointsEarned = points;
        updateData.loyaltyCustomerId = customerId;
        const [customer] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, customerId));
        if (customer) {
          await db.update(loyaltyCustomersTable).set({
            totalPoints: customer.totalPoints + points,
            totalOrders: customer.totalOrders + 1,
            totalSpent: String(parseFloat(String(customer.totalSpent)) + parseFloat(String(order.totalAmount))),
          }).where(eq(loyaltyCustomersTable.id, customerId));
        }
      }

      // Clear table session and mark table unoccupied so next guest gets a fresh start
      if (order.tableId) {
        await db.delete(tableSessionsTable).where(eq(tableSessionsTable.tableId, order.tableId));
        await db.update(cafeTablesTable).set({ isOccupied: false }).where(eq(cafeTablesTable.id, order.tableId));
      }
    }
  }

  await db.update(ordersTable).set(updateData).where(eq(ordersTable.id, id));
  const result = await getOrderWithItems(id);
  if (!result) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(result);
});

router.patch("/orders/:id/discount", authenticate, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { discountPercent } = req.body;
  if (discountPercent === undefined) { res.status(400).json({ error: "discountPercent required" }); return; }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const base = parseFloat(String(order.totalAmount));
  const discountAmount = base * (parseFloat(String(discountPercent)) / 100);
  const newTotal = base - discountAmount;

  await db.update(ordersTable).set({
    discountAmount: String(discountAmount),
    totalAmount: String(newTotal),
    notes: [order.notes, `Staff discount: ${discountPercent}%`].filter(Boolean).join(" | "),
  }).where(eq(ordersTable.id, id));

  const result = await getOrderWithItems(id);
  res.json(result);
});

router.patch("/orders/:id/cancel", authenticate, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);

  // Restore inventory before cancelling
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));
  for (const item of items) {
    const recipes = await db.select().from(recipesTable).where(eq(recipesTable.menuItemId, item.menuItemId));
    for (const recipe of recipes) {
      const restore = parseFloat(String(recipe.quantityRequired)) * item.quantity;
      const [inv] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, recipe.inventoryItemId));
      if (inv) {
        const stockBefore = parseFloat(String(inv.currentStock));
        const stockAfter = stockBefore + restore;
        await db.update(inventoryItemsTable).set({ currentStock: String(stockAfter) }).where(eq(inventoryItemsTable.id, inv.id));
        await db.insert(inventoryLogsTable).values({
          inventoryItemId: inv.id,
          changeAmount: String(restore),
          stockBefore: String(stockBefore),
          stockAfter: String(stockAfter),
          reason: `Order #${id} cancelled — stock restored`,
          orderId: id,
        });
      }
    }
  }

  await db.update(ordersTable).set({ orderStatus: "cancelled", paymentStatus: "cancelled" }).where(eq(ordersTable.id, id));
  const result = await getOrderWithItems(id);
  if (!result) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(result);
});

export default router;