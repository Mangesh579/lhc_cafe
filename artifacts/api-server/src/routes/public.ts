import { Router } from "express";
import { db, menuItemsTable, menuCategoriesTable, ordersTable, orderItemsTable, cafeTablesTable, tableSessionsTable, recipesTable, inventoryItemsTable, inventoryLogsTable, bestsellerCacheTable, loyaltyEmailVerificationsTable, loyaltyCustomersTable } from "@workspace/db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { randomBytes, randomInt } from "crypto";
import { publicOrderRateLimiter } from "../middlewares/rateLimit";
import { Resend } from "resend";
import type { Request, Response, NextFunction } from "express";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "noreply@example.com";

const router = Router();

// Only requests originating from the cafe's own Wi-Fi (static IP) may
// start, validate, or use a table session. This is the actual physical
// presence check — far more reliable than GPS and with zero permission
// prompts for the customer.
const ALLOWED_IPS = (process.env.CAFE_WIFI_IPS ?? "")
  .split(",")
  .map(ip => ip.trim())
  .filter(Boolean);

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "";
}

function requireCafeWifi(req: Request, res: Response, next: NextFunction): void {
  if (ALLOWED_IPS.length === 0) {
    res.status(503).json({ error: "Ordering is temporarily unavailable. Please ask staff." });
    return;
  }
  const clientIp = getClientIp(req);
  const isAllowed = ALLOWED_IPS.some(allowed => clientIp === allowed || clientIp.includes(allowed));
  if (!isAllowed) {
    res.status(403).json({ error: "Please connect to the cafe Wi-Fi to place an order." });
    return;
  }
  next();
}

const SESSION_IDLE_MINUTES = 30;
const BESTSELLER_CACHE_DAYS = 30;

async function resolveSession(sessionToken: string) {
  const [session] = await db
    .select()
    .from(tableSessionsTable)
    .where(eq(tableSessionsTable.sessionToken, sessionToken))
    .limit(1);

  if (!session) return null;

  if (session.expiresAt && new Date() > session.expiresAt) {
    await db.delete(tableSessionsTable).where(eq(tableSessionsTable.id, session.id));
    return null;
  }

  const idleCutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000);
  if (session.lastActivityAt < idleCutoff) {
    await db.delete(tableSessionsTable).where(eq(tableSessionsTable.id, session.id));
    return null;
  }

  // Check the table is still occupied AND hasn't been reopened since this session was created.
  // If staff closed and reopened the table, openedAt changes — old sessions die instantly.
  const [table] = await db.select().from(cafeTablesTable).where(eq(cafeTablesTable.id, session.tableId)).limit(1);
  if (!table || !table.isOccupied) {
    await db.delete(tableSessionsTable).where(eq(tableSessionsTable.id, session.id));
    return null;
  }
  if (table.openedAt !== session.tableOpenedAt) {
    await db.delete(tableSessionsTable).where(eq(tableSessionsTable.id, session.id));
    return null;
  }

  await db
    .update(tableSessionsTable)
    .set({ lastActivityAt: new Date() })
    .where(eq(tableSessionsTable.id, session.id));

  return session;
}

