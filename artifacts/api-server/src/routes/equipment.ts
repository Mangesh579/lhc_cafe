import { Router } from "express";
import { db, equipmentItemsTable, equipmentLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import type { Response } from "express";

const router = Router();

router.get("/equipment", authenticate, async (_req, res): Promise<void> => {
  const items = await db.select().from(equipmentItemsTable).orderBy(equipmentItemsTable.name);
  res.json(items);
});

router.post("/equipment", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, description, purchaseDate, purchasePrice, condition, notes } = req.body;
  if (!name) { res.status(400).json({ error: "Name required" }); return; }
  const [item] = await db.insert(equipmentItemsTable).values({
    name, description: description ?? null,
    purchaseDate: purchaseDate ?? null,
    purchasePrice: purchasePrice != null ? String(purchasePrice) : null,
    condition: condition ?? "good",
    notes: notes ?? null,
  }).returning();
  await db.insert(equipmentLogsTable).values({
    equipmentItemId: item.id, action: "added",
    notes: `Equipment added to inventory`,
    changedBy: req.user?.username ?? "admin",
  });
  res.status(201).json(item);
});

router.patch("/equipment/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, description, purchaseDate, purchasePrice, condition, notes } = req.body;
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (purchaseDate !== undefined) updateData.purchaseDate = purchaseDate;
  if (purchasePrice !== undefined) updateData.purchasePrice = purchasePrice != null ? String(purchasePrice) : null;
  if (condition !== undefined) updateData.condition = condition;
  if (notes !== undefined) updateData.notes = notes;
  const [item] = await db.update(equipmentItemsTable).set(updateData).where(eq(equipmentItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Equipment not found" }); return; }
  await db.insert(equipmentLogsTable).values({
    equipmentItemId: id, action: "updated",
    notes: `Equipment details updated`,
    changedBy: req.user?.username ?? "admin",
  });
  res.json(item);
});

router.delete("/equipment/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [item] = await db.select().from(equipmentItemsTable).where(eq(equipmentItemsTable.id, id));
  if (!item) { res.status(404).json({ error: "Equipment not found" }); return; }
  await db.insert(equipmentLogsTable).values({
    equipmentItemId: id, action: "removed",
    notes: `${item.name} removed from inventory`,
    changedBy: req.user?.username ?? "admin",
  });
  await db.delete(equipmentItemsTable).where(eq(equipmentItemsTable.id, id));
  res.sendStatus(204);
});

router.get("/equipment/logs", authenticate, async (req, res): Promise<void> => {
  const { equipmentItemId } = req.query;
  const logs = await db
    .select({
      id: equipmentLogsTable.id,
      equipmentItemId: equipmentLogsTable.equipmentItemId,
      equipmentName: equipmentItemsTable.name,
      action: equipmentLogsTable.action,
      notes: equipmentLogsTable.notes,
      cost: equipmentLogsTable.cost,
      changedBy: equipmentLogsTable.changedBy,
      createdAt: equipmentLogsTable.createdAt,
    })
    .from(equipmentLogsTable)
    .leftJoin(equipmentItemsTable, eq(equipmentLogsTable.equipmentItemId, equipmentItemsTable.id))
    .orderBy(desc(equipmentLogsTable.createdAt))
    .limit(200);
  res.json(logs);
});

router.post("/equipment/:id/log", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { action, notes, cost } = req.body;
  if (!action) { res.status(400).json({ error: "action required" }); return; }
  const [log] = await db.insert(equipmentLogsTable).values({
    equipmentItemId: id, action, notes: notes ?? null,
    cost: cost != null ? String(cost) : null,
    changedBy: req.user?.username ?? "staff",
  }).returning();
  res.status(201).json(log);
});

export default router;
