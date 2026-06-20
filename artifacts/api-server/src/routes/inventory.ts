import { Router } from "express";
import { db, inventoryItemsTable, inventoryLogsTable, recipesTable, menuItemsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import type { Response } from "express";

const router = Router();

router.get("/inventory", authenticate, async (_req, res): Promise<void> => {
  const items = await db.select().from(inventoryItemsTable).orderBy(inventoryItemsTable.name);
  res.json(items);
});

router.post("/inventory", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, currentStock, unit, minStockLevel, caloriesPerUnit } = req.body;
  if (!name || !unit) { res.status(400).json({ error: "Name and unit required" }); return; }
  const [item] = await db.insert(inventoryItemsTable).values({
    name, currentStock: String(currentStock ?? 0), unit,
    minStockLevel: minStockLevel != null ? String(minStockLevel) : null,
    caloriesPerUnit: caloriesPerUnit != null ? String(caloriesPerUnit) : null,
  }).returning();
  await db.insert(inventoryLogsTable).values({
    inventoryItemId: item.id, changeAmount: String(currentStock ?? 0),
    stockBefore: "0", stockAfter: String(currentStock ?? 0),
    reason: "Initial stock", changedBy: req.user?.username ?? "system",
  });
  res.status(201).json(item);
});

router.patch("/inventory/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, currentStock, unit, minStockLevel, caloriesPerUnit } = req.body;
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (currentStock !== undefined) updateData.currentStock = String(currentStock);
  if (unit !== undefined) updateData.unit = unit;
  if (minStockLevel !== undefined) updateData.minStockLevel = minStockLevel != null ? String(minStockLevel) : null;
  if (caloriesPerUnit !== undefined) updateData.caloriesPerUnit = caloriesPerUnit != null ? String(caloriesPerUnit) : null;
  const [item] = await db.update(inventoryItemsTable).set(updateData).where(eq(inventoryItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(item);
});

router.delete("/inventory/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  res.sendStatus(204);
});

router.get("/inventory/logs", authenticate, async (req, res): Promise<void> => {
  const { inventoryItemId, limit } = req.query;
  const limitNum = limit ? parseInt(limit as string, 10) : 100;
  let query = db
    .select({
      id: inventoryLogsTable.id,
      inventoryItemId: inventoryLogsTable.inventoryItemId,
      ingredientName: inventoryItemsTable.name,
      changeAmount: inventoryLogsTable.changeAmount,
      stockBefore: inventoryLogsTable.stockBefore,
      stockAfter: inventoryLogsTable.stockAfter,
      reason: inventoryLogsTable.reason,
      orderId: inventoryLogsTable.orderId,
      changedBy: inventoryLogsTable.changedBy,
      createdAt: inventoryLogsTable.createdAt,
    })
    .from(inventoryLogsTable)
    .leftJoin(inventoryItemsTable, eq(inventoryLogsTable.inventoryItemId, inventoryItemsTable.id))
    .orderBy(desc(inventoryLogsTable.createdAt))
    .limit(limitNum);

  if (inventoryItemId) {
    const filteredItems = await db
      .select({
        id: inventoryLogsTable.id,
        inventoryItemId: inventoryLogsTable.inventoryItemId,
        ingredientName: inventoryItemsTable.name,
        changeAmount: inventoryLogsTable.changeAmount,
        stockBefore: inventoryLogsTable.stockBefore,
        stockAfter: inventoryLogsTable.stockAfter,
        reason: inventoryLogsTable.reason,
        orderId: inventoryLogsTable.orderId,
        changedBy: inventoryLogsTable.changedBy,
        createdAt: inventoryLogsTable.createdAt,
      })
      .from(inventoryLogsTable)
      .leftJoin(inventoryItemsTable, eq(inventoryLogsTable.inventoryItemId, inventoryItemsTable.id))
      .where(eq(inventoryLogsTable.inventoryItemId, parseInt(inventoryItemId as string, 10)))
      .orderBy(desc(inventoryLogsTable.createdAt))
      .limit(limitNum);
    res.json(filteredItems);
    return;
  }

  const items = await query;
  res.json(items);
});

router.post("/inventory/:id/adjust", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { quantity, reason } = req.body;
  if (quantity === undefined || !reason) { res.status(400).json({ error: "quantity and reason required" }); return; }
  const [current] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  if (!current) { res.status(404).json({ error: "Item not found" }); return; }
  const stockBefore = parseFloat(String(current.currentStock));
  const stockAfter = stockBefore + parseFloat(String(quantity));
  const [item] = await db.update(inventoryItemsTable).set({ currentStock: String(stockAfter) }).where(eq(inventoryItemsTable.id, id)).returning();
  await db.insert(inventoryLogsTable).values({
    inventoryItemId: id, changeAmount: String(quantity),
    stockBefore: String(stockBefore), stockAfter: String(stockAfter),
    reason, changedBy: req.user?.username ?? "staff",
  });
  res.json(item);
});

// GET /api/inventory/usage-map
// Returns { [inventoryItemId]: [{ id, name, isAvailable }, ...] }
// Used by the Ingredients tab to show which menu items use each ingredient.
router.get("/inventory/usage-map", authenticate, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      inventoryItemId: recipesTable.inventoryItemId,
      menuItemId: menuItemsTable.id,
      menuItemName: menuItemsTable.name,
      isAvailable: menuItemsTable.isAvailable,
    })
    .from(recipesTable)
    .innerJoin(menuItemsTable, eq(recipesTable.menuItemId, menuItemsTable.id));

  const map: Record<number, { id: number; name: string; isAvailable: boolean }[]> = {};
  for (const row of rows) {
    if (!map[row.inventoryItemId]) map[row.inventoryItemId] = [];
    map[row.inventoryItemId].push({ id: row.menuItemId, name: row.menuItemName, isAvailable: row.isAvailable });
  }
  res.json(map);
});

export default router;
