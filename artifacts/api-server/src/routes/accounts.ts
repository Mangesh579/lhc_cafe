import { Router } from "express";
import { db, loyaltyCustomersTable, ordersTable, orderItemsTable } from "@workspace/db";
import { eq, and, or, ilike, sql, inArray } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";

const router = Router();
const canView = (role?: string) => role === "admin" || role === "supervisor" || role === "head_barista" || role === "accountant";
const canEdit = (role?: string) => role === "admin" || role === "supervisor" || role === "head_barista";

// Monthly-account customers with their open balance
router.get("/accounts", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const role = req.user?.role as string | undefined;
  if (!canView(role)) { res.status(403).json({ error: "Not allowed" }); return; }
  const customers = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.paysMonthly, true)).orderBy(loyaltyCustomersTable.name);
  const bills = await db.select().from(ordersTable).where(and(
    eq(ordersTable.accountBill, true), eq(ordersTable.paymentStatus, "pending"), sql`${ordersTable.orderStatus} <> 'cancelled'`,
  ));
  const ids = bills.map(b => b.id);
  const items = ids.length
    ? await db.select({ orderId: orderItemsTable.orderId, kot: orderItemsTable.kotNumber, qty: orderItemsTable.quantity }).from(orderItemsTable).where(inArray(orderItemsTable.orderId, ids))
    : [];
  res.json(customers.map(c => {
    const bill = bills.find(b => b.loyaltyCustomerId === c.id);
    const its = bill ? items.filter(i => i.orderId === bill.id) : [];
    return {
      id: c.id, name: c.name, phone: c.phone,
      openBill: bill ? {
        id: bill.id, total: parseFloat(String(bill.totalAmount)),
        kotCount: new Set(its.map(i => i.kot ?? 1)).size, dishes: its.reduce((s, i) => s + i.qty, 0), since: bill.createdAt,
      } : null,
    };
  }));
});

// Search loyalty customers (name or phone); used by "Add customer" and the Monthly Accounts page
router.get("/accounts/customers", authenticate, async (req, res): Promise<void> => {
  const q = String(req.query.search ?? "").trim();
  const rows = await db
    .select({ id: loyaltyCustomersTable.id, name: loyaltyCustomersTable.name, phone: loyaltyCustomersTable.phone, paysMonthly: loyaltyCustomersTable.paysMonthly })
    .from(loyaltyCustomersTable)
    .where(q ? or(ilike(loyaltyCustomersTable.name, `%${q}%`), ilike(loyaltyCustomersTable.phone, `%${q}%`)) : undefined)
    .orderBy(loyaltyCustomersTable.name)
    .limit(30);
  res.json(rows);
});

router.patch("/accounts/:id", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const role = req.user?.role as string | undefined;
  if (!canEdit(role)) { res.status(403).json({ error: "Only the admin, a supervisor or the head barista can change this." }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const value = !!req.body?.paysMonthly;
  if (!value) {
    const [open] = await db.select().from(ordersTable).where(and(
      eq(ordersTable.loyaltyCustomerId, id), eq(ordersTable.accountBill, true), eq(ordersTable.paymentStatus, "pending"), sql`${ordersTable.orderStatus} <> 'cancelled'`,
    )).limit(1);
    if (open) { res.status(400).json({ error: `This customer still has an open account bill (#${open.id}). Pay or cancel it first.` }); return; }
  }
  await db.update(loyaltyCustomersTable).set({ paysMonthly: value }).where(eq(loyaltyCustomersTable.id, id));
  res.json({ success: true });
});

export default router;