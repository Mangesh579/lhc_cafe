import { Router } from "express";
import { db, tableRequestsTable, cafeTablesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/table-requests", authenticate, async (_req, res): Promise<void> => {
  const requests = await db
    .select({
      id: tableRequestsTable.id,
      tableId: tableRequestsTable.tableId,
      tableNumber: cafeTablesTable.tableNumber,
      tableName: cafeTablesTable.name,
      requestType: tableRequestsTable.requestType,
      status: tableRequestsTable.status,
      createdAt: tableRequestsTable.createdAt,
    })
    .from(tableRequestsTable)
    .leftJoin(cafeTablesTable, eq(tableRequestsTable.tableId, cafeTablesTable.id))
    .where(eq(tableRequestsTable.status, "pending"))
    .orderBy(desc(tableRequestsTable.createdAt));
  res.json(requests);
});

router.patch("/table-requests/:id/resolve", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.update(tableRequestsTable).set({ status: "resolved", resolvedAt: new Date() }).where(eq(tableRequestsTable.id, id));
  res.sendStatus(204);
});

export default router;