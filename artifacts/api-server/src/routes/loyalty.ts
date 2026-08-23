import { Router, Response } from "express";
import { db, loyaltyCustomersTable, ordersTable, orderItemsTable, menuItemsTable, loyaltyPointLogsTable, loyaltyRedemptionsTable } from "@workspace/db";
import { eq, ilike, and, desc } from "drizzle-orm";
import { authenticate, AuthRequest, requireAdmin } from "../middlewares/auth";

const router = Router();

router.get("/loyalty/customers", authenticate, async (req, res): Promise<void> => {
  const { phone } = req.query;
  if (phone) {
    const customers = await db.select().from(loyaltyCustomersTable).where(ilike(loyaltyCustomersTable.phone, `%${phone}%`));
    res.json(customers);
    return;
  }
  const customers = await db.select().from(loyaltyCustomersTable).orderBy(loyaltyCustomersTable.name);
  res.json(customers);
});

router.post("/loyalty/customers", authenticate, async (req, res): Promise<void> => {
  const { name, phone, email } = req.body;
  if (!name || !phone) { res.status(400).json({ error: "Name and phone required" }); return; }

  const [existingPhone] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.phone, phone));
  if (existingPhone) { res.status(400).json({ error: "A loyalty account with this phone number already exists." }); return; }

  if (email) {
    const [existingEmail] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.email, email));
    if (existingEmail) { res.status(400).json({ error: "A loyalty account with this email already exists." }); return; }
  }

  const [customer] = await db.insert(loyaltyCustomersTable).values({ name, phone, email: email ?? null }).returning();
  res.status(201).json(customer);
});

router.patch("/loyalty/customers/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, phone, email } = req.body;

  if (phone) {
    const [existingPhone] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.phone, phone));
    if (existingPhone && existingPhone.id !== id) {
      res.status(400).json({ error: "A loyalty account with this phone number already exists." }); return;
    }
  }

  if (email) {
    const [existingEmail] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.email, email));
    if (existingEmail && existingEmail.id !== id) {
      res.status(400).json({ error: "A loyalty account with this email already exists." }); return;
    }
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;
  if (email !== undefined) updateData.email = email;
  const [customer] = await db.update(loyaltyCustomersTable).set(updateData).where(eq(loyaltyCustomersTable.id, id)).returning();
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json(customer);
});

router.post("/loyalty/customers/:id/points", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { points, reason } = req.body;
  const [customer] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, id));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  const [updated] = await db.update(loyaltyCustomersTable).set({ totalPoints: customer.totalPoints + points }).where(eq(loyaltyCustomersTable.id, id)).returning();

  await db.insert(loyaltyPointLogsTable).values({
    loyaltyCustomerId: id,
    pointsChange: points,
    reason: reason || "Manual adjustment",
    changedBy: req.user?.username ?? "admin",
  });

  res.json(updated);
});

// GET /api/loyalty/customers/:id/point-logs
router.get("/loyalty/customers/:id/point-logs", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const logs = await db
    .select()
    .from(loyaltyPointLogsTable)
    .where(eq(loyaltyPointLogsTable.loyaltyCustomerId, id))
    .orderBy(desc(loyaltyPointLogsTable.createdAt));
  res.json(logs);
});

// GET /api/loyalty/customers/:id/orders
router.get("/loyalty/customers/:id/orders", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  const orders = await db
    .select({
      id: ordersTable.id,
      totalAmount: ordersTable.totalAmount,
      createdAt: ordersTable.createdAt,
      orderStatus: ordersTable.orderStatus,
    })
    .from(ordersTable)
    .where(and(eq(ordersTable.loyaltyCustomerId, id), eq(ordersTable.paymentStatus, "paid")))
    .orderBy(desc(ordersTable.createdAt))
    .limit(20);

  const ordersWithItems = await Promise.all(
    orders.map(async (order) => {
      const items = await db
        .select({
          menuItemName: menuItemsTable.name,
          quantity: orderItemsTable.quantity,
        })
        .from(orderItemsTable)
        .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
        .where(eq(orderItemsTable.orderId, order.id));
      return { ...order, items };
    })
  );

  // Compute most-ordered items across all their orders
  const itemCounts: Record<string, number> = {};
  ordersWithItems.forEach(o => o.items.forEach(i => {
    if (i.menuItemName) itemCounts[i.menuItemName] = (itemCounts[i.menuItemName] ?? 0) + i.quantity;
  }));
  const favoriteItems = Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  res.json({ orders: ordersWithItems, favoriteItems });
});

// GET /api/loyalty/point-logs — all point adjustments across all customers
router.get("/loyalty/point-logs", authenticate, async (_req, res): Promise<void> => {
  const logs = await db
    .select({
      id: loyaltyPointLogsTable.id,
      customerId: loyaltyPointLogsTable.loyaltyCustomerId,
      customerName: loyaltyCustomersTable.name,
      pointsChange: loyaltyPointLogsTable.pointsChange,
      reason: loyaltyPointLogsTable.reason,
      changedBy: loyaltyPointLogsTable.changedBy,
      createdAt: loyaltyPointLogsTable.createdAt,
    })
    .from(loyaltyPointLogsTable)
    .leftJoin(loyaltyCustomersTable, eq(loyaltyPointLogsTable.loyaltyCustomerId, loyaltyCustomersTable.id))
    .orderBy(desc(loyaltyPointLogsTable.createdAt))
    .limit(200);
  res.json(logs);
});

// GET /api/loyalty/redemption-logs — all reward redemptions across all customers
router.get("/loyalty/redemption-logs", authenticate, async (_req, res): Promise<void> => {
  const logs = await db
    .select({
      id: loyaltyRedemptionsTable.id,
      customerId: loyaltyRedemptionsTable.loyaltyCustomerId,
      customerName: loyaltyCustomersTable.name,
      level: loyaltyRedemptionsTable.level,
      loopNumber: loyaltyRedemptionsTable.loopNumber,
      orderId: loyaltyRedemptionsTable.orderId,
      redeemedAt: loyaltyRedemptionsTable.redeemedAt,
    })
    .from(loyaltyRedemptionsTable)
    .leftJoin(loyaltyCustomersTable, eq(loyaltyRedemptionsTable.loyaltyCustomerId, loyaltyCustomersTable.id))
    .orderBy(desc(loyaltyRedemptionsTable.redeemedAt))
    .limit(200);
  res.json(logs);
});

router.delete("/loyalty/customers/:id", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, id));
  res.sendStatus(204);
});

export default router;
