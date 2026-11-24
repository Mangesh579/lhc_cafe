import { Router } from "express";
import { db, loyaltyCustomersTable } from "@workspace/db";
import { eq, or, ilike } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import { MONTHLY_RETIRED_MSG } from "../lib/monthlyRetired";

// Monthly accounts were retired on 2026-11-24 (every open bill was converted into credit invoices).
// Old account bills, converted bills and the conversion history stay readable elsewhere
// (Order Log, Receivables > Converted monthly bills, GET /accounts/conversions). Nothing here deletes data.
const router = Router();

// The monthly-account list is gone; customer balances are on Receivables.
router.get("/accounts", authenticate, async (_req: AuthRequest, res): Promise<void> => {
  res.status(410).json({ error: MONTHLY_RETIRED_MSG });
});

// Search loyalty customers (name or phone); used by "Add customer", the Pay dialog's credit search and Receivables
router.get("/accounts/customers", authenticate, async (req, res): Promise<void> => {
  const q = String(req.query.search ?? "").trim();
  const rows = await db
    .select({ id: loyaltyCustomersTable.id, name: loyaltyCustomersTable.name, phone: loyaltyCustomersTable.phone })
    .from(loyaltyCustomersTable)
    .where(q ? or(ilike(loyaltyCustomersTable.name, `%${q}%`), ilike(loyaltyCustomersTable.phone, `%${q}%`)) : undefined)
    .orderBy(loyaltyCustomersTable.name)
    .limit(30);
  res.json(rows);
});

// Nobody can become a monthly account any more. Turning the old flag off is still allowed (it changes nothing else).
router.patch("/accounts/:id", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.body?.paysMonthly !== false) { res.status(410).json({ error: MONTHLY_RETIRED_MSG }); return; }
  const role = req.user?.role as string | undefined;
  if (!["admin", "supervisor", "head_barista"].includes(role ?? "")) { res.status(403).json({ error: "Not allowed" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.update(loyaltyCustomersTable).set({ paysMonthly: false }).where(eq(loyaltyCustomersTable.id, id));
  res.json({ success: true });
});

export default router;
