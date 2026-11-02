import { Router } from "express";
import { db, ordersTable, orderItemsTable, menuItemsTable, inventoryItemsTable, inventoryLogsTable, recipesTable, loyaltyCustomersTable, cafeTablesTable, tableSessionsTable, loyaltyRedemptionsTable, orderCorrectionsTable, billPrintLogsTable, invoiceSequencesTable, wasteLogsTable, orderKotCancellationsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { authenticate, requireAdmin } from "../middlewares/auth";
import { applyPrepWaste } from "../lib/prepWaste";
import { expandRecipeLines } from "../lib/ingredientUsage";
const NepaliDateLib = require("nepali-date-converter");
const NepaliDate: any = NepaliDateLib.default ?? NepaliDateLib;

const router = Router();

// Nepal's fiscal year runs Shrawan 1 (~mid-July) to Ashadh end (~mid-July next year).
// BS months: 1=Baisakh...4=Shrawan...12=Chaitra. FY label format: "2082/83".
async function getNextInvoiceNumber(): Promise<string> {
  console.log("NepaliDate diagnostic:", typeof NepaliDate, typeof NepaliDateLib, Object.keys(NepaliDateLib ?? {}), Object.keys(NepaliDateLib?.default ?? {}));
  const nowBS = new NepaliDate(new Date());
  const bsYear = nowBS.getYear();
  const bsMonth = nowBS.getMonth() + 1; // 1-indexed

  // If we're in Baisakh–Ashadh (months 1-3), we're still in the fiscal year that started last Shrawan.
  const fiscalStartYear = bsMonth >= 4 ? bsYear : bsYear - 1;
  const fiscalLabel = `${fiscalStartYear}/${String((fiscalStartYear + 1) % 100).padStart(2, "0")}`;

  const [existing] = await db.select().from(invoiceSequencesTable).where(eq(invoiceSequencesTable.fiscalYear, fiscalLabel));

  let nextNum: number;
  if (existing) {
    nextNum = existing.lastNumber + 1;
    await db.update(invoiceSequencesTable).set({ lastNumber: nextNum }).where(eq(invoiceSequencesTable.fiscalYear, fiscalLabel));
  } else {
    nextNum = 1;
    await db.insert(invoiceSequencesTable).values({ fiscalYear: fiscalLabel, lastNumber: 1 });
  }

  return `${fiscalLabel}-${String(nextNum).padStart(5, "0")}`;
}

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

async function getOrderWithItems(orderId: number) {
  const [order] = await db
    .select({
      id: ordersTable.id,
      tableId: ordersTable.tableId,
      tableNumber: cafeTablesTable.tableNumber,
      tableName: cafeTablesTable.name,
      totalAmount: ordersTable.totalAmount,
      paymentMethod: ordersTable.paymentMethod,
      paymentStatus: ordersTable.paymentStatus,
      orderStatus: ordersTable.orderStatus,
      loyaltyCustomerId: ordersTable.loyaltyCustomerId,
      loyaltyCustomerName: loyaltyCustomersTable.name,
      loyaltyCustomerPhone: loyaltyCustomersTable.phone,
      loyaltyCustomerEmail: loyaltyCustomersTable.email,
      loyaltyPointsEarned: ordersTable.loyaltyPointsEarned,
      discountAmount: ordersTable.discountAmount,
      billType: ordersTable.billType,
      vatAmount: ordersTable.vatAmount,
      otherPartyName: ordersTable.otherPartyName,
      otherPartyPan: ordersTable.otherPartyPan,
      nonTaxableAmount: ordersTable.nonTaxableAmount,
      invoiceNumber: ordersTable.invoiceNumber,
      isNc: ordersTable.isNc,
      ncPersonName: ordersTable.ncPersonName,
      ncReason: ordersTable.ncReason,
      createdBy: ordersTable.createdBy,
      notes: ordersTable.notes,
      backdatedAt: ordersTable.backdatedAt,
      createdAt: ordersTable.createdAt,
      updatedAt: ordersTable.updatedAt,
    })
    .from(ordersTable)
    .leftJoin(cafeTablesTable, eq(ordersTable.tableId, cafeTablesTable.id))
    .leftJoin(loyaltyCustomersTable, eq(ordersTable.loyaltyCustomerId, loyaltyCustomersTable.id))
    .where(eq(ordersTable.id, orderId));

  if (!order) return null;

  const items = await db
    .select({
      id: orderItemsTable.id,
      menuItemId: orderItemsTable.menuItemId,
      menuItemName: menuItemsTable.name,
      quantity: orderItemsTable.quantity,
      unitPrice: orderItemsTable.unitPrice,
      subtotal: orderItemsTable.subtotal,
      notes: orderItemsTable.notes,
      kotNumber: orderItemsTable.kotNumber,
      kotAt: orderItemsTable.kotAt,
      kotNote: orderItemsTable.kotNote,
      kotBy: orderItemsTable.kotBy,
    })
    .from(orderItemsTable)
    .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
    .where(eq(orderItemsTable.orderId, orderId));

  const corrections = await db.select().from(orderCorrectionsTable).where(eq(orderCorrectionsTable.originalOrderId, orderId)).orderBy(desc(orderCorrectionsTable.createdAt));
  const kotCancellations = await db.select().from(orderKotCancellationsTable).where(eq(orderKotCancellationsTable.orderId, orderId)).orderBy(orderKotCancellationsTable.cancelledAt);
  return { ...order, items, corrections, kotCancellations };
}

router.get("/orders", authenticate, async (req, res): Promise<void> => {
  const { status, date, paymentMethod } = req.query;
  const conditions = [];
  if (status) conditions.push(eq(ordersTable.orderStatus, status as string));
  if (paymentMethod) conditions.push(eq(ordersTable.paymentMethod, paymentMethod as string));
  if (date) {
    const startDate = new Date(date as string); startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date as string); endDate.setHours(23, 59, 59, 999);
    conditions.push(gte(ordersTable.createdAt, startDate));
    conditions.push(lte(ordersTable.createdAt, endDate));
  }

  const ordersList = await db
    .select({
      id: ordersTable.id,
      tableId: ordersTable.tableId,
      tableNumber: cafeTablesTable.tableNumber,
      tableName: cafeTablesTable.name,
      totalAmount: ordersTable.totalAmount,
      paymentMethod: ordersTable.paymentMethod,
      paymentStatus: ordersTable.paymentStatus,
      orderStatus: ordersTable.orderStatus,
      loyaltyCustomerId: ordersTable.loyaltyCustomerId,
      loyaltyCustomerName: loyaltyCustomersTable.name,
      loyaltyCustomerPhone: loyaltyCustomersTable.phone,
      loyaltyCustomerEmail: loyaltyCustomersTable.email,
      loyaltyPointsEarned: ordersTable.loyaltyPointsEarned,
      discountAmount: ordersTable.discountAmount,
      billType: ordersTable.billType,
      vatAmount: ordersTable.vatAmount,
      otherPartyName: ordersTable.otherPartyName,
      otherPartyPan: ordersTable.otherPartyPan,
      nonTaxableAmount: ordersTable.nonTaxableAmount,
      invoiceNumber: ordersTable.invoiceNumber,
      isNc: ordersTable.isNc,
      ncPersonName: ordersTable.ncPersonName,
      ncReason: ordersTable.ncReason,
      createdBy: ordersTable.createdBy,
      notes: ordersTable.notes,
      backdatedAt: ordersTable.backdatedAt,
      createdAt: ordersTable.createdAt,
      updatedAt: ordersTable.updatedAt,
    })
    .from(ordersTable)
    .leftJoin(cafeTablesTable, eq(ordersTable.tableId, cafeTablesTable.id))
    .leftJoin(loyaltyCustomersTable, eq(ordersTable.loyaltyCustomerId, loyaltyCustomersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sql`COALESCE(${ordersTable.backdatedAt}, ${ordersTable.createdAt})`));

  const ordersWithItems = await Promise.all(
    ordersList.map(async (order) => {
      const items = await db
        .select({
          id: orderItemsTable.id,
          menuItemId: orderItemsTable.menuItemId,
          menuItemName: menuItemsTable.name,
          quantity: orderItemsTable.quantity,
          unitPrice: orderItemsTable.unitPrice,
          subtotal: orderItemsTable.subtotal,
          notes: orderItemsTable.notes,
          kotNumber: orderItemsTable.kotNumber,
          kotAt: orderItemsTable.kotAt,
          kotNote: orderItemsTable.kotNote,
          kotBy: orderItemsTable.kotBy,
        })
        .from(orderItemsTable)
        .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
        .where(eq(orderItemsTable.orderId, order.id));

      const corrections = await db.select().from(orderCorrectionsTable).where(eq(orderCorrectionsTable.originalOrderId, order.id)).orderBy(desc(orderCorrectionsTable.createdAt));
      const kotCancellations = await db.select().from(orderKotCancellationsTable).where(eq(orderKotCancellationsTable.orderId, order.id)).orderBy(orderKotCancellationsTable.cancelledAt);

      return { ...order, items, corrections, kotCancellations };
    })
  );

  res.json(ordersWithItems);
});

