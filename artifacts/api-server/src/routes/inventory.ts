import { Router } from "express";
import { db, inventoryItemsTable, inventoryLogsTable, recipesTable, menuItemsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { authenticate, canWriteDepartment, type AuthRequest } from "../middlewares/auth";
import type { Response } from "express";

const router = Router();

function withDeptPrefix(name: string, department: string): string {
  const prefix = department === "kitchen" ? "K " : "D ";
  const stripped = name.replace(/^[KD]\s+/, "");
  return prefix + stripped;
}

router.get("/inventory", authenticate, async (req, res): Promise<void> => {
  const { department } = req.query;
  const items = department
    ? await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.department, department as string)).orderBy(inventoryItemsTable.name)
    : await db.select().from(inventoryItemsTable).orderBy(inventoryItemsTable.name);
  res.json(items);
});

router.post("/inventory", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, currentStock, unit, minStockLevel, caloriesPerUnit, department } = req.body;
  if (!name || !unit || !department) { res.status(400).json({ error: "Name, unit, and department required" }); return; }
  if (!canWriteDepartment(req.user?.role, department)) {
    res.status(403).json({ error: `Only ${department === "kitchen" ? "the head chef" : "the head barista"} or an admin can add ${department} ingredients.` });
    return;
  }

  const [item] = await db.insert(inventoryItemsTable).values({
    name: withDeptPrefix(name, department), currentStock: String(currentStock ?? 0), unit, department,
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
  const [existing] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Item not found" }); return; }
  if (!canWriteDepartment(req.user?.role, existing.department)) {
    res.status(403).json({ error: `Only ${existing.department === "kitchen" ? "the head chef" : "the head barista"} or an admin can edit this item.` });
    return;
  }

  const { name, currentStock, unit, minStockLevel, caloriesPerUnit } = req.body;
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = withDeptPrefix(name, existing.department);
  if (currentStock !== undefined) updateData.currentStock = String(currentStock);
  if (unit !== undefined) updateData.unit = unit;
  if (minStockLevel !== undefined) updateData.minStockLevel = minStockLevel != null ? String(minStockLevel) : null;
  if (caloriesPerUnit !== undefined) updateData.caloriesPerUnit = caloriesPerUnit != null ? String(caloriesPerUnit) : null;
  const [item] = await db.update(inventoryItemsTable).set(updateData).where(eq(inventoryItemsTable.id, id)).returning();
  res.json(item);
});

router.delete("/inventory/:id", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Item not found" }); return; }
  if (!canWriteDepartment(req.user?.role, existing.department)) {
    res.status(403).json({ error: `Only ${existing.department === "kitchen" ? "the head chef" : "the head barista"} or an admin can delete this item.` });
    return;
  }
  await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  res.sendStatus(204);
});

router.get("/inventory/logs", authenticate, async (req, res): Promise<void> => {
  const { inventoryItemId, department, limit } = req.query;
  const limitNum = limit ? parseInt(limit as string, 10) : 100;

  const conditions = [];
  if (inventoryItemId) conditions.push(eq(inventoryLogsTable.inventoryItemId, parseInt(inventoryItemId as string, 10)));
  if (department) conditions.push(eq(inventoryItemsTable.department, department as string));

  const items = await db
    .select({
      id: inventoryLogsTable.id,
      inventoryItemId: inventoryLogsTable.inventoryItemId,
      ingredientName: inventoryItemsTable.name,
      department: inventoryItemsTable.department,
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
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(inventoryLogsTable.createdAt))
    .limit(limitNum);

  res.json(items);
});

router.post("/inventory/:id/adjust", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { quantity, reason } = req.body;
  if (quantity === undefined || !reason) { res.status(400).json({ error: "quantity and reason required" }); return; }
  const [current] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  if (!current) { res.status(404).json({ error: "Item not found" }); return; }
  if (!canWriteDepartment(req.user?.role, current.department)) {
    res.status(403).json({ error: `Only ${current.department === "kitchen" ? "the head chef" : "the head barista"} or an admin can adjust this item.` });
    return;
  }
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