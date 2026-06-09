import { Router } from "express";
import { db, cafeTablesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/tables", authenticate, async (_req, res): Promise<void> => {
  const tables = await db.select().from(cafeTablesTable).orderBy(cafeTablesTable.tableNumber);
  res.json(tables);
});

router.post("/tables", authenticate, async (req, res): Promise<void> => {
  const { tableNumber } = req.body;
  if (!tableNumber) { res.status(400).json({ error: "tableNumber required" }); return; }
  const qrCode = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`/order/${tableNumber}`)}`;
  const [table] = await db.insert(cafeTablesTable).values({ tableNumber, qrCode, isActive: true }).returning();
  res.status(201).json(table);
});

router.delete("/tables/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(cafeTablesTable).where(eq(cafeTablesTable.id, id));
  res.sendStatus(204);
});

export default router;