router.post("/orders", authenticate, async (req, res): Promise<void> => {
  const { tableId, paymentMethod, loyaltyCustomerId, notes, items, discountAmount, backdatedAt, isNc, ncPersonName, ncReason } = req.body;
  if (!items?.length) { res.status(400).json({ error: "Order must have at least one item" }); return; }
  if (isNc && !ncPersonName?.trim()) { res.status(400).json({ error: "Person name is required for Not Chargeable orders" }); return; }

  let totalAmount = 0;
  const resolvedItems: Array<{ menuItemId: number; quantity: number; unitPrice: number; subtotal: number; notes?: string }> = [];
  for (const item of items) {
    const [menuItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, item.menuItemId));
    if (!menuItem) { res.status(400).json({ error: `Menu item ${item.menuItemId} not found` }); return; }
    const unitPrice = parseFloat(String(menuItem.price));
    const subtotal = unitPrice * item.quantity;
    totalAmount += subtotal;
    resolvedItems.push({ menuItemId: item.menuItemId, quantity: item.quantity, unitPrice, subtotal, notes: item.notes });
  }

  const discountValue = discountAmount ? parseFloat(String(discountAmount)) : 0;
  const finalTotal = Math.max(0, totalAmount - discountValue);

  // NC (Not Chargeable) orders are marked paid immediately — no payment is
  // ever collected — but still get a real invoice number for the audit
  // trail, since it's a legitimate bill (hotel comp / owner use), just at
  // zero collected revenue.
  const ncInvoiceNumber = isNc ? await getNextInvoiceNumber() : undefined;

  // ── One bill per table: join the table's open unpaid bill as a new KOT ──
  let openBill: typeof ordersTable.$inferSelect | undefined;
  if (tableId && !isNc && !backdatedAt) {
    [openBill] = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.tableId, tableId), eq(ordersTable.paymentStatus, "pending"), eq(ordersTable.isNc, false), sql`${ordersTable.orderStatus} <> 'cancelled'`))
      .orderBy(desc(ordersTable.createdAt)).limit(1);
  }
  let kotNo = 1;
  if (openBill) {
    const [m] = await db.select({ maxKot: sql<number>`COALESCE(MAX(${orderItemsTable.kotNumber}), 0)` }).from(orderItemsTable).where(eq(orderItemsTable.orderId, openBill.id));
    const [c] = await db.select({ maxKot: sql<number>`COALESCE(MAX(${orderKotCancellationsTable.kotNumber}), 0)` }).from(orderKotCancellationsTable).where(eq(orderKotCancellationsTable.orderId, openBill.id));
    kotNo = Math.max(Number(m?.maxKot ?? 0), Number(c?.maxKot ?? 0)) + 1;
  }

  const [order] = openBill ? await db.update(ordersTable).set({
    totalAmount: String(parseFloat(String(openBill.totalAmount)) + finalTotal),
    discountAmount: String(parseFloat(String(openBill.discountAmount ?? 0)) + discountValue),
    notes: [openBill.notes, notes].filter(Boolean).join(" | ") || null,
    orderStatus: "pending",
    loyaltyCustomerId: openBill.loyaltyCustomerId ?? loyaltyCustomerId ?? null,
  }).where(eq(ordersTable.id, openBill.id)).returning() : await db.insert(ordersTable).values({
    tableId: tableId ?? null,
    totalAmount: String(finalTotal),
    paymentMethod: isNc ? "nc" : (paymentMethod ?? "cash"),
    paymentStatus: isNc ? "paid" : "pending",
    orderStatus: "pending",
    loyaltyCustomerId: loyaltyCustomerId ?? null,
    notes: notes ?? null,
    discountAmount: String(discountValue),
    createdBy: (req as any).user?.username ?? null,
    backdatedAt: backdatedAt ? new Date(backdatedAt) : null,
    isNc: !!isNc,
    ncPersonName: isNc ? ncPersonName.trim() : null,
    ncReason: isNc ? (ncReason?.trim() || null) : null,
    invoiceNumber: ncInvoiceNumber ?? null,
  }).returning();

  for (const item of resolvedItems) {
    await db.insert(orderItemsTable).values({ orderId: order.id, menuItemId: item.menuItemId, quantity: item.quantity, unitPrice: String(item.unitPrice), subtotal: String(item.subtotal), notes: item.notes ?? null, kotNumber: kotNo, kotAt: new Date(), kotNote: notes ?? null, kotBy: (req as any).user?.username ?? null });
  }

  for (const item of resolvedItems) {
    const recipes = await expandRecipeLines(item.menuItemId);
    for (const recipe of recipes) {
      const needed = parseFloat(String(recipe.quantityRequired)) * item.quantity;
      const [inv] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, recipe.inventoryItemId));
      if (inv) {
        const stockBefore = parseFloat(String(inv.currentStock));
        const stockAfter = stockBefore - needed;
        await db.update(inventoryItemsTable).set({ currentStock: String(stockAfter) }).where(eq(inventoryItemsTable.id, inv.id));
        await db.insert(inventoryLogsTable).values({ inventoryItemId: inv.id, changeAmount: String(-needed), stockBefore: String(stockBefore), stockAfter: String(stockAfter), reason: kotNo > 1 ? `Order #${order.id} (KOT ${kotNo})` : `Order #${order.id}`, orderId: order.id, menuItemId: item.menuItemId });
      }
    }
  }

  await applyPrepWaste(order.id, resolvedItems, kotNo > 1 ? `Order #${order.id} (KOT ${kotNo})` : `Order #${order.id}`, (req as any).user?.username ?? "system", kotNo);
  const result = await getOrderWithItems(order.id);
  res.status(201).json(result ? { ...result, kotNumber: kotNo, merged: !!openBill } : result);
});

