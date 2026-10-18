import { Router } from "express";
import { db, wasteLogsTable, inventoryItemsTable, menuItemsTable, inventoryLogsTable, equipmentItemsTable, equipmentLogsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { authenticate, canWriteDepartment, type AuthRequest } from "../middlewares/auth";
import type { Response } from "express";

const router = Router();

router.get("/waste", authenticate, async (req, res): Promise<void> => {
  const { department } = req.query;
  const logs = department
    ? await db.select().from(wasteLogsTable).where(eq(wasteLogsTable.department, department as string)).orderBy(desc(wasteLogsTable.createdAt)).limit(200)
    : await db.select().from(wasteLogsTable).orderBy(desc(wasteLogsTable.createdAt)).limit(200);
  res.json(logs);
});

router.post("/waste", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { inventoryItemId, menuItemId, equipmentItemId, itemName, quantity, unit, reason, wasteValue, department } = req.body;
  if (!itemName || !quantity || !unit || !reason || !department) {
    res.status(400).json({ error: "itemName, quantity, unit, reason, and department are required" });
    return;
  }
  if (!canWriteDepartment(req.user?.role, department)) {
    res.status(403).json({ error: `Only ${department === "kitchen" ? "the head chef" : "the head barista"} or an admin can log ${department} waste.` });
    return;
  }

  let computedWasteValue = wasteValue != null ? parseFloat(String(wasteValue)) : 0;

  if (equipmentItemId) {
    const [eqItem] = await db.select().from(equipmentItemsTable).where(eq(equipmentItemsTable.id, equipmentItemId));
    if (eqItem) {
      const qtyWasted = parseFloat(String(quantity));
      const unitPrice = eqItem.unitPrice != null ? parseFloat(String(eqItem.unitPrice)) : 0;

      if (!wasteValue || parseFloat(String(wasteValue)) === 0) {
        computedWasteValue = unitPrice * qtyWasted;
      }

      const currentQty = eqItem.quantity ?? 1;
      const newQty = currentQty - qtyWasted;
      const newTotalPrice = unitPrice * newQty;

      await db.update(equipmentItemsTable)
        .set({ quantity: newQty, purchasePrice: String(newTotalPrice) })
        .where(eq(equipmentItemsTable.id, equipmentItemId));

      await db.insert(equipmentLogsTable).values({
        equipmentItemId,
        action: "restored",
        equipmentName: eqItem.name,
        department: eqItem.department,
        quantityBefore: eqItem.quantity ?? 0,
        quantityAfter: newQty,
        notes: "Equipment restored",
        changedBy: req.user?.username ?? "staff",
      });

      await db.insert(equipmentLogsTable).values({
        equipmentItemId,
        action: "damaged",
        equipmentName: eqItem.name, department: eqItem.department, quantityBefore: currentQty, quantityAfter: newQty,
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
    department,
    changedBy: req.user?.username ?? "staff",
  }).returning();

  if (inventoryItemId) {
    const [inv] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, inventoryItemId));
    if (inv) {
      const stockBefore = parseFloat(String(inv.currentStock));
      const stockAfter = stockBefore - parseFloat(String(quantity));
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

router.delete("/waste/:id", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(wasteLogsTable).where(eq(wasteLogsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Waste log not found" }); return; }
  if (!canWriteDepartment(req.user?.role, existing.department)) {
    res.status(403).json({ error: `Only ${existing.department === "kitchen" ? "the head chef" : "the head barista"} or an admin can delete this entry.` });
    return;
  }
  await db.delete(wasteLogsTable).where(eq(wasteLogsTable.id, id));
  res.sendStatus(204);
});

router.get("/waste/monthly-report", authenticate, async (req, res): Promise<void> => {
  const { department } = req.query;
  const logs = department
    ? await db.select().from(wasteLogsTable).where(eq(wasteLogsTable.department, department as string)).orderBy(desc(wasteLogsTable.createdAt))
    : await db.select().from(wasteLogsTable).orderBy(desc(wasteLogsTable.createdAt));

  const byMonth: Record<string, { totalValue: number; count: number; byReason: Record<string, number> }> = {};
  logs.forEach(log => {
    const monthKey = new Date(log.createdAt).toISOString().slice(0, 7);
    if (!byMonth[monthKey]) byMonth[monthKey] = { totalValue: 0, count: 0, byReason: {} };
    const value = parseFloat(String(log.wasteValue ?? 0));
    byMonth[monthKey].totalValue += value;
    byMonth[monthKey].count += 1;
    const reason = log.reason || "Other";
    byMonth[monthKey].byReason[reason] = (byMonth[monthKey].byReason[reason] ?? 0) + value;
  });

  const report = Object.entries(byMonth)
    .map(([month, data]) => ({ month, ...data }))
    .sort((a, b) => b.month.localeCompare(a.month));

  res.json(report);
});

export default router;