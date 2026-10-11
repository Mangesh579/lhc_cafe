import { Router } from "express";
import { db, menuItemsTable, menuCategoriesTable, ordersTable, orderItemsTable, cafeTablesTable, tableSessionsTable, recipesTable, inventoryItemsTable, inventoryLogsTable, bestsellerCacheTable, loyaltyEmailVerificationsTable, loyaltyCustomersTable, loyaltyRedemptionsTable, tableRequestsTable } from "@workspace/db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { randomBytes, randomInt } from "crypto";
import { publicOrderRateLimiter } from "../middlewares/rateLimit";
import { applyPrepWaste } from "../lib/prepWaste";
import { expandRecipeLines } from "../lib/ingredientUsage";
import { Resend } from "resend";
import type { Request, Response, NextFunction } from "express";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "noreply@example.com";

const router = Router();

const LOYALTY_TIERS = [
  { level: 1, pointsRequired: 100,  reward: "Free Classic Coffee (Espresso/Americano) or Bakery Item (Cookie/Croissant)" },
  { level: 2, pointsRequired: 250,  reward: "Free Premium Drink (Latte, Frappé, or Mocktail) + Free Extra Syrup/Topping" },
  { level: 3, pointsRequired: 450,  reward: "Café Break Combo — Any standard beverage + any pastry or slice of cake" },
  { level: 4, pointsRequired: 700,  reward: "Free Heavy Main Item — Sandwich, Burger, or Pasta (available when food menu launches)" },
  { level: 5, pointsRequired: 1000, reward: "VIP Platter + Customized LHC Café Mug to take home (Loop 2+: Free Coffee for a Month or Secret Tasting Session)" },
] as const;

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

// Requests arriving on the cafe's own LAN (customers scanning the QR while
// physically on-site) have a private IP address by definition — no public
// internet routing is even involved. This is a stronger guarantee than the
// old public-IP allowlist, and lets local customers work exactly the same
// way even if the internet connection itself is down.
function isPrivateLanIp(ip: string): boolean {
  const cleaned = ip.replace("::ffff:", "");
  return (
    cleaned.startsWith("192.168.") ||
    cleaned.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(cleaned) ||
    cleaned === "127.0.0.1" ||
    cleaned === "::1"
  );
}

function requireCafeWifi(req: Request, res: Response, next: NextFunction): void {
  const clientIp = getClientIp(req);

  // Always allow direct LAN traffic — this is the primary path once hosted locally.
  if (isPrivateLanIp(clientIp)) { next(); return; }

  // Fallback: legacy public-IP allowlist, still useful if ever hosted on a VPS again.
  if (ALLOWED_IPS.length > 0) {
    const isAllowed = ALLOWED_IPS.some(allowed => clientIp === allowed || clientIp.includes(allowed));
    if (isAllowed) { next(); return; }
  }

  res.status(403).json({ error: "Please connect to the cafe Wi-Fi to place an order." });
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

    res.json({ sessionToken, tableNumber: table.tableNumber, tableName: table.name });
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
  res.json({ valid: true, tableNumber: table?.tableNumber, tableName: table?.name });
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
          notes: orderItemsTable.notes,
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
      const recipes = await expandRecipeLines(item.menuItemId);
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
            reason: `QR Order #${order.id} (${table.name || `Table ${table.tableNumber}`})`,
            orderId: order.id,
          });
        }
      }
    }

    await applyPrepWaste(order.id, resolvedItems, `QR Order #${order.id} (${table.name || `Table ${table.tableNumber}`})`, "QR order");
    res.json({ success: true, orderId: order.id, totalAmount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to place order" });
  }
});

