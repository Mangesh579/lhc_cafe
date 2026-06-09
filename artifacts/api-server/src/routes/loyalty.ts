import { Router } from "express";
import { db, loyaltyCustomersTable } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

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
  const [existing] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.phone, phone));
  if (existing) { res.status(400).json({ error: "Customer with this phone already exists" }); return; }
  const [customer] = await db.insert(loyaltyCustomersTable).values({ name, phone, email: email ?? null }).returning();
  res.status(201).json(customer);
});

router.patch("/loyalty/customers/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, phone, email } = req.body;
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;
  if (email !== undefined) updateData.email = email;
  const [customer] = await db.update(loyaltyCustomersTable).set(updateData).where(eq(loyaltyCustomersTable.id, id)).returning();
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json(customer);
});

router.post("/loyalty/customers/:id/points", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { points } = req.body;
  const [customer] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, id));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  const [updated] = await db.update(loyaltyCustomersTable).set({ totalPoints: customer.totalPoints + points }).where(eq(loyaltyCustomersTable.id, id)).returning();
  res.json(updated);
});

export default router;
