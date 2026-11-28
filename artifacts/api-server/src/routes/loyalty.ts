import { Router, Response } from "express";
import { db, loyaltyCustomersTable, ordersTable, orderItemsTable, menuItemsTable, loyaltyPointLogsTable, loyaltyRedemptionsTable } from "@workspace/db";
import { eq, ilike, and, desc, ne } from "drizzle-orm";
import { billedCounts, isBilled, sulimhaId } from "../lib/stayEvents";
import { authenticate, AuthRequest, requireAdmin } from "../middlewares/auth";

const router = Router();

// 3f: members only, never an archived customer or Sulimha Durbar (hotel guests have their own list on the Stays page).
// ?scope=all (admin) lists everyone, for the Stays settings picker that chooses Sulimha Durbar.
router.get("/loyalty/customers", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const { phone } = req.query;
  if (req.query.scope === "all" && (req.user?.role as string | undefined) === "admin") {
    res.json(await db.select().from(loyaltyCustomersTable).orderBy(loyaltyCustomersTable.name));
    return;
  }
  const sid = await sulimhaId(db);
  // 3f-fix: ?archived=1 lists the archived members instead (admin and supervisor), for Unarchive on the Loyalty page
  const archived = req.query.archived === "1" && ["admin", "supervisor"].includes((req.user?.role as string | undefined) ?? "");
  const conds = [eq(loyaltyCustomersTable.kind, "member"), eq(loyaltyCustomersTable.archived, archived), ...(sid ? [ne(loyaltyCustomersTable.id, sid)] : []),
    ...(phone ? [ilike(loyaltyCustomersTable.phone, `%${phone}%`)] : [])];
  res.json(await db.select().from(loyaltyCustomersTable).where(and(...conds)).orderBy(loyaltyCustomersTable.name));
});

router.post("/loyalty/customers", authenticate, async (req, res): Promise<void> => {
  const { name, phone, email } = req.body;
  if (!name || !phone) { res.status(400).json({ error: "Name and phone required" }); return; }

  const [existingPhone] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.phone, phone));
  if (existingPhone?.archived) { res.status(400).json({ error: "This customer is archived. Ask the admin or a supervisor to bring them back.", archivedCustomerId: existingPhone.id }); return; }
  if (existingPhone?.kind === "hotel_guest") { res.status(400).json({ error: `This phone belongs to hotel guest ${existingPhone.name}. Make them a member from Stays > Guests (Promote), so they keep their stays.` }); return; }
  if (existingPhone) { res.status(400).json({ error: "A loyalty account with this phone number already exists." }); return; }

  if (email) {
    // 3f: an email is unique among members only (a hotel guest may share one)
    const [existingEmail] = await db.select().from(loyaltyCustomersTable).where(and(eq(loyaltyCustomersTable.email, email), eq(loyaltyCustomersTable.kind, "member")));
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

  const [self] = await db.select({ kind: loyaltyCustomersTable.kind }).from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, id));
  if (email && self?.kind === "member") {
    const [existingEmail] = await db.select().from(loyaltyCustomersTable).where(and(eq(loyaltyCustomersTable.email, email), eq(loyaltyCustomersTable.kind, "member")));
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

router.post("/loyalty/customers/:id/points", authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
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

// 3f (owner, 2026-11-28): nothing is deleted. DELETE archives a customer who was never billed (hides them from every list)
// and refuses a billed one, members included; the receivable, the journal and the statements need them.
async function archiveCustomer(req: AuthRequest, res: Response) {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [c] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, id));
  if (!c) { res.status(404).json({ error: "Customer not found" }); return; }
  if (id === (await sulimhaId(db))) { res.status(400).json({ error: "Sulimha Durbar is the hotel's account and cannot be archived." }); return; }
  const b = await billedCounts(db, id);
  if (isBilled(b)) {
    const parts = [b.orders && `${b.orders} bill(s)`, b.receipts && `${b.receipts} receipt(s)`, b.creditNotes && `${b.creditNotes} credit note(s)`].filter(Boolean).join(", ") || "ledger entries";
    res.status(400).json({ error: `${c.name} has ${parts}: a billed ${c.kind === "hotel_guest" ? "guest" : "customer"} cannot be archived or deleted.`, billed: b });
    return;
  }
  const [row] = await db.update(loyaltyCustomersTable).set({ archived: true, archivedBy: req.user?.username ?? "user", archivedAt: new Date() }).where(eq(loyaltyCustomersTable.id, id)).returning();
  res.json(row);
}
const ARCHIVE_ROLES = ["admin", "supervisor"];
const PROMOTE_ROLES = ["admin", "supervisor", "reception"];
const roleOk = (req: AuthRequest, res: Response, roles: string[], msg: string) => { if (roles.includes((req.user?.role as string | undefined) ?? "")) return true; res.status(403).json({ error: msg }); return false; };
router.delete("/loyalty/customers/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!roleOk(req, res, ARCHIVE_ROLES, "Only the admin or a supervisor can archive a customer.")) return;
  await archiveCustomer(req, res);
});
router.post("/loyalty/customers/:id/archive", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!roleOk(req, res, ARCHIVE_ROLES, "Only the admin or a supervisor can archive a customer.")) return;
  await archiveCustomer(req, res);
});
router.post("/loyalty/customers/:id/unarchive", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!roleOk(req, res, ARCHIVE_ROLES, "Only the admin or a supervisor can bring back an archived customer.")) return;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [row] = await db.update(loyaltyCustomersTable).set({ archived: false, archivedBy: null, archivedAt: null }).where(eq(loyaltyCustomersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json(row);
});