// POST /api/public/session/start
router.post("/session/start", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  try {
    const { tableToken } = req.body;
    if (!tableToken) { res.status(400).json({ error: "tableToken required" }); return; }

    const [table] = await db
      .select()
      .from(cafeTablesTable)
      .where(eq(cafeTablesTable.token, tableToken))
      .limit(1);

    if (!table) { res.status(404).json({ error: "Invalid QR code" }); return; }

    if (!table.isOccupied) {
      res.status(403).json({ error: "This table is not currently active. Please ask staff to seat you." });
      return;
    }

    // Only reuse an existing session if it was created under the SAME opening event.
    // A session from a previous opening (even if not yet cleaned up) is never reused.
    const [existing] = await db
      .select()
      .from(tableSessionsTable)
      .where(eq(tableSessionsTable.tableId, table.id))
      .limit(1);

    if (existing) {
      const idleCutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000);
      const hardExpired = existing.expiresAt && new Date() > existing.expiresAt;
      const idleExpired = existing.lastActivityAt < idleCutoff;
      const sameOpening = existing.tableOpenedAt === table.openedAt;

      if (!hardExpired && !idleExpired && sameOpening) {
        await db.update(tableSessionsTable)
          .set({ lastActivityAt: new Date() })
          .where(eq(tableSessionsTable.id, existing.id));
        res.json({ sessionToken: existing.sessionToken, tableNumber: table.tableNumber });
        return;
      }
      // Stale session from a previous opening, or expired — remove it
      await db.delete(tableSessionsTable).where(eq(tableSessionsTable.id, existing.id));
    }

    const sessionToken = randomBytes(32).toString("hex");
    await db.insert(tableSessionsTable).values({
      tableId: table.id,
      sessionToken,
      lastActivityAt: new Date(),
      tableOpenedAt: table.openedAt ?? null,
    });

    res.json({ sessionToken, tableNumber: table.tableNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/public/session/validate?sessionToken=xxx
router.get("/session/validate", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  const { sessionToken } = req.query as { sessionToken: string };
  if (!sessionToken) { res.status(400).json({ valid: false }); return; }

  const session = await resolveSession(sessionToken);
  if (!session) { res.status(401).json({ valid: false, reason: "expired" }); return; }

  const [table] = await db.select().from(cafeTablesTable).where(eq(cafeTablesTable.id, session.tableId)).limit(1);
  res.json({ valid: true, tableNumber: table?.tableNumber });
});

async function getBestsellerIds(): Promise<Set<number>> {
  const [latest] = await db.select().from(bestsellerCacheTable).orderBy(desc(bestsellerCacheTable.computedAt)).limit(1);
  const cacheAge = latest ? (Date.now() - new Date(latest.computedAt).getTime()) / (1000 * 60 * 60 * 24) : Infinity;

  if (latest && cacheAge < BESTSELLER_CACHE_DAYS) {
    const cached = await db.select().from(bestsellerCacheTable);
    return new Set(cached.map(c => c.menuItemId));
  }

  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

  const sold = await db
    .select({
      menuItemId: orderItemsTable.menuItemId,
      categoryId: menuItemsTable.categoryId,
      totalQty: sql<number>`SUM(${orderItemsTable.quantity})`.as("total_qty"),
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .innerJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
    .where(and(eq(ordersTable.paymentStatus, "paid"), gte(ordersTable.createdAt, twoMonthsAgo)))
    .groupBy(orderItemsTable.menuItemId, menuItemsTable.categoryId)
    .orderBy(desc(sql`total_qty`));

  const byCategory = new Map<number, { menuItemId: number; totalQty: number }[]>();
  for (const row of sold) {
    const catId = row.categoryId ?? 0;
    if (!byCategory.has(catId)) byCategory.set(catId, []);
    byCategory.get(catId)!.push({ menuItemId: row.menuItemId, totalQty: Number(row.totalQty) });
  }

  await db.delete(bestsellerCacheTable);
  const newIds = new Set<number>();
  for (const [catId, items] of byCategory.entries()) {
    const top3 = items.slice(0, 3);
    for (let i = 0; i < top3.length; i++) {
      await db.insert(bestsellerCacheTable).values({
        menuItemId: top3[i].menuItemId,
        categoryId: catId || null,
        rank: i + 1,
        totalQuantity: top3[i].totalQty,
      });
      newIds.add(top3[i].menuItemId);
    }
  }

  return newIds;
}

// GET /api/public/menu?sessionToken=xxx
// GET /api/public/menu?sessionToken=xxx
router.get("/menu", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  const { sessionToken } = req.query as { sessionToken: string };
  const session = await resolveSession(sessionToken);
  if (!session) { res.status(401).json({ error: "Session expired" }); return; }

  const categories = await db.select().from(menuCategoriesTable);
  const items = await db.select().from(menuItemsTable).where(eq(menuItemsTable.isAvailable, true));
  const bestsellerIds = await getBestsellerIds();
  const itemsWithBadge = items.map(item => ({ ...item, isBestseller: bestsellerIds.has(item.id) }));

  res.json({ categories, items: itemsWithBadge });
});

// GET /api/public/my-orders?sessionToken=xxx
router.get("/my-orders", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  const { sessionToken } = req.query as { sessionToken: string };
  const session = await resolveSession(sessionToken);
  if (!session) { res.status(401).json({ error: "Session expired" }); return; }

  const myOrders = await db
    .select({
      id: ordersTable.id,
      orderStatus: ordersTable.orderStatus,
      paymentStatus: ordersTable.paymentStatus,
      totalAmount: ordersTable.totalAmount,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(eq(ordersTable.tableId, session.tableId))
    .orderBy(ordersTable.createdAt);

  const ordersWithItems = await Promise.all(
    myOrders.map(async (order) => {
      const items = await db
        .select({
          id: orderItemsTable.id,
          menuItemId: orderItemsTable.menuItemId,
          menuItemName: menuItemsTable.name,
          quantity: orderItemsTable.quantity,
          subtotal: orderItemsTable.subtotal,
        })
        .from(orderItemsTable)
        .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
        .where(eq(orderItemsTable.orderId, order.id));
      return { ...order, items };
    })
  );

  res.json(ordersWithItems);
});

// POST /api/public/order
router.post("/order", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  try {
    const { sessionToken, items, customerNote, paymentMethod } = req.body;
    const session = await resolveSession(sessionToken);
    if (!session) { res.status(401).json({ error: "Session expired. Please scan the QR code again." }); return; }

    const [table] = await db.select().from(cafeTablesTable).where(eq(cafeTablesTable.id, session.tableId)).limit(1);
    if (!table) { res.status(404).json({ error: "Table not found" }); return; }
    if (!table.isOccupied) {
      await db.delete(tableSessionsTable).where(eq(tableSessionsTable.id, session.id));
      res.status(403).json({ error: "This table has been closed. Please ask staff for assistance." });
      return;
    }

    let totalAmount = 0;
    const resolvedItems: Array<{ menuItemId: number; quantity: number; unitPrice: number; subtotal: number; notes?: string }> = [];

    for (const item of items) {
      const [menuItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, item.menuItemId)).limit(1);
      if (!menuItem) continue;
      const unitPrice = parseFloat(String(menuItem.price));
      const subtotal = unitPrice * item.quantity;
      totalAmount += subtotal;
      resolvedItems.push({ menuItemId: item.menuItemId, quantity: item.quantity, unitPrice, subtotal, notes: item.notes });
    }

    const [order] = await db.insert(ordersTable).values({
      tableId: table.id,
      totalAmount: String(totalAmount),
      paymentMethod: paymentMethod ?? "cash",
      paymentStatus: "pending",
      orderStatus: "pending",
      notes: customerNote ?? null,
    }).returning();

    for (const item of resolvedItems) {
      await db.insert(orderItemsTable).values({
        orderId: order.id,
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice: String(item.unitPrice),
        subtotal: String(item.subtotal),
        notes: item.notes ?? null,
      });
    }

    for (const item of resolvedItems) {
      const recipes = await db.select().from(recipesTable).where(eq(recipesTable.menuItemId, item.menuItemId));
      for (const recipe of recipes) {
        const needed = parseFloat(String(recipe.quantityRequired)) * item.quantity;
        const [inv] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, recipe.inventoryItemId));
        if (inv) {
          const stockBefore = parseFloat(String(inv.currentStock));
          const stockAfter = Math.max(0, stockBefore - needed);
          await db.update(inventoryItemsTable).set({ currentStock: String(stockAfter) }).where(eq(inventoryItemsTable.id, inv.id));
          await db.insert(inventoryLogsTable).values({
            inventoryItemId: inv.id,
            changeAmount: String(-needed),
            stockBefore: String(stockBefore),
            stockAfter: String(stockAfter),
            reason: `QR Order #${order.id} (Table ${table.tableNumber})`,
            orderId: order.id,
          });
        }
      }
    }

    res.json({ success: true, orderId: order.id, totalAmount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to place order" });
  }
});

// POST /api/public/loyalty/request-otp
// Sends a 6-digit OTP to the customer's email for loyalty verification.
// Rate limited to prevent spam — max 30/min by the existing publicOrderRateLimiter.
router.post("/loyalty/request-otp", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  try {
    const { phone, email } = req.body;
    if (!phone || !email) { res.status(400).json({ error: "Phone and email are required" }); return; }

    // Check the customer exists with this phone number
    const [customer] = await db
      .select()
      .from(loyaltyCustomersTable)
      .where(eq(loyaltyCustomersTable.phone, phone))
      .limit(1);

    if (!customer) {
      res.status(404).json({ error: "No loyalty account found for this phone number. Please ask staff to register you." });
      return;
    }

    // Generate 6-digit OTP
    const otp = String(randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete any existing unused OTP for this phone+email pair
    await db.delete(loyaltyEmailVerificationsTable)
      .where(and(
        eq(loyaltyEmailVerificationsTable.phone, phone),
        eq(loyaltyEmailVerificationsTable.email, email)
      ));

    // Store new OTP
    await db.insert(loyaltyEmailVerificationsTable).values({
      phone,
      email,
      otp,
      expiresAt,
      verified: false,
    });

    // Send email via Resend
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: "Your LHC Cafe loyalty verification code",
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:32px;background:#fdf8f0;border-radius:12px;">
          <h2 style="color:#1A0F0A;margin-bottom:8px;">LHC Cafe</h2>
          <p style="color:#5a4a3a;font-size:14px;margin-bottom:24px;">Sulimha Durbar · Patan</p>
          <p style="color:#1A0F0A;font-size:15px;margin-bottom:16px;">Your verification code for loyalty points redemption:</p>
          <div style="background:#C8873A;color:#fff;font-size:36px;font-weight:bold;letter-spacing:0.2em;text-align:center;padding:20px;border-radius:8px;margin-bottom:20px;">
            ${otp}
          </div>
          <p style="color:#7a6a5a;font-size:13px;">This code expires in <strong>10 minutes</strong>.</p>
          <p style="color:#7a6a5a;font-size:13px;">If you didn't request this, please ignore this email.</p>
        </div>
      `,
    });

    res.json({ success: true, message: "OTP sent to your email" });
  } catch (err) {
    console.error("OTP send error:", err);
    res.status(500).json({ error: "Failed to send verification email. Please try again." });
  }
});

// POST /api/public/loyalty/verify-otp
// Verifies the OTP and returns the customer's loyalty points if correct.
router.post("/loyalty/verify-otp", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  try {
    const { phone, email, otp } = req.body;
    if (!phone || !email || !otp) { res.status(400).json({ error: "Phone, email and OTP are required" }); return; }

    const [verification] = await db
      .select()
      .from(loyaltyEmailVerificationsTable)
      .where(and(
        eq(loyaltyEmailVerificationsTable.phone, phone),
        eq(loyaltyEmailVerificationsTable.email, email),
        eq(loyaltyEmailVerificationsTable.verified, false)
      ))
      .limit(1);

    if (!verification) {
      res.status(400).json({ error: "No pending verification found. Please request a new code." });
      return;
    }

    if (new Date() > verification.expiresAt) {
      await db.delete(loyaltyEmailVerificationsTable).where(eq(loyaltyEmailVerificationsTable.id, verification.id));
      res.status(400).json({ error: "Verification code has expired. Please request a new one." });
      return;
    }

    if (verification.otp !== otp.trim()) {
      res.status(400).json({ error: "Incorrect verification code. Please try again." });
      return;
    }

    // Mark verified
    await db.update(loyaltyEmailVerificationsTable)
      .set({ verified: true })
      .where(eq(loyaltyEmailVerificationsTable.id, verification.id));

    // Return customer's loyalty info
    const [customer] = await db
      .select()
      .from(loyaltyCustomersTable)
      .where(eq(loyaltyCustomersTable.phone, phone))
      .limit(1);

    if (!customer) {
      res.status(404).json({ error: "Loyalty account not found" });
      return;
    }

    res.json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        totalPoints: customer.totalPoints,
      }
    });
  } catch (err) {
    console.error("OTP verify error:", err);
    res.status(500).json({ error: "Verification failed. Please try again." });
  }
});

// POST /api/public/loyalty/register
// New customer signs up from the QR page.
router.post("/loyalty/register", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  try {
    const { name, phone, email } = req.body;
    if (!name || !phone || !email) {
      res.status(400).json({ error: "Name, phone and email are all required" });
      return;
    }

    const [existingPhone] = await db
      .select()
      .from(loyaltyCustomersTable)
      .where(eq(loyaltyCustomersTable.phone, phone))
      .limit(1);

    if (existingPhone) {
      res.status(400).json({ error: "A loyalty account already exists for this phone number." });
      return;
    }

    const [existingEmail] = await db
      .select()
      .from(loyaltyCustomersTable)
      .where(eq(loyaltyCustomersTable.email, email))
      .limit(1);

    if (existingEmail) {
      res.status(400).json({ error: "A loyalty account already exists for this email address." });
      return;
    }

    const [customer] = await db
      .insert(loyaltyCustomersTable)
      .values({ name, phone, email })
      .returning();

    res.status(201).json({ success: true, customer: { id: customer.id, name: customer.name, phone: customer.phone, totalPoints: customer.totalPoints } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// POST /api/public/loyalty/redeem
// Applies the customer's loyalty discount to their most recent active order on this table.
router.post("/loyalty/redeem", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  try {
    const { sessionToken, loyaltyCustomerId, discountPercent, pointsToUse } = req.body;
    if (!sessionToken || !loyaltyCustomerId || !discountPercent || !pointsToUse) {
      res.status(400).json({ error: "sessionToken, loyaltyCustomerId, discountPercent and pointsToUse are required" });
      return;
    }

    const session = await resolveSession(sessionToken);
    if (!session) {
      res.status(401).json({ error: "Session expired. Please scan the QR code again." });
      return;
    }

    // Find the most recent active (unpaid) order for this table
    const [order] = await db
      .select()
      .from(ordersTable)
      .where(and(
        eq(ordersTable.tableId, session.tableId),
        eq(ordersTable.paymentStatus, "pending")
      ))
      .orderBy(desc(ordersTable.createdAt))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "No active order found for this table. Please place an order first." });
      return;
    }

    if (order.discountAmount && parseFloat(String(order.discountAmount)) > 0) {
      res.status(400).json({ error: "A discount has already been applied to this order." });
      return;
    }

    // Check customer has enough points
    const [customer] = await db
      .select()
      .from(loyaltyCustomersTable)
      .where(eq(loyaltyCustomersTable.id, loyaltyCustomerId))
      .limit(1);

    if (!customer) {
      res.status(404).json({ error: "Loyalty customer not found." });
      return;
    }

    if (customer.totalPoints < pointsToUse) {
      res.status(400).json({ error: "Insufficient points." });
      return;
    }

    // Apply discount to the order
    const baseAmount = parseFloat(String(order.totalAmount));
    const discountAmount = baseAmount * (discountPercent / 100);
    const newTotal = Math.max(0, baseAmount - discountAmount);

    await db.update(ordersTable).set({
      totalAmount: String(newTotal),
      discountAmount: String(discountAmount),
      loyaltyCustomerId: loyaltyCustomerId,
      notes: [order.notes, `Loyalty discount: ${discountPercent}% (${pointsToUse} points redeemed)`].filter(Boolean).join(" | "),
    }).where(eq(ordersTable.id, order.id));

    // Deduct points from customer
    await db.update(loyaltyCustomersTable).set({
      totalPoints: customer.totalPoints - pointsToUse,
    }).where(eq(loyaltyCustomersTable.id, loyaltyCustomerId));

    res.json({
      success: true,
      orderId: order.id,
      discountAmount: discountAmount.toFixed(2),
      newTotal: newTotal.toFixed(2),
      remainingPoints: customer.totalPoints - pointsToUse,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Redemption failed. Please try again." });
  }
});

export default router;