router.get("/orders/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const order = await getOrderWithItems(id);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(order);
});

router.patch("/orders/:id/status", authenticate, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { status } = req.body;
  if (!status) { res.status(400).json({ error: "status required" }); return; }

  if (status === "completed") {
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    if (order && order.paymentStatus === "pending") {
      res.status(400).json({ error: "Cannot complete order: payment is still pending. Please process payment first." });
      return;
    }
  }

  await db.update(ordersTable).set({ orderStatus: status }).where(eq(ordersTable.id, id));
  const result = await getOrderWithItems(id);
  if (!result) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(result);
});

router.patch("/orders/:id/payment", authenticate, async (req, res): Promise<void> => {
  try {
  const id = parseId(req.params.id);
  const { paymentMethod, paymentStatus, loyaltyCustomerId, vatAmount, billType, finalTotal, otherPartyName, otherPartyPan, nonTaxableAmount, isNc, ncPersonName, ncReason } = req.body;
  const updateData: Record<string, unknown> = {};
  if (isNc !== undefined) updateData.isNc = isNc;
  if (ncPersonName !== undefined) updateData.ncPersonName = ncPersonName || null;
  if (ncReason !== undefined) updateData.ncReason = ncReason || null;
  if (paymentMethod) updateData.paymentMethod = paymentMethod;
  if (paymentStatus) updateData.paymentStatus = paymentStatus;
  if (billType) updateData.billType = billType;
  if (vatAmount !== undefined) updateData.vatAmount = String(vatAmount);
  if (finalTotal !== undefined) updateData.totalAmount = String(finalTotal);
  if (otherPartyName !== undefined) updateData.otherPartyName = otherPartyName || null;
  if (otherPartyPan !== undefined) updateData.otherPartyPan = otherPartyPan || null;
  if (nonTaxableAmount !== undefined) updateData.nonTaxableAmount = String(nonTaxableAmount);

  if (paymentStatus === "paid") {
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    if (order) {
      // Only assign an invoice number once — reprints/edits must never get a new one
      if (!order.invoiceNumber) {
        updateData.invoiceNumber = await getNextInvoiceNumber();
      }
      const customerId = loyaltyCustomerId ?? order.loyaltyCustomerId;
      if (customerId) {
        const points = Math.floor(parseFloat(String(order.totalAmount)) / 10);
        updateData.loyaltyPointsEarned = points;
        updateData.loyaltyCustomerId = customerId;
        const [customer] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, customerId));
        if (customer) {
          await db.update(loyaltyCustomersTable).set({
            totalPoints: customer.totalPoints + points,
            totalOrders: customer.totalOrders + 1,
            totalSpent: String(parseFloat(String(customer.totalSpent)) + parseFloat(String(order.totalAmount))),
          }).where(eq(loyaltyCustomersTable.id, customerId));
        }
      }

      // Clear table session and mark table unoccupied so next guest gets a fresh start
      if (order.tableId) {
        await db.delete(tableSessionsTable).where(eq(tableSessionsTable.tableId, order.tableId));
        // await db.update(cafeTablesTable).set({ isOccupied: false }).where(eq(cafeTablesTable.id, order.tableId));
      }
    }
  }

  await db.update(ordersTable).set(updateData).where(eq(ordersTable.id, id));
  const result = await getOrderWithItems(id);
  if (!result) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(result);
  } catch (err: any) {
    console.error("PAYMENT ROUTE ERROR:", err?.message, err?.stack);
    res.status(500).json({ error: "Failed to process payment", detail: err?.message });
  }
});