// POST /api/public/request
router.post("/request", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  try {
    const { sessionToken, requestType } = req.body;
    if (!["waiter", "bill"].includes(requestType)) { res.status(400).json({ error: "Invalid request type" }); return; }
    const session = await resolveSession(sessionToken);
    if (!session) { res.status(401).json({ error: "Session expired" }); return; }

    const COOLDOWN_MS = 5 * 60 * 1000;

    // Check the most recent request of this type for this table, regardless
    // of resolved status — enforces a real cooldown, not just "no duplicates
    // while pending" (which could be bypassed once staff resolved it).
    const [lastRequest] = await db.select().from(tableRequestsTable)
      .where(and(eq(tableRequestsTable.tableId, session.tableId), eq(tableRequestsTable.requestType, requestType)))
      .orderBy(desc(tableRequestsTable.createdAt))
      .limit(1);

    if (lastRequest) {
      const elapsed = Date.now() - new Date(lastRequest.createdAt).getTime();
      if (elapsed < COOLDOWN_MS) {
        const secondsLeft = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        const minutesLeft = Math.ceil(secondsLeft / 60);
        res.status(429).json({ error: `Please wait ${minutesLeft} more minute${minutesLeft === 1 ? "" : "s"} before requesting again.` });
        return;
      }
    }

    await db.insert(tableRequestsTable).values({ tableId: session.tableId, requestType });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send request" });
  }
});

