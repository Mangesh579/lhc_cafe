import { Router } from "express";
import { db, equipmentItemsTable, equipmentLogsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { authenticate, requireAdmin, canWriteDepartment, type AuthRequest } from "../middlewares/auth";
import type { Response } from "express";

const router = Router();

function withDeptPrefix(name: string, department: string): string {
  const prefix = department === "kitchen" ? "K " : "D ";
  const stripped = name.replace(/^[KD]\s+/, "");
  return prefix + stripped;
}

router.get("/equipment", authenticate, async (req, res): Promise<void> => {
  const { department } = req.query;
  const items = department
    ? await db.select().from(equipmentItemsTable).where(eq(equipmentItemsTable.department, department as string)).orderBy(equipmentItemsTable.name)
    : await db.select().from(equipmentItemsTable).orderBy(equipmentItemsTable.name);
  res.json(items);
});

router.post("/equipment", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, description, purchaseDate, quantity, unitPrice, condition, notes, department } = req.body;
  if (!name || !department) { res.status(400).json({ error: "Name and department required" }); return; }
  if (!canWriteDepartment(req.user?.role, department)) {
    res.status(403).json({ error: `Only ${department === "kitchen" ? "the head chef" : "the head barista"} or an admin can add ${department} equipment.` });
    return;
  }

  const qty = quantity != null ? parseInt(quantity, 10) : 1;
  const unitP = unitPrice != null ? parseFloat(unitPrice) : null;
  const totalPrice = unitP != null ? qty * unitP : null;

  const [item] = await db.insert(equipmentItemsTable).values({
    name: withDeptPrefix(name, department), description: description ?? null,
    purchaseDate: purchaseDate ?? null,
    quantity: qty,
    unitPrice: unitP != null ? String(unitP) : null,
    purchasePrice: totalPrice != null ? String(totalPrice) : null,
    condition: condition ?? "good",
    notes: notes ?? null,
    department,
  }).returning();

  await db.insert(equipmentLogsTable).values({
    equipmentItemId: item.id, action: "added",
    notes: `Equipment added to inventory (qty: ${qty})`,
    equipmentName: item.name, department: item.department, quantityBefore: 0, quantityAfter: qty,
    changedBy: req.user?.username ?? "admin",
  });
  res.status(201).json(item);
});

router.patch("/equipment/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(equipmentItemsTable).where(eq(equipmentItemsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Equipment not found" }); return; }
  if (!canWriteDepartment(req.user?.role, existing.department)) {
    res.status(403).json({ error: `Only ${existing.department === "kitchen" ? "the head chef" : "the head barista"} or an admin can edit this equipment.` });
    return;
  }

  const { name, description, purchaseDate, quantity, unitPrice, condition, notes } = req.body;
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = withDeptPrefix(name, existing.department);
  if (description !== undefined) updateData.description = description;
  if (purchaseDate !== undefined) updateData.purchaseDate = purchaseDate;
  if (condition !== undefined) updateData.condition = condition;
  if (notes !== undefined) updateData.notes = notes;

  const newQty = quantity !== undefined ? parseInt(quantity, 10) : (existing.quantity ?? 1);
  const newUnitPrice = unitPrice !== undefined ? (unitPrice != null ? parseFloat(unitPrice) : null) : (existing.unitPrice != null ? parseFloat(String(existing.unitPrice)) : null);

  if (quantity !== undefined) updateData.quantity = newQty;
  if (unitPrice !== undefined) updateData.unitPrice = newUnitPrice != null ? String(newUnitPrice) : null;
  if (quantity !== undefined || unitPrice !== undefined) {
    updateData.purchasePrice = newUnitPrice != null ? String(newQty * newUnitPrice) : null;
  }

  const [item] = await db.update(equipmentItemsTable).set(updateData).where(eq(equipmentItemsTable.id, id)).returning();

  const beforeQty = existing.quantity ?? 1;
  const afterQty = item.quantity ?? 1;
  const changes: string[] = [];
  if (afterQty !== beforeQty) changes.push(`quantity ${beforeQty} → ${afterQty}`);
  if (item.name !== existing.name) changes.push(`name "${existing.name}" → "${item.name}"`);
  if (item.condition !== existing.condition) changes.push(`condition ${existing.condition} → ${item.condition}`);
  if (parseFloat(String(item.unitPrice ?? 0)) !== parseFloat(String(existing.unitPrice ?? 0))) changes.push(`unit price Rs. ${parseFloat(String(existing.unitPrice ?? 0))} → Rs. ${parseFloat(String(item.unitPrice ?? 0))}`);
  if ((item.purchaseDate ?? "") !== (existing.purchaseDate ?? "")) changes.push("purchase date changed");
  if ((item.notes ?? "") !== (existing.notes ?? "") || (item.description ?? "") !== (existing.description ?? "")) changes.push("notes changed");
  const changeAction = afterQty > beforeQty ? "restocked" : afterQty < beforeQty ? "reduced" : "updated";
  const changeNotes = changes.length ? changes.join("; ") : "Saved with no changes";

  await db.insert(equipmentLogsTable).values({
    equipmentItemId: id, action: changeAction,
    equipmentName: item.name, department: item.department, quantityBefore: beforeQty, quantityAfter: afterQty,
    notes: changeNotes,
    changedBy: req.user?.username ?? "admin",
  });
  res.json(item);
});

