import { Router } from "express";
import { db, inventoryItemsTable, inventoryLogsTable, recipesTable, menuItemsTable, ingredientComponentsTable, inventoryAdjustmentRequestsTable } from "@workspace/db";
import { eq, desc, and, gte, lte, inArray, sql } from "drizzle-orm";
import * as os from "os";
import * as fs from "fs";
import { authenticate, requireAdmin, canWriteDepartment, type AuthRequest } from "../middlewares/auth";
import type { Response } from "express";

const router = Router();

// Keeps category spelling consistent within a department ("dairy" matches an existing "Dairy")
async function normalizeCategory(department: string, value: unknown): Promise<string | null> {
  const clean = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) return null;
  const rows = await db.select({ category: inventoryItemsTable.category }).from(inventoryItemsTable).where(eq(inventoryItemsTable.department, department));
  const match = rows.map(r => r.category).find(c => c && c.toLowerCase() === clean.toLowerCase());
  return match ?? clean;
}

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
  const { name, currentStock, unit, minStockLevel, caloriesPerUnit, department, category } = req.body;
  if (!name || !unit || !department) { res.status(400).json({ error: "Name, unit, and department required" }); return; }
  if (!canWriteDepartment(req.user?.role, department)) {
    res.status(403).json({ error: `Only ${department === "kitchen" ? "the head chef" : "the head barista"} or an admin can add ${department} ingredients.` });
    return;
  }

  const [item] = await db.insert(inventoryItemsTable).values({
    name: withDeptPrefix(name, department), currentStock: String(currentStock ?? 0), unit, department,
    category: await normalizeCategory(department, category),
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

  const { name, currentStock, unit, minStockLevel, caloriesPerUnit, category } = req.body;
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = withDeptPrefix(name, existing.department);
    if (currentStock !== undefined && parseFloat(String(currentStock)) !== parseFloat(String(existing.currentStock))) {
    if (req.user?.role !== "admin") {
      res.status(400).json({ error: "Stock can't be edited directly. Use \"Request change\" so the admin can approve it." });
      return;
    }
    updateData.currentStock = String(currentStock);
  }
  if (unit !== undefined) updateData.unit = unit;
  if (category !== undefined) updateData.category = await normalizeCategory(existing.department, category);
  if (minStockLevel !== undefined) updateData.minStockLevel = minStockLevel != null ? String(minStockLevel) : null;
  if (caloriesPerUnit !== undefined) updateData.caloriesPerUnit = caloriesPerUnit != null ? String(caloriesPerUnit) : null;
  const [item] = await db.update(inventoryItemsTable).set(updateData).where(eq(inventoryItemsTable.id, id)).returning();
  if (updateData.currentStock !== undefined) {
    const before = parseFloat(String(existing.currentStock));
    const after = parseFloat(String(updateData.currentStock));
    await db.insert(inventoryLogsTable).values({
      inventoryItemId: id, changeAmount: String(after - before), stockBefore: String(before), stockAfter: String(after),
      reason: "Stock edited directly by admin", changedBy: req.user?.username ?? "admin",
    });
  }
  res.json(item);
});