// POST /api/public/loyalty/request-otp
// Sends a 6-digit OTP to the customer's email for loyalty verification.
// Rate limited to prevent spam — max 30/min by the existing publicOrderRateLimiter.
router.post("/loyalty/request-otp", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  try {
    const { phone, email } = req.body;
    if (!phone || !email) { res.status(400).json({ error: "Phone and email are required" }); return; }

    const [customer] = await db
      .select()
      .from(loyaltyCustomersTable)
      .where(eq(loyaltyCustomersTable.phone, phone))
      .limit(1);

    if (!customer) {
      res.status(404).json({ error: "No loyalty account found for this phone number. Please ask staff to register you." });
      return;
    }

    const RESET_WINDOW_MS = 60 * 60 * 1000; // 1 hour — if last request was over 1hr ago, reset count

    // Find existing record for this phone+email pair (verified or not)
    const [existing] = await db
      .select()
      .from(loyaltyEmailVerificationsTable)
      .where(and(
        eq(loyaltyEmailVerificationsTable.phone, phone),
        eq(loyaltyEmailVerificationsTable.email, email)
      ))
      .limit(1);

    let requestCount = 1;

    if (existing) {
      const timeSinceLastRequest = Date.now() - new Date(existing.lastRequestedAt).getTime();

      if (timeSinceLastRequest < RESET_WINDOW_MS) {
        // Within the 1-hour window — check cooldown
        // If previous OTP is still unexpired and unverified, enforce cooldown
        if (!existing.verified && new Date() < existing.expiresAt) {
          const minutesLeft = Math.ceil((existing.expiresAt.getTime() - Date.now()) / 60000);
          res.status(429).json({
            error: `A verification code was already sent. Please wait ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} before requesting a new one.`
          });
          return;
        }

        // Previous OTP expired or was verified — apply escalating cooldown based on request count
        requestCount = existing.requestCount + 1;
        const cooldownMinutes = (requestCount - 1) * 10; // 0, 10, 20, 30... minutes

        if (cooldownMinutes > 0) {
          const cooldownEndsAt = new Date(existing.lastRequestedAt).getTime() + cooldownMinutes * 60 * 1000;
          const msLeft = cooldownEndsAt - Date.now();
          if (msLeft > 0) {
            const minutesLeft = Math.ceil(msLeft / 60000);
            res.status(429).json({
              error: `Too many verification requests. Please wait ${minutesLeft} more minute${minutesLeft === 1 ? "" : "s"} before requesting a new code.`
            });
            return;
          }
        }
      } else {
        // Over 1 hour since last request — reset the count
        requestCount = 1;
      }

      // Delete old record before inserting fresh one
      await db.delete(loyaltyEmailVerificationsTable)
        .where(eq(loyaltyEmailVerificationsTable.id, existing.id));
    }

    // Generate new OTP
    const otp = String(randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.insert(loyaltyEmailVerificationsTable).values({
      phone,
      email,
      otp,
      expiresAt,
      verified: false,
      requestCount,
      lastRequestedAt: new Date(),
    });

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
        loopNumber: customer.loopNumber ?? 1,
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

    res.status(201).json({ success: true, customer: { id: customer.id, name: customer.name, phone: customer.phone, totalPoints: customer.totalPoints, loopNumber: 1 } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// POST /api/public/loyalty/redeem
router.post("/loyalty/redeem", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  try {
    const { sessionToken, loyaltyCustomerId, level } = req.body;
    if (!sessionToken || !loyaltyCustomerId || !level) {
      res.status(400).json({ error: "sessionToken, loyaltyCustomerId and level are required" });
      return;
    }

    const session = await resolveSession(sessionToken);
    if (!session) {
      res.status(401).json({ error: "Session expired. Please scan the QR code again." });
      return;
    }

    const tier = LOYALTY_TIERS.find(t => t.level === level);
    if (!tier) { res.status(400).json({ error: "Invalid reward level" }); return; }

    const [customer] = await db
      .select()
      .from(loyaltyCustomersTable)
      .where(eq(loyaltyCustomersTable.id, loyaltyCustomerId))
      .limit(1);

    if (!customer) { res.status(404).json({ error: "Loyalty customer not found" }); return; }

    // Check customer has enough points for this tier
    if (customer.totalPoints < tier.pointsRequired) {
      res.status(400).json({ error: `You need ${tier.pointsRequired} points to unlock this reward. You have ${customer.totalPoints}.` });
      return;
    }

    // Check this level hasn't already been redeemed in the current cycle
    const [existingRedemption] = await db
      .select()
      .from(loyaltyRedemptionsTable)
      .where(and(
        eq(loyaltyRedemptionsTable.loyaltyCustomerId, loyaltyCustomerId),
        eq(loyaltyRedemptionsTable.level, level),
        eq(loyaltyRedemptionsTable.loopNumber, customer.loopNumber)
      ))
      .limit(1);

    if (existingRedemption) {
      res.status(400).json({ error: "You have already redeemed this reward in the current cycle." });
      return;
    }

    // Find the most recent active unpaid order for this table
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

    // Build the reward note
    const isLoop2Plus = customer.loopNumber >= 2 && level === 5;
    const rewardNote = isLoop2Plus
      ? `🏆 LEGACY REWARD (Loop ${customer.loopNumber}): Free Coffee for a Month (1/day) OR Secret Off-Menu Tasting Session for 2 — ask your server to apply`
      : `🎁 Loyalty Reward Level ${level}: ${tier.reward} — please ask your server`;

    // Append to order notes
    const updatedNotes = [order.notes, rewardNote].filter(Boolean).join(" | ");
    await db.update(ordersTable)
      .set({
        notes: updatedNotes,
        loyaltyCustomerId: loyaltyCustomerId,
      })
      .where(eq(ordersTable.id, order.id));

    // Record the redemption
    const [redemption] = await db.insert(loyaltyRedemptionsTable).values({
      loyaltyCustomerId,
      level,
      loopNumber: customer.loopNumber,
      orderId: order.id,
    }).returning();

    // If Level 5: deduct 1000 points and increment loop
    let updatedCustomer = customer;
    if (level === 5) {
      const newPoints = Math.max(0, customer.totalPoints - 1000);
      const [updated] = await db.update(loyaltyCustomersTable)
        .set({
          totalPoints: newPoints,
          loopNumber: customer.loopNumber + 1,
        })
        .where(eq(loyaltyCustomersTable.id, loyaltyCustomerId))
        .returning();
      updatedCustomer = updated;
    }

    res.json({
      success: true,
      orderId: order.id,
      level,
      reward: rewardNote,
      remainingPoints: updatedCustomer.totalPoints,
      loopNumber: updatedCustomer.loopNumber,
      cycleComplete: level === 5,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Redemption failed. Please try again." });
  }
});

// GET /api/public/loyalty/redemptions?loyaltyCustomerId=x&loopNumber=x
// Returns which levels have already been redeemed in the current cycle
router.get("/loyalty/redemptions", requireCafeWifi, publicOrderRateLimiter, async (req, res): Promise<void> => {
  try {
    const { loyaltyCustomerId, loopNumber } = req.query;
    if (!loyaltyCustomerId || !loopNumber) {
      res.status(400).json({ error: "loyaltyCustomerId and loopNumber required" });
      return;
    }
    const redemptions = await db
      .select()
      .from(loyaltyRedemptionsTable)
      .where(and(
        eq(loyaltyRedemptionsTable.loyaltyCustomerId, parseInt(loyaltyCustomerId as string)),
        eq(loyaltyRedemptionsTable.loopNumber, parseInt(loopNumber as string))
      ));
    res.json(redemptions.map(r => r.level));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch redemptions" });
  }
});

export default router;