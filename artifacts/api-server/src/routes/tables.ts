import { Router } from "express";
import { db, cafeTablesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { createHmac, randomBytes } from "crypto";

const router = Router();

function tableToken(tableNumber: number): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required to generate table tokens.");
  }
  return createHmac("sha256", secret)
    .update(`table-${tableNumber}`)
    .digest("hex");
}

router.get("/tables", authenticate, async (_req, res): Promise<void> => {
  const tables = await db.select().from(cafeTablesTable).orderBy(cafeTablesTable.tableNumber);
  res.json(tables);
});

router.post("/tables", authenticate, async (req, res): Promise<void> => {
  const { tableNumber } = req.body;
  if (!tableNumber) { res.status(400).json({ error: "tableNumber required" }); return; }
  const token = tableToken(tableNumber);
  // If a table with this number was deleted and recreated, upsert to reuse the same token
  const existing = await db.select().from(cafeTablesTable).where(eq(cafeTablesTable.tableNumber, tableNumber)).limit(1);
  if (existing.length > 0) {
    const [table] = await db.update(cafeTablesTable).set({ token, isActive: true }).where(eq(cafeTablesTable.tableNumber, tableNumber)).returning();
    res.status(201).json(table);
    return;
  }
  const [table] = await db.insert(cafeTablesTable).values({ tableNumber, token, isActive: true }).returning();
  res.status(201).json(table);
});

router.delete("/tables/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(cafeTablesTable).where(eq(cafeTablesTable.id, id));
  res.sendStatus(204);
});

router.patch("/tables/:id/rename", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name } = req.body;
  const [table] = await db.update(cafeTablesTable).set({ name: name || null }).where(eq(cafeTablesTable.id, id)).returning();
  if (!table) { res.status(404).json({ error: "Table not found" }); return; }
  res.json(table);
});

router.patch("/tables/:id/occupy", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { isOccupied } = req.body;
  const updateData: Record<string, unknown> = { isOccupied: !!isOccupied };
  // Stamp a fresh "opened" timestamp every time staff opens the table —
  // this invalidates any session created under a previous opening, even
  // if that session row technically still exists.
  if (isOccupied) updateData.openedAt = randomBytes(8).toString("hex");
  const [table] = await db.update(cafeTablesTable).set(updateData).where(eq(cafeTablesTable.id, id)).returning();
  if (!table) { res.status(404).json({ error: "Table not found" }); return; }
  res.json(table);
});

export default router;