router.delete("/inventory/:id", authenticate, requireAdmin, async (req: AuthRequest, res): Promise<void> => {
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
    if (req.user?.role !== "admin") {
    const qty = parseFloat(String(quantity));
    if (!Number.isFinite(qty) || qty === 0) { res.status(400).json({ error: "Enter a quantity change other than 0." }); return; }
    const [request] = await db.insert(inventoryAdjustmentRequestsTable).values({
      inventoryItemId: id, quantity: String(qty), reason, requestedBy: req.user?.username ?? "staff",
    }).returning();
    res.status(202).json({ pending: true, request });
    return;
  }
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

router.get("/inventory/usage-report", authenticate, async (req, res): Promise<void> => {
  const from = new Date(String(req.query.from ?? ""));
  const to = new Date(String(req.query.to ?? ""));
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) {
    res.status(400).json({ error: "Valid from and to times are required (from must be before to)." });
    return;
  }
  const department = req.query.department ? String(req.query.department) : undefined;

  const conditions = [gte(inventoryLogsTable.createdAt, from), lte(inventoryLogsTable.createdAt, to)];
  if (department) conditions.push(eq(inventoryItemsTable.department, department));

  const logs = await db
    .select({
      id: inventoryLogsTable.id,
      inventoryItemId: inventoryLogsTable.inventoryItemId,
      ingredientName: inventoryItemsTable.name,
      unit: inventoryItemsTable.unit,
      department: inventoryItemsTable.department,
      changeAmount: inventoryLogsTable.changeAmount,
      stockBefore: inventoryLogsTable.stockBefore,
      stockAfter: inventoryLogsTable.stockAfter,
      reason: inventoryLogsTable.reason,
      orderId: inventoryLogsTable.orderId,
      menuItemName: menuItemsTable.name,
      createdAt: inventoryLogsTable.createdAt,
    })
    .from(inventoryLogsTable)
    .leftJoin(inventoryItemsTable, eq(inventoryLogsTable.inventoryItemId, inventoryItemsTable.id))
    .leftJoin(menuItemsTable, eq(inventoryLogsTable.menuItemId, menuItemsTable.id))
    .where(and(...conditions))
    .orderBy(inventoryLogsTable.createdAt, inventoryLogsTable.id);

  const byItem = new Map<number, typeof logs>();
  for (const l of logs) {
    if (l.inventoryItemId == null) continue;
    byItem.set(l.inventoryItemId, [...(byItem.get(l.inventoryItemId) ?? []), l]);
  }

  const summary: any[] = [];
  const included = new Set<number>();
  for (const [itemId, rows] of byItem) {
    if (!rows.some(r => r.orderId != null)) continue; // only ingredients used by orders
    included.add(itemId);
    let used = 0, prepWaste = 0, restored = 0, other = 0;
    for (const r of rows) {
      const ch = parseFloat(String(r.changeAmount));
      if (r.orderId != null) {
        if (ch < 0) { used += -ch; if (String(r.reason ?? "").includes("prep waste")) prepWaste += -ch; }
        else restored += ch;
      } else other += ch;
    }
    summary.push({
      name: rows[0].ingredientName ?? "",
      department: rows[0].department ?? "",
      unit: rows[0].unit ?? "",
      opening: parseFloat(String(rows[0].stockBefore)),
      used, prepWaste, restored, otherAdjustments: other,
      closing: parseFloat(String(rows[rows.length - 1].stockAfter)),
    });
  }
  summary.sort((a, b) => a.name.localeCompare(b.name));

  const details = logs
    .filter(l => l.orderId != null && l.inventoryItemId != null && included.has(l.inventoryItemId))
    .map(l => ({
      createdAt: l.createdAt,
      orderId: l.orderId,
      menuItemName: l.menuItemName,
      ingredientName: l.ingredientName,
      unit: l.unit,
      department: l.department,
      change: parseFloat(String(l.changeAmount)),
      stockBefore: parseFloat(String(l.stockBefore)),
      stockAfter: parseFloat(String(l.stockAfter)),
      reason: l.reason,
    }));

  res.json({ summary, details });
});

router.get("/system/server-stats", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  let database: { bytes: number; pretty: string } | null = null;
  try {
    const r: any = await db.execute(sql`SELECT pg_database_size(current_database()) AS bytes, pg_size_pretty(pg_database_size(current_database())) AS pretty`);
    const row = (r.rows ?? r)[0];
    database = { bytes: Number(row.bytes), pretty: String(row.pretty) };
  } catch { /* leave null */ }

  // Memory: prefer MemAvailable from /proc/meminfo (counts reclaimable cache as available)
  let totalMem = os.totalmem();
  let availableMem = os.freemem();
  try {
    const info = fs.readFileSync("/proc/meminfo", "utf8");
    const t = info.match(/MemTotal:\s+(\d+) kB/);
    const a = info.match(/MemAvailable:\s+(\d+) kB/);
    if (t) totalMem = Number(t[1]) * 1024;
    if (a) availableMem = Number(a[1]) * 1024;
  } catch { /* fall back to os values */ }

  const candidates = [
    { path: "/", label: "Server disk (WSL Linux)" },
    { path: "/mnt/c", label: "Windows C: drive" },
    { path: "/mnt/e", label: "Windows E: drive" },
  ];
  const disks: { label: string; path: string; totalBytes: number; freeBytes: number }[] = [];
  for (const c of candidates) {
    try {
      const s = fs.statfsSync(c.path);
      const totalBytes = Number(s.blocks) * Number(s.bsize);
      const freeBytes = Number(s.bavail) * Number(s.bsize);
      if (totalBytes > 0) disks.push({ label: c.label, path: c.path, totalBytes, freeBytes });
    } catch { /* path not available */ }
  }

  res.json({
    database,
    memory: { totalBytes: totalMem, usedBytes: totalMem - availableMem },
    disks,
    system: { uptimeSeconds: os.uptime(), cpuCount: os.cpus().length, load1: os.loadavg()[0] },
  });
});