router.patch("/orders/:id/discount", authenticate, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { discountPercent, comment } = req.body;
  if (discountPercent === undefined) { res.status(400).json({ error: "discountPercent required" }); return; }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.paymentStatus === "paid") {
    res.status(400).json({ error: "This order is already paid. Use a correction instead of editing it directly." });
    return;
  }

  const base = parseFloat(String(order.totalAmount));
  const discountAmount = base * (parseFloat(String(discountPercent)) / 100);
  const newTotal = base - discountAmount;
  const noteText = comment?.trim() ? `Staff discount: ${discountPercent}% — ${comment.trim()}` : `Staff discount: ${discountPercent}%`;

  await db.update(ordersTable).set({
    discountAmount: String(discountAmount),
    totalAmount: String(newTotal),
    notes: [order.notes, noteText].filter(Boolean).join(" | "),
  }).where(eq(ordersTable.id, id));

  const result = await getOrderWithItems(id);
  res.json(result);
});

router.patch("/orders/:id/cancel", authenticate, requireAdmin, async (req: any, res): Promise<void> => {
  const id = parseId(req.params.id);

  // If this order was already paid, cancelling it is effectively a full
  // refund — record it as a credit correction so the audit trail shows
  // exactly what was reversed, when, and by whom. This never touches the
  // original order row itself.
  const [orderBeforeCancel] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (orderBeforeCancel?.paymentStatus === "paid") {
    await db.insert(orderCorrectionsTable).values({
      originalOrderId: id,
      correctionType: "credit",
      amount: orderBeforeCancel.totalAmount,
      reason: "Order cancelled after payment — full refund",
      createdBy: req.user?.username ?? "admin",
    });
  }

  // Restore inventory before cancelling
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));
  for (const item of items) {
    const recipes = await expandRecipeLines(item.menuItemId);
    for (const recipe of recipes) {
      const restore = (parseFloat(String(recipe.quantityRequired)) + parseFloat(String((recipe as any).wasteQuantity ?? 0))) * item.quantity;
      const [inv] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, recipe.inventoryItemId));
      if (inv) {
        const stockBefore = parseFloat(String(inv.currentStock));
        const stockAfter = stockBefore + restore;
        await db.update(inventoryItemsTable).set({ currentStock: String(stockAfter) }).where(eq(inventoryItemsTable.id, inv.id));
        await db.insert(inventoryLogsTable).values({
          inventoryItemId: inv.id,
          changeAmount: String(restore),
          stockBefore: String(stockBefore),
          stockAfter: String(stockAfter),
          reason: `Order #${id} cancelled — stock restored`,
          menuItemId: item.menuItemId,
          orderId: id,
        });
      }
    }
  }

  // Prep-waste entries for a cancelled order never actually happened — remove them.
  // The Stock Log keeps the full trail of the deduction and the restoration.
  await db.delete(wasteLogsTable).where(eq(wasteLogsTable.orderId, id));

  // If this order had loyalty redemptions, delete them so levels can be redeemed again
  // Also reverse Level 5 point deduction if it was applied on this order
  const level5Redemption = await db
    .select()
    .from(loyaltyRedemptionsTable)
    .where(and(
      eq(loyaltyRedemptionsTable.orderId, id),
      eq(loyaltyRedemptionsTable.level, 5)
    ))
    .limit(1);

  if (level5Redemption.length > 0) {
    const r = level5Redemption[0];
    // Get the order to find the customer
    const [cancelledOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    if (cancelledOrder?.loyaltyCustomerId) {
      const [cust] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, cancelledOrder.loyaltyCustomerId));
      if (cust) {
        // Reverse the loop increment and restore 1000 points
        await db.update(loyaltyCustomersTable).set({
          totalPoints: cust.totalPoints + 1000,
          loopNumber: Math.max(1, cust.loopNumber - 1),
        }).where(eq(loyaltyCustomersTable.id, cust.id));
      }
    }
  }

  // Delete all redemptions tied to this order
  await db.delete(loyaltyRedemptionsTable).where(eq(loyaltyRedemptionsTable.orderId, id));

  await db.update(ordersTable).set({ orderStatus: "cancelled", paymentStatus: "cancelled" }).where(eq(ordersTable.id, id));
  const result = await getOrderWithItems(id);
  if (!result) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(result);
});

