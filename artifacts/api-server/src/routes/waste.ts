import { Router } from "express";
import { db, wasteLogsTable, inventoryItemsTable, menuItemsTable, inventoryLogsTable, equipmentItemsTable, equipmentLogsTable } from "@workspace/db";
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
  const { inventoryItemId, menuItemId, equipmentItemId, itemName, quantity, unit, reason, wasteValue } = req.body;
  if (!itemName || !quantity || !unit || !reason) {
    res.status(400).json({ error: "itemName, quantity, unit, and reason are required" });
    return;
  }

  let computedWasteValue = wasteValue != null ? parseFloat(String(wasteValue)) : 0;

  // If linked to equipment, auto-calculate value from unit price and decrement quantity
  if (equipmentItemId) {
    const [eqItem] = await db.select().from(equipmentItemsTable).where(eq(equipmentItemsTable.id, equipmentItemId));
    if (eqItem) {
      const qtyWasted = parseFloat(String(quantity));
      const unitPrice = eqItem.unitPrice != null ? parseFloat(String(eqItem.unitPrice)) : 0;

      // Auto-calculate waste value if not manually provided
      if (!wasteValue || parseFloat(String(wasteValue)) === 0) {
        computedWasteValue = unitPrice * qtyWasted;
      }

      const currentQty = eqItem.quantity ?? 1;
      const newQty = Math.max(0, currentQty - qtyWasted);
      const newTotalPrice = unitPrice * newQty;

      await db.update(equipmentItemsTable)
        .set({ quantity: newQty, purchasePrice: String(newTotalPrice) })
        .where(eq(equipmentItemsTable.id, equipmentItemId));

      await db.insert(equipmentLogsTable).values({
        equipmentItemId,
        action: "damaged",
        notes: `${qtyWasted} unit(s) lost to waste: ${reason}`,
        cost: String(computedWasteValue),
        changedBy: req.user?.username ?? "staff",
      });
    }
  }

  const [log] = await db.insert(wasteLogsTable).values({
    inventoryItemId: inventoryItemId ?? null,
    menuItemId: menuItemId ?? null,
    equipmentItemId: equipmentItemId ?? null,
    itemName,
    quantity: String(quantity),
    unit,
    reason,
    wasteValue: String(computedWasteValue),
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