router.get("/inventory/requests", authenticate, async (req, res): Promise<void> => {
  const statuses = String(req.query.status ?? "pending").split(",").map(s => s.trim()).filter(Boolean);
  const rows = await db
    .select({
      id: inventoryAdjustmentRequestsTable.id,
      inventoryItemId: inventoryAdjustmentRequestsTable.inventoryItemId,
      ingredientName: inventoryItemsTable.name,
      unit: inventoryItemsTable.unit,
      department: inventoryItemsTable.department,
      currentStock: inventoryItemsTable.currentStock,
      quantity: inventoryAdjustmentRequestsTable.quantity,
      reason: inventoryAdjustmentRequestsTable.reason,
      status: inventoryAdjustmentRequestsTable.status,
      requestedBy: inventoryAdjustmentRequestsTable.requestedBy,
      requestedAt: inventoryAdjustmentRequestsTable.requestedAt,
      resolvedBy: inventoryAdjustmentRequestsTable.resolvedBy,
      resolvedAt: inventoryAdjustmentRequestsTable.resolvedAt,
      resolutionNote: inventoryAdjustmentRequestsTable.resolutionNote,
    })
    .from(inventoryAdjustmentRequestsTable)
    .leftJoin(inventoryItemsTable, eq(inventoryAdjustmentRequestsTable.inventoryItemId, inventoryItemsTable.id))
    .where(inArray(inventoryAdjustmentRequestsTable.status, statuses))
    .orderBy(desc(inventoryAdjustmentRequestsTable.requestedAt))
    .limit(200);
  res.json(rows);
});

router.post("/inventory/requests/:id/approve", authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [request] = await db.select().from(inventoryAdjustmentRequestsTable).where(eq(inventoryAdjustmentRequestsTable.id, id));
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }
  if (request.status !== "pending") { res.status(400).json({ error: `This request was already ${request.status}.` }); return; }

  const [current] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, request.inventoryItemId));
  if (!current) { res.status(404).json({ error: "That ingredient no longer exists." }); return; }

  const change = parseFloat(String(request.quantity));
  const stockBefore = parseFloat(String(current.currentStock));
  const stockAfter = stockBefore + change;

  const admin = req.user?.username ?? "admin";
  let applied = false as boolean;
  await db.transaction(async (tx) => {
    const claimed = await tx.update(inventoryAdjustmentRequestsTable)
      .set({ status: "approved", resolvedBy: admin, resolvedAt: new Date() })
      .where(and(eq(inventoryAdjustmentRequestsTable.id, id), eq(inventoryAdjustmentRequestsTable.status, "pending")))
      .returning();
    if (claimed.length === 0) return;
    await tx.update(inventoryItemsTable).set({ currentStock: String(stockAfter) }).where(eq(inventoryItemsTable.id, request.inventoryItemId));
    await tx.insert(inventoryLogsTable).values({
      inventoryItemId: request.inventoryItemId,
      changeAmount: String(change),
      stockBefore: String(stockBefore),
      stockAfter: String(stockAfter),
      reason: `${request.reason} — requested by ${request.requestedBy}, approved by ${admin}`,
      changedBy: admin,
    });
    applied = true;
  });
  if (!applied) { res.status(400).json({ error: "This request was already handled." }); return; }
  res.json({ success: true, stockBefore, stockAfter });
});

router.post("/inventory/requests/:id/cancel", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [request] = await db.select().from(inventoryAdjustmentRequestsTable).where(eq(inventoryAdjustmentRequestsTable.id, id));
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }
  if (request.requestedBy !== req.user?.username) {
    res.status(403).json({ error: "Only the person who made this request can cancel it." });
    return;
  }
  const updated = await db.update(inventoryAdjustmentRequestsTable)
    .set({ status: "cancelled", resolvedBy: request.requestedBy, resolvedAt: new Date() })
    .where(and(eq(inventoryAdjustmentRequestsTable.id, id), eq(inventoryAdjustmentRequestsTable.status, "pending")))
    .returning();
  if (updated.length === 0) { res.status(400).json({ error: "This request was already handled." }); return; }
  res.json({ success: true });
});