// ── Cancel one KOT (admin, unpaid bills only) ──
router.post("/orders/:id/kots/:kot/cancel", authenticate, requireAdmin, async (req: any, res): Promise<void> => {
  const id = parseId(req.params.id);
  const kot = parseInt(Array.isArray(req.params.kot) ? req.params.kot[0] : req.params.kot, 10);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.paymentStatus !== "pending") { res.status(400).json({ error: "Only unpaid bills can have a KOT cancelled. Use a correction for paid orders." }); return; }

  const allItems = await db
    .select({ id: orderItemsTable.id, menuItemId: orderItemsTable.menuItemId, menuItemName: menuItemsTable.name, quantity: orderItemsTable.quantity, subtotal: orderItemsTable.subtotal, kotNumber: orderItemsTable.kotNumber })
    .from(orderItemsTable)
    .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
    .where(eq(orderItemsTable.orderId, id));
  const kotItems = allItems.filter(i => (i.kotNumber ?? 1) === kot);
  if (kotItems.length === 0) { res.status(404).json({ error: "That KOT was not found on this bill." }); return; }
  if (!allItems.some(i => (i.kotNumber ?? 1) !== kot)) { res.status(400).json({ error: "This is the only KOT on the bill. Cancel the whole order instead." }); return; }

  const admin = req.user?.username ?? "admin";
  const kotAmount = kotItems.reduce((s, i) => s + parseFloat(String(i.subtotal)), 0);

  await db.transaction(async (tx) => {
    for (const item of kotItems) {
      const lines = await expandRecipeLines(item.menuItemId);
      for (const line of lines) {
        const restore = (line.quantityRequired + line.wasteQuantity) * item.quantity;
        if (!(restore > 0)) continue;
        const [inv] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, line.inventoryItemId));
        if (!inv) continue;
        const before = parseFloat(String(inv.currentStock));
        const after = before + restore;
        await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, inv.id));
        await tx.insert(inventoryLogsTable).values({
          inventoryItemId: inv.id, changeAmount: String(restore), stockBefore: String(before), stockAfter: String(after),
          reason: `Order #${id} · KOT ${kot} cancelled — stock restored`, orderId: id, menuItemId: item.menuItemId, changedBy: admin,
        });
      }
    }
    await tx.delete(wasteLogsTable).where(and(eq(wasteLogsTable.orderId, id), eq(wasteLogsTable.kotNumber, kot)));
    await tx.delete(orderItemsTable).where(and(eq(orderItemsTable.orderId, id), eq(orderItemsTable.kotNumber, kot)));
    await tx.insert(orderKotCancellationsTable).values({
      orderId: id, kotNumber: kot,
      itemsText: kotItems.map(i => `${i.quantity}× ${i.menuItemName}`).join(", "),
      amount: String(kotAmount), reason: reason || null, cancelledBy: admin,
    });
    await tx.update(ordersTable).set({ totalAmount: String(Math.max(0, parseFloat(String(order.totalAmount)) - kotAmount)) }).where(eq(ordersTable.id, id));
  });

  const result = await getOrderWithItems(id);
  res.json(result);
});