router.delete("/equipment/:id", authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [item] = await db.select().from(equipmentItemsTable).where(eq(equipmentItemsTable.id, id));
  if (!item) { res.status(404).json({ error: "Equipment not found" }); return; }
  if (!canWriteDepartment(req.user?.role, item.department)) {
    res.status(403).json({ error: `Only ${item.department === "kitchen" ? "the head chef" : "the head barista"} or an admin can delete this equipment.` });
    return;
  }
  await db.insert(equipmentLogsTable).values({
    equipmentItemId: id, action: "removed",
    notes: `${item.name} removed from inventory`,
    equipmentName: item.name, department: item.department, quantityBefore: item.quantity ?? 1, quantityAfter: null,
    changedBy: req.user?.username ?? "admin",
  });
  await db.delete(equipmentItemsTable).where(eq(equipmentItemsTable.id, id));
  res.sendStatus(204);
});

router.get("/equipment/logs", authenticate, async (req, res): Promise<void> => {
  const { equipmentItemId, department } = req.query;
  const conditions = [];
  if (equipmentItemId) conditions.push(eq(equipmentLogsTable.equipmentItemId, parseInt(equipmentItemId as string, 10)));
  if (department) conditions.push(sql`COALESCE(${equipmentLogsTable.department}, ${equipmentItemsTable.department}) = ${department as string}`);

  const logs = await db
    .select({
      id: equipmentLogsTable.id,
      equipmentItemId: equipmentLogsTable.equipmentItemId,
      equipmentName: sql<string>`COALESCE(${equipmentLogsTable.equipmentName}, ${equipmentItemsTable.name})`,
      department: sql<string>`COALESCE(${equipmentLogsTable.department}, ${equipmentItemsTable.department})`,
      quantityBefore: equipmentLogsTable.quantityBefore,
      quantityAfter: equipmentLogsTable.quantityAfter,
      action: equipmentLogsTable.action,
      notes: equipmentLogsTable.notes,
      cost: equipmentLogsTable.cost,
      changedBy: equipmentLogsTable.changedBy,
      createdAt: equipmentLogsTable.createdAt,
    })
    .from(equipmentLogsTable)
    .leftJoin(equipmentItemsTable, eq(equipmentLogsTable.equipmentItemId, equipmentItemsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(equipmentLogsTable.createdAt))
    .limit(500);
  res.json(logs);
});

router.post("/equipment/:id/log", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db.select().from(equipmentItemsTable).where(eq(equipmentItemsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Equipment not found" }); return; }
  if (!canWriteDepartment(req.user?.role, existing.department)) {
    res.status(403).json({ error: `Only ${existing.department === "kitchen" ? "the head chef" : "the head barista"} or an admin can log against this equipment.` });
    return;
  }
  const { action, notes, cost } = req.body;
  if (!action) { res.status(400).json({ error: "action required" }); return; }
  const [log] = await db.insert(equipmentLogsTable).values({
    equipmentItemId: id, action, notes: notes ?? null,
    equipmentName: existing.name, department: existing.department,
    cost: cost != null ? String(cost) : null,
    changedBy: req.user?.username ?? "staff",
  }).returning();
  res.status(201).json(log);
});

export default router;