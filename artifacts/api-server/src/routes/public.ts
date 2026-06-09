import { Router } from "express";
import { db, menuItemsTable, menuCategoriesTable, ordersTable, orderItemsTable, cafeTablesTable, recipesTable, inventoryItemsTable, inventoryLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/public/menu", async (req, res): Promise<void> => {
  const { tableId } = req.query;

  let tableNumber: number | null = null;
  if (tableId) {
    const [table] = await db.select().from(cafeTablesTable).where(eq(cafeTablesTable.tableNumber, parseInt(tableId as string, 10)));
    tableNumber = table?.tableNumber ?? null;
  }

  const categories = await db.select().from(menuCategoriesTable).orderBy(menuCategoriesTable.displayOrder);
  const availableItems = await db
    .select({
      id: menuItemsTable.id,
      name: menuItemsTable.name,
      description: menuItemsTable.description,
      price: menuItemsTable.price,
      categoryId: menuItemsTable.categoryId,
      categoryName: menuCategoriesTable.name,
      isAvailable: menuItemsTable.isAvailable,
      imageUrl: menuItemsTable.imageUrl,
      calories: menuItemsTable.calories,
      createdAt: menuItemsTable.createdAt,
    })
    .from(menuItemsTable)
    .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
    .where(eq(menuItemsTable.isAvailable, true))
    .orderBy(menuCategoriesTable.displayOrder, menuItemsTable.name);

  // Group by category
  const categoryMap = new Map<number | null, typeof availableItems>();
  for (const item of availableItems) {
    const catId = item.categoryId;
    if (!categoryMap.has(catId)) categoryMap.set(catId, []);
    categoryMap.get(catId)!.push(item);
  }

  const result = [];
  for (const cat of categories) {
    const items = categoryMap.get(cat.id) ?? [];
    if (items.length > 0) {
      result.push({ id: cat.id, name: cat.name, items });
    }
  }
  // Uncategorized items
  const uncategorized = categoryMap.get(null) ?? [];
  if (uncategorized.length > 0) {
    result.push({ id: 0, name: "Other", items: uncategorized });
  }

  res.json({ tableNumber, categories: result });
});

router.post("/public/orders", async (req, res): Promise<void> => {
  const { tableId, customerName, notes, items } = req.body;
  if (!tableId || !items?.length) { res.status(400).json({ error: "tableId and items required" }); return; }

  // Verify table exists
  const [table] = await db.select().from(cafeTablesTable).where(eq(cafeTablesTable.tableNumber, parseInt(String(tableId), 10)));
  if (!table) { res.status(400).json({ error: "Table not found" }); return; }

  let totalAmount = 0;
  const resolvedItems: Array<{ menuItemId: number; quantity: number; unitPrice: number; subtotal: number; notes?: string }> = [];
  for (const item of items) {
    const [menuItem] = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.id, item.menuItemId), eq(menuItemsTable.isAvailable, true)));
    if (!menuItem) { res.status(400).json({ error: `Menu item ${item.menuItemId} not found or unavailable` }); return; }
    const unitPrice = parseFloat(String(menuItem.price));
    const subtotal = unitPrice * item.quantity;
    totalAmount += subtotal;
    resolvedItems.push({ menuItemId: item.menuItemId, quantity: item.quantity, unitPrice, subtotal, notes: item.notes });
  }

  const [order] = await db.insert(ordersTable).values({
    tableId: table.id,
    totalAmount: String(totalAmount),
    paymentMethod: "cash",
    paymentStatus: "pending",
    orderStatus: "pending",
    notes: customerName ? `Customer: ${customerName}${notes ? `. ${notes}` : ""}` : notes ?? null,
  }).returning();

  for (const item of resolvedItems) {
    await db.insert(orderItemsTable).values({ orderId: order.id, ...item, unitPrice: String(item.unitPrice), subtotal: String(item.subtotal) });
  }

  // Deduct inventory
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
          inventoryItemId: inv.id, changeAmount: String(-needed),
          stockBefore: String(stockBefore), stockAfter: String(stockAfter),
          reason: `Table order #${order.id}`, orderId: order.id,
        });
      }
    }
  }

  // Return full order
  const orderWithItems = {
    ...order,
    tableNumber: table.tableNumber,
    loyaltyCustomerName: null,
    items: resolvedItems.map((item, idx) => ({
      id: idx + 1,
      menuItemId: item.menuItemId,
      menuItemName: "",
      quantity: item.quantity,
      unitPrice: String(item.unitPrice),
      subtotal: String(item.subtotal),
      notes: item.notes ?? null,
    })),
  };

  res.status(201).json(orderWithItems);
});

export default router;