// ── Change an unpaid order's table (merges into the new table's open bill if it has one) ──
router.patch("/orders/:id/table", authenticate, async (req: any, res): Promise<void> => {
  const id = parseId(req.params.id);
  const raw = req.body?.tableId;
  const newTableId: number | null = raw === null || raw === undefined || raw === "" ? null : parseInt(String(raw), 10);
  if (newTableId !== null && Number.isNaN(newTableId)) { res.status(400).json({ error: "Invalid table" }); return; }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.paymentStatus !== "pending") { res.status(400).json({ error: "Only unpaid orders can be moved to another table." }); return; }
  if ((order.tableId ?? null) === newTableId) { res.status(400).json({ error: "The order is already on that table." }); return; }
  if (newTableId !== null) {
    const [table] = await db.select().from(cafeTablesTable).where(eq(cafeTablesTable.id, newTableId));
    if (!table) { res.status(404).json({ error: "Table not found" }); return; }
    if (!table.isOccupied) { res.status(400).json({ error: "That table is not open. Open it first." }); return; }
  }

  const username = req.user?.username ?? "staff";
  let mergedInto = null as number | null;

  await db.transaction(async (tx) => {
    const target = newTableId === null ? undefined : (await tx.select().from(ordersTable)
      .where(and(eq(ordersTable.tableId, newTableId), eq(ordersTable.paymentStatus, "pending"), eq(ordersTable.isNc, false), sql`${ordersTable.orderStatus} <> 'cancelled'`, sql`${ordersTable.id} <> ${id}`))
      .orderBy(desc(ordersTable.createdAt)).limit(1))[0];

    if (!target) {
      await tx.update(ordersTable).set({ tableId: newTableId }).where(eq(ordersTable.id, id));
      return;
    }

    mergedInto = target.id;
    const [mk] = await tx.select({ m: sql<number>`COALESCE(MAX(${orderItemsTable.kotNumber}), 0)` }).from(orderItemsTable).where(eq(orderItemsTable.orderId, target.id));
    const [ck] = await tx.select({ m: sql<number>`COALESCE(MAX(${orderKotCancellationsTable.kotNumber}), 0)` }).from(orderKotCancellationsTable).where(eq(orderKotCancellationsTable.orderId, target.id));
    const offset = Math.max(Number(mk?.m ?? 0), Number(ck?.m ?? 0));

    const srcItems = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));
    for (const it of srcItems) {
      await tx.update(orderItemsTable).set({
        orderId: target.id,
        kotNumber: offset + (it.kotNumber ?? 1),
        kotAt: it.kotAt ?? order.createdAt,
        kotNote: it.kotNote ?? ((it.kotNumber ?? 1) === 1 ? order.notes : null),
        kotBy: it.kotBy ?? order.createdBy,
      }).where(eq(orderItemsTable.id, it.id));
    }
    const srcWaste = await tx.select().from(wasteLogsTable).where(eq(wasteLogsTable.orderId, id));
    for (const w of srcWaste) {
      await tx.update(wasteLogsTable).set({ orderId: target.id, kotNumber: offset + (w.kotNumber ?? 1) }).where(eq(wasteLogsTable.id, w.id));
    }
    const srcCancels = await tx.select().from(orderKotCancellationsTable).where(eq(orderKotCancellationsTable.orderId, id));
    for (const c of srcCancels) {
      await tx.update(orderKotCancellationsTable).set({ orderId: target.id, kotNumber: offset + c.kotNumber }).where(eq(orderKotCancellationsTable.id, c.id));
    }
    await tx.update(loyaltyRedemptionsTable).set({ orderId: target.id }).where(eq(loyaltyRedemptionsTable.orderId, id));

    await tx.update(ordersTable).set({
      totalAmount: String(parseFloat(String(target.totalAmount)) + parseFloat(String(order.totalAmount))),
      discountAmount: String(parseFloat(String(target.discountAmount ?? 0)) + parseFloat(String(order.discountAmount ?? 0))),
      notes: [target.notes, order.notes].filter(Boolean).join(" | ") || null,
      orderStatus: "pending",
      loyaltyCustomerId: target.loyaltyCustomerId ?? order.loyaltyCustomerId ?? null,
    }).where(eq(ordersTable.id, target.id));
    await tx.update(ordersTable).set({
      orderStatus: "cancelled", paymentStatus: "cancelled", totalAmount: "0", discountAmount: "0",
      notes: [order.notes, `Merged into order #${target.id} (table changed by ${username})`].filter(Boolean).join(" | "),
    }).where(eq(ordersTable.id, id));
  });

  const result = await getOrderWithItems(mergedInto ?? id);
  res.json({ ...result, mergedInto });
});