router.post("/inventory/requests/:id/reject", authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  const updated = await db.update(inventoryAdjustmentRequestsTable)
    .set({ status: "rejected", resolvedBy: req.user?.username ?? "admin", resolvedAt: new Date(), resolutionNote: note || null })
    .where(and(eq(inventoryAdjustmentRequestsTable.id, id), eq(inventoryAdjustmentRequestsTable.status, "pending")))
    .returning();
  if (updated.length === 0) { res.status(400).json({ error: "This request was already handled." }); return; }
  res.json({ success: true });
});

router.get("/inventory/components", authenticate, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      parentItemId: ingredientComponentsTable.parentItemId,
      childItemId: ingredientComponentsTable.childItemId,
      quantity: ingredientComponentsTable.quantity,
      childName: inventoryItemsTable.name,
      childUnit: inventoryItemsTable.unit,
    })
    .from(ingredientComponentsTable)
    .innerJoin(inventoryItemsTable, eq(ingredientComponentsTable.childItemId, inventoryItemsTable.id));
  res.json(rows);
});

router.put("/inventory/:id/components", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [parent] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  if (!parent) { res.status(404).json({ error: "Item not found" }); return; }
  if (!canWriteDepartment(req.user?.role, parent.department)) {
    res.status(403).json({ error: `Only ${parent.department === "kitchen" ? "the head chef" : "the head barista"} or an admin can edit this item.` });
    return;
  }

  const batchYield = parseFloat(String(req.body.batchYield ?? 1));
  const components: { childItemId: number; quantity: number }[] = Array.isArray(req.body.components) ? req.body.components : [];
  if (!(batchYield > 0)) { res.status(400).json({ error: "The amount this recipe makes must be above 0." }); return; }
  for (const c of components) {
    if (!Number.isInteger(c.childItemId) || !(Number(c.quantity) > 0)) { res.status(400).json({ error: "Each component needs an ingredient and a quantity above 0." }); return; }
    if (c.childItemId === id) { res.status(400).json({ error: "An ingredient cannot contain itself." }); return; }
  }
  if (new Set(components.map(c => c.childItemId)).size !== components.length) { res.status(400).json({ error: "The same ingredient is listed twice." }); return; }

  // Block loops: a child may not lead back to this ingredient through its own components.
  const allLinks = await db.select().from(ingredientComponentsTable);
  const graph = new Map<number, number[]>();
  for (const l of allLinks) {
    if (l.parentItemId === id) continue;
    graph.set(l.parentItemId, [...(graph.get(l.parentItemId) ?? []), l.childItemId]);
  }
  const reaches = (from: number, target: number, seen = new Set<number>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (graph.get(from) ?? []).some(n => reaches(n, target, seen));
  };
  if (components.some(c => reaches(c.childItemId, id))) {
    res.status(400).json({ error: "That would create a loop: an ingredient cannot contain itself, even indirectly." });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(ingredientComponentsTable).where(eq(ingredientComponentsTable.parentItemId, id));
    for (const c of components) {
      await tx.insert(ingredientComponentsTable).values({ parentItemId: id, childItemId: c.childItemId, quantity: String(c.quantity) });
    }
  });

  // Calories per unit = sum of component calories / amount the recipe makes
  let caloriesPerUnit: string | null = parent.caloriesPerUnit;
  if (components.length > 0) {
    const everyItem = await db.select().from(inventoryItemsTable);
    const byId = new Map(everyItem.map(i => [i.id, i]));
    const total = components.reduce((s, c) => s + parseFloat(String(byId.get(c.childItemId)?.caloriesPerUnit ?? 0)) * Number(c.quantity), 0);
    if (total > 0) caloriesPerUnit = String(total / batchYield);
  }

  const [updated] = await db.update(inventoryItemsTable)
    .set({ batchYield: String(batchYield), caloriesPerUnit })
    .where(eq(inventoryItemsTable.id, id))
    .returning();
  res.json(updated);
});

export default router;