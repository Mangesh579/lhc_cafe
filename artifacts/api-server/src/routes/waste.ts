import { Router } from "express";
import { db, wasteLogsTable, inventoryItemsTable, menuItemsTable, inventoryLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import type { Response } from "express";

const router = Router();

router.get("/waste", authenticate, async (_req, res): Promise<void> => {
  const logs = await db
    .select()
    .from(wasteLogsTable)
    .orderBy(desc(wasteLogsTable.createdAt))
    .limit(200);
  res.json(logs);
});

router.post("/waste", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { inventoryItemId, menuItemId, itemName, quantity, unit, reason, wasteValue } = req.body;
  if (!itemName || !quantity || !unit || !reason) {
    res.status(400).json({ error: "itemName, quantity, unit, and reason are required" });
    return;
  }

  const [log] = await db.insert(wasteLogsTable).values({
    inventoryItemId: inventoryItemId ?? null,
    menuItemId: menuItemId ?? null,
    itemName,
    quantity: String(quantity),
    unit,
    reason,
    wasteValue: wasteValue != null ? String(wasteValue) : "0",
    changedBy: req.user?.username ?? "staff",
  }).returning();

  // If linked to inventory, deduct stock
  if (inventoryItemId) {
    const [inv] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, inventoryItemId));
    if (inv) {
      const stockBefore = parseFloat(String(inv.currentStock));
      const stockAfter = Math.max(0, stockBefore - parseFloat(String(quantity)));
      await db.update(inventoryItemsTable).set({ currentStock: String(stockAfter) }).where(eq(inventoryItemsTable.id, inventoryItemId));
      await db.insert(inventoryLogsTable).values({
        inventoryItemId: inventoryItemId, changeAmount: String(-parseFloat(String(quantity))),
        stockBefore: String(stockBefore), stockAfter: String(stockAfter),
        reason: `Waste: ${reason}`,
      });
    }
  }

  res.status(201).json(log);
});

router.delete("/waste/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(wasteLogsTable).where(eq(wasteLogsTable.id, id));
  res.sendStatus(204);
});

export default router;