router.patch("/orders/:id/notes", authenticate, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { notes } = req.body;
  const [existing] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Order not found" }); return; }
  if (existing.paymentStatus === "paid") {
    res.status(400).json({ error: "This order is already paid. Use a correction instead of editing it directly." });
    return;
  }
  await db.update(ordersTable).set({ notes: notes ?? null }).where(eq(ordersTable.id, id));
  const result = await getOrderWithItems(id);
  if (!result) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(result);
});

router.post("/orders/:id/corrections", authenticate, requireAdmin, async (req: any, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { correctionType, amount, reason } = req.body;
  if (!correctionType || amount === undefined || !reason) {
    res.status(400).json({ error: "correctionType, amount, and reason are required" });
    return;
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const [correction] = await db.insert(orderCorrectionsTable).values({
    originalOrderId: id,
    correctionType,
    amount: String(amount),
    reason,
    createdBy: req.user?.username ?? "admin",
  }).returning();

  res.status(201).json(correction);
});

router.get("/orders/:id/corrections", authenticate, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const corrections = await db.select().from(orderCorrectionsTable).where(eq(orderCorrectionsTable.originalOrderId, id)).orderBy(desc(orderCorrectionsTable.createdAt));
  res.json(corrections);
});

router.get("/order-corrections", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const corrections = await db
    .select({
      id: orderCorrectionsTable.id,
      originalOrderId: orderCorrectionsTable.originalOrderId,
      correctionType: orderCorrectionsTable.correctionType,
      amount: orderCorrectionsTable.amount,
      reason: orderCorrectionsTable.reason,
      createdBy: orderCorrectionsTable.createdBy,
      createdAt: orderCorrectionsTable.createdAt,
      orderTotal: ordersTable.totalAmount,
      invoiceNumber: ordersTable.invoiceNumber,
      isNc: ordersTable.isNc,
      ncPersonName: ordersTable.ncPersonName,
      ncReason: ordersTable.ncReason,
    })
    .from(orderCorrectionsTable)
    .leftJoin(ordersTable, eq(orderCorrectionsTable.originalOrderId, ordersTable.id))
    .orderBy(desc(orderCorrectionsTable.createdAt))
    .limit(200);
  res.json(corrections);
});

router.post("/orders/:id/print-log", authenticate, requireAdmin, async (req: any, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { billType, reason } = req.body;
  if (!billType || !reason) { res.status(400).json({ error: "billType and reason are required" }); return; }

  const [log] = await db.insert(billPrintLogsTable).values({
    orderId: id,
    billType,
    reason,
    printedBy: req.user?.username ?? "admin",
  }).returning();

  res.status(201).json(log);
});

router.get("/bill-print-logs", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const logs = await db
    .select({
      id: billPrintLogsTable.id,
      orderId: billPrintLogsTable.orderId,
      billType: billPrintLogsTable.billType,
      reason: billPrintLogsTable.reason,
      printedBy: billPrintLogsTable.printedBy,
      createdAt: billPrintLogsTable.createdAt,
      orderTotal: ordersTable.totalAmount,
    })
    .from(billPrintLogsTable)
    .leftJoin(ordersTable, eq(billPrintLogsTable.orderId, ordersTable.id))
    .orderBy(desc(billPrintLogsTable.createdAt))
    .limit(200);
  res.json(logs);
});

export default router;