// 3f: a hotel guest becomes a loyalty member. A member needs a phone and an email (the email unique among members).
// The guest keeps their stays, invoices and points.
export async function promoteGuest(ex: any, id: number, phone: string | null, email: string | null, name: string | null, by: string): Promise<{ error: string; status: number } | { customer: any }> {
  const [c] = await ex.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, id));
  if (!c) return { status: 404, error: "Customer not found" };
  if (c.kind !== "hotel_guest") return { status: 400, error: `${c.name} is already a loyalty member.` };
  const ph = (phone ?? c.phone ?? "").trim(), em = (email ?? c.email ?? "").trim().toLowerCase();
  if (ph.replace(/\D/g, "").length < 7) return { status: 400, error: "A loyalty member needs a phone number." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return { status: 400, error: "A loyalty member needs an email address." };
  const [byPhone] = await ex.select({ id: loyaltyCustomersTable.id }).from(loyaltyCustomersTable).where(and(eq(loyaltyCustomersTable.phone, ph), ne(loyaltyCustomersTable.id, id)));
  if (byPhone) return { status: 400, error: "That phone number belongs to another customer." };
  const [byEmail] = await ex.select({ id: loyaltyCustomersTable.id }).from(loyaltyCustomersTable).where(and(eq(loyaltyCustomersTable.email, em), eq(loyaltyCustomersTable.kind, "member"), ne(loyaltyCustomersTable.id, id)));
  if (byEmail) return { status: 400, error: "That email belongs to another loyalty member." };
  const [row] = await ex.update(loyaltyCustomersTable).set({ kind: "member", phone: ph, email: em, ...(name ? { name } : {}), archived: false, archivedBy: null, archivedAt: null, promotedBy: by, promotedAt: new Date() })
    .where(eq(loyaltyCustomersTable.id, id)).returning();
  return { customer: row };
}
router.post("/loyalty/customers/:id/promote", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!roleOk(req, res, PROMOTE_ROLES, "Only the admin, a supervisor or reception can make a guest a loyalty member.")) return;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const r = await promoteGuest(db, id, req.body?.phone ?? null, req.body?.email ?? null, null, req.user?.username ?? "user");
  if ("error" in r) { res.status(r.status).json({ error: r.error }); return; }
  res.json(r.customer);
});

export default router;
