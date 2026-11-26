import { Router } from "express";
import { db, orderPaymentsTable, ordersTable, orderItemsTable, menuItemsTable, inventoryItemsTable, inventoryLogsTable, recipesTable, loyaltyCustomersTable, cafeTablesTable, tableSessionsTable, loyaltyRedemptionsTable, orderCorrectionsTable, billPrintLogsTable, invoiceSequencesTable, wasteLogsTable, orderKotCancellationsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { authenticate, requireAdmin } from "../middlewares/auth";
import { applyPrepWaste } from "../lib/prepWaste";
import { claimOrderRequest, completeOrderRequest } from "../lib/idempotency";
import { itemCostFields } from "../lib/costing";
import { attachOperatingCosts } from "../lib/opcosting";
import { hideCosts } from "../middlewares/hideCosts";
import { expandRecipeLines } from "../lib/ingredientUsage";
import { nextInvoiceNumber } from "../lib/fiscal";
import { MONTHLY_RETIRED_MSG } from "../lib/monthlyRetired";
import { validateSplit, partsFor, summaryMethod, creditAmountOf, round2, PAYMENT_MODES, MODE_LABEL } from "../lib/payments";
import { allocatedByOrder, customerBalances, creditNotesByOrder, syncLoyaltyForOrder } from "../lib/receivables";
import { creditLimitWarning, outstandingOf } from "../lib/receivableRules";

const router = Router();
router.use(hideCosts);

// Invoice numbers like 2082/83-00001 (Nepali fiscal year). Atomic: see lib/fiscal.ts.
async function getNextInvoiceNumber(ex?: Parameters<typeof nextInvoiceNumber>[0]): Promise<string> {
  return nextInvoiceNumber(ex);
}

// Payment parts and credit outstanding for a list of orders (orders with no rows fall back to payment_method)
async function paymentInfo(orders: { id: number; totalAmount: unknown; paymentMethod: string | null; paymentStatus: string; isNc: boolean }[]) {
  const ids = orders.map(o => o.id);
  const rows = ids.length ? await db.select().from(orderPaymentsTable).where(inArray(orderPaymentsTable.orderId, ids)).orderBy(orderPaymentsTable.id) : [];
  const byOrder = new Map<number, typeof rows>();
  for (const r of rows) byOrder.set(r.orderId, [...(byOrder.get(r.orderId) ?? []), r]);
  const settled = orders.filter(o => o.paymentStatus === "paid" && !o.isNc);
  const creditIds = settled.filter(o => creditAmountOf(partsFor(o, byOrder.get(o.id))) > 0).map(o => o.id);
  const alloc = await allocatedByOrder(creditIds);
  const notes = await creditNotesByOrder(creditIds);
  const info = new Map<number, { payments: { mode: string; label: string; amount: number; reference: string | null }[]; creditAmount: number; creditPaid: number; creditNotes: number; creditOutstanding: number }>();
  for (const o of orders) {
    const parts = o.paymentStatus === "paid" && !o.isNc ? partsFor(o, byOrder.get(o.id)) : [];
    const creditAmount = creditAmountOf(parts);
    const creditPaid = alloc.get(o.id) ?? 0;
    const cn = notes.get(o.id) ?? 0;
    info.set(o.id, {
      payments: parts.map(p => ({ mode: p.mode, label: MODE_LABEL[p.mode] ?? p.mode, amount: p.amount, reference: p.reference ?? null })),
      creditAmount, creditPaid, creditNotes: cn, creditOutstanding: outstandingOf(creditAmount, cn, creditPaid),
    });
  }
  return info;
}

const CONVERTED_MSG = "This monthly-account bill was converted into separate credit invoices and is closed. Work with those invoices instead.";

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
      accountBill: ordersTable.accountBill,
      ncPersonName: ordersTable.ncPersonName,
      ncReason: ordersTable.ncReason,
      createdBy: ordersTable.createdBy,
      notes: ordersTable.notes,
      backdatedAt: ordersTable.backdatedAt,
      paidAt: ordersTable.paidAt,
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
      kotTable: orderItemsTable.kotTable,
      unitCost: orderItemsTable.unitCost,
      costComplete: orderItemsTable.costComplete,
      costEstimated: orderItemsTable.costEstimated,
    })
    .from(orderItemsTable)
    .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
    .where(eq(orderItemsTable.orderId, orderId));

  const corrections = await db.select().from(orderCorrectionsTable).where(eq(orderCorrectionsTable.originalOrderId, orderId)).orderBy(desc(orderCorrectionsTable.createdAt));
  const kotCancellations = await db.select().from(orderKotCancellationsTable).where(eq(orderKotCancellationsTable.orderId, orderId)).orderBy(orderKotCancellationsTable.cancelledAt);
  const pay = (await paymentInfo([order])).get(order.id);
  return { ...order, ...pay, items: order.isNc ? items.map((i: any) => ({ ...i, ncCost: i.unitCost != null ? Math.round(parseFloat(String(i.unitCost)) * i.quantity * 100) / 100 : null, ncCostComplete: !!i.costComplete })) : items, corrections, kotCancellations };
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
      accountBill: ordersTable.accountBill,
      ncPersonName: ordersTable.ncPersonName,
      ncReason: ordersTable.ncReason,
      createdBy: ordersTable.createdBy,
      notes: ordersTable.notes,
      backdatedAt: ordersTable.backdatedAt,
      paidAt: ordersTable.paidAt,
      createdAt: ordersTable.createdAt,
      updatedAt: ordersTable.updatedAt,
    })
    .from(ordersTable)
    .leftJoin(cafeTablesTable, eq(ordersTable.tableId, cafeTablesTable.id))
    .leftJoin(loyaltyCustomersTable, eq(ordersTable.loyaltyCustomerId, loyaltyCustomersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sql`COALESCE(${ordersTable.backdatedAt}, ${ordersTable.createdAt})`));

  const payInfo = await paymentInfo(ordersList);
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
          kotTable: orderItemsTable.kotTable,
          unitCost: orderItemsTable.unitCost,
          costComplete: orderItemsTable.costComplete,
          costEstimated: orderItemsTable.costEstimated,
        })
        .from(orderItemsTable)
        .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
        .where(eq(orderItemsTable.orderId, order.id));

      const corrections = await db.select().from(orderCorrectionsTable).where(eq(orderCorrectionsTable.originalOrderId, order.id)).orderBy(desc(orderCorrectionsTable.createdAt));
      const kotCancellations = await db.select().from(orderKotCancellationsTable).where(eq(orderKotCancellationsTable.orderId, order.id)).orderBy(orderKotCancellationsTable.cancelledAt);

      return { ...order, ...payInfo.get(order.id), items: order.isNc ? items.map((i: any) => ({ ...i, ncCost: i.unitCost != null ? Math.round(parseFloat(String(i.unitCost)) * i.quantity * 100) / 100 : null, ncCostComplete: !!i.costComplete })) : items, corrections, kotCancellations };
    })
  );

  const viewerRole = (req as any).user?.role;
  if (viewerRole === "admin" || viewerRole === "accountant") await attachOperatingCosts(ordersWithItems as any[]);
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

  // ── Place each order only once: a repeated request id returns the order already made ──
  const requestId: string | undefined = typeof req.body.requestId === "string" && req.body.requestId.length >= 8 ? req.body.requestId.slice(0, 80) : undefined;
  if (requestId) {
    const claim = await claimOrderRequest(requestId);
    if (claim.state === "done") {
      const previous = await getOrderWithItems(claim.orderId);
      res.status(200).json({ ...previous, kotNumber: claim.kotNumber, merged: claim.merged, duplicate: true });
      return;
    }
    if (claim.state === "busy") {
      res.status(409).json({ error: "This order is still being placed. Wait a moment and check Active Orders before trying again." });
      return;
    }
  }

  const discountValue = discountAmount ? parseFloat(String(discountAmount)) : 0;
  const finalTotal = Math.max(0, totalAmount - discountValue);

  // NC (Not Chargeable) orders are marked paid immediately — no payment is
  // ever collected — but still get a real invoice number for the audit
  // trail, since it's a legitimate bill (hotel comp / owner use), just at
  // zero collected revenue.
  // NC bills are recorded at the ACTUAL INGREDIENT COST of what was given away, not the selling price
  let ncCostTotal = 0;
  if (isNc) {
    for (const it of resolvedItems) {
      const f = await itemCostFields(it.menuItemId);
      ncCostTotal += parseFloat(f.unitCost ?? "0") * it.quantity;
    }
  }
  const ncInvoiceNumber = isNc ? await getNextInvoiceNumber() : undefined;

  // ── One bill per table visit: join the table's open unpaid bill as a new KOT ──
  // (Monthly-account bills were retired on 2026-11-24: a customer's pays_monthly flag no longer changes where an order goes.)
  let openBill: typeof ordersTable.$inferSelect | undefined;
  if (tableId && !isNc && !backdatedAt) {
    [openBill] = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.tableId, tableId), eq(ordersTable.paymentStatus, "pending"), eq(ordersTable.isNc, false), eq(ordersTable.accountBill, false), sql`${ordersTable.orderStatus} <> 'cancelled'`))
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
    ...(backdatedAt ? { orderStatus: openBill.orderStatus } : {}),
    ...(backdatedAt && new Date(backdatedAt) < new Date(openBill.createdAt) ? { createdAt: new Date(backdatedAt) } : {}),
  }).where(eq(ordersTable.id, openBill.id)).returning() : await db.insert(ordersTable).values({
    tableId: tableId ?? null,
    totalAmount: isNc ? String(Math.round(ncCostTotal * 100) / 100) : String(finalTotal),
    accountBill: false,
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
    await db.insert(orderItemsTable).values({ orderId: order.id, menuItemId: item.menuItemId, quantity: item.quantity, unitPrice: String(item.unitPrice), subtotal: String(item.subtotal), notes: item.notes ?? null, kotNumber: kotNo, kotAt: backdatedAt ? new Date(backdatedAt) : new Date(), kotNote: notes ?? null, kotBy: (req as any).user?.username ?? null, kotTable: null, ...(await itemCostFields(item.menuItemId)) });
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
  if (requestId) await completeOrderRequest(requestId, order.id, kotNo, !!openBill);
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
  const [current] = await db.select({ paymentStatus: ordersTable.paymentStatus }).from(ordersTable).where(eq(ordersTable.id, id));
  if (current?.paymentStatus === "converted") { res.status(400).json({ error: CONVERTED_MSG }); return; }

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

// Settle a bill. Body: paymentStatus "paid" and either
//   payments: [{ mode, amount, reference? }]  (split; the parts must add up to the bill), or
//   paymentMethod: one mode for the whole bill (older screens).
// Modes: cash, nabil_qr (QR Payment), card_nabil, card_hbl (LHC POS), card_sulimha_nabil, card_sulimha_hbl (Sulimha POS), credit. Credit needs a loyalty customer;
// the bill gets its invoice number now, leaves Active Orders and goes on the customer's receivable.
router.patch("/orders/:id/payment", authenticate, async (req, res): Promise<void> => {
  try {
  const id = parseId(req.params.id);
  const { paymentMethod, paymentStatus, loyaltyCustomerId, vatAmount, billType, finalTotal, otherPartyName, otherPartyPan, nonTaxableAmount, isNc, ncPersonName, ncReason, payments } = req.body;
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

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  if (paymentStatus !== "paid") {
    if (order.paymentStatus === "paid") { res.status(400).json({ error: "This order is already paid. Use a correction instead of editing it directly." }); return; }
    await db.update(ordersTable).set(updateData).where(eq(ordersTable.id, id));
    res.json(await getOrderWithItems(id));
    return;
  }

  // Already paid (double press or retry): return it as is, so points and totals are never counted twice
  if (order.paymentStatus === "paid") { res.json(await getOrderWithItems(id)); return; }
  if (order.paymentStatus === "cancelled") { res.status(400).json({ error: "This order was cancelled." }); return; }
  if (order.paymentStatus === "converted") { res.status(400).json({ error: CONVERTED_MSG }); return; }

  const billTotal = round2(parseFloat(String(finalTotal !== undefined ? finalTotal : order.totalAmount)));
  const customerId: number | null = loyaltyCustomerId ? Number(loyaltyCustomerId) : order.loyaltyCustomerId;
  const nc = isNc !== undefined ? !!isNc : order.isNc;

  // Work out the payment parts
  let parts: { mode: string; amount: number; reference?: string | null }[] = [];
  let writeRows = true;
  if (nc) {
    writeRows = false; // NC bills are never money received
  } else if (Array.isArray(payments)) {
    const v = validateSplit(payments, billTotal, { hasCustomer: !!customerId });
    if ("error" in v) { res.status(400).json({ error: v.error }); return; }
    parts = v.parts;
  } else {
    const single = String(paymentMethod ?? order.paymentMethod ?? "cash");
    if ((PAYMENT_MODES as readonly string[]).includes(single)) {
      const v = validateSplit([{ mode: single, amount: billTotal }], billTotal, { hasCustomer: !!customerId });
      if ("error" in v) { res.status(400).json({ error: v.error }); return; }
      parts = v.parts;
    } else {
      // A legacy value from an older screen (card, esewa): keep it on the order only; readers fall back to it
      writeRows = false;
      updateData.paymentMethod = single;
    }
  }
  const creditPart = creditAmountOf(parts);

  let creditWarning: string | null = null;
  if (creditPart > 0) {
    const [cust] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, customerId!));
    if (!cust) { res.status(400).json({ error: "Credit needs a customer from the loyalty list." }); return; }
    const [bal] = await customerBalances(cust.id); // creditLimit there is the customer's own limit, or the default for everyone
    creditWarning = creditLimitWarning(bal?.creditLimit ?? null, bal?.balance ?? 0, creditPart);
  }

  const paidAt = new Date();
  const username = (req as any).user?.username ?? null;
  let alreadyPaid = false;
  await db.transaction(async (tx) => {
    // Lock the bill: a second press waits here, then sees it paid
    const locked = await tx.execute(sql`SELECT payment_status FROM orders WHERE id = ${id} FOR UPDATE`);
    const status = ((locked as any).rows ?? locked)[0]?.payment_status;
    if (status === "paid") { alreadyPaid = true; return; }

    const set: Record<string, unknown> = { ...updateData, paymentStatus: "paid", paidAt };
    if (writeRows) set.paymentMethod = summaryMethod(parts);
    if (customerId) set.loyaltyCustomerId = customerId;
    if (creditPart > 0) set.orderStatus = "completed"; // a credit bill leaves Active Orders
    // Only assign an invoice number once — reprints/edits must never get a new one
    if (!order.invoiceNumber) set.invoiceNumber = await getNextInvoiceNumber(tx);

    // Loyalty: the visit counts now; points and total spent follow the money paid (none on a credit part
    // until the customer pays it). See syncLoyaltyForOrder below.
    if (customerId) {
      await tx.update(loyaltyCustomersTable).set({ totalOrders: sql`${loyaltyCustomersTable.totalOrders} + 1` }).where(eq(loyaltyCustomersTable.id, customerId));
    }

    // Clear table session so the next guest gets a fresh start
    if (order.tableId) await tx.delete(tableSessionsTable).where(eq(tableSessionsTable.tableId, order.tableId));

    await tx.update(ordersTable).set(set).where(eq(ordersTable.id, id));
    if (writeRows) {
      for (const p of parts) {
        await tx.insert(orderPaymentsTable).values({ orderId: id, mode: p.mode, amount: String(p.amount), reference: p.reference ?? null, paidAt, createdBy: username });
      }
    }
    if (customerId && !nc) await syncLoyaltyForOrder(tx, id, "Points for the amount paid", username ?? "staff");
  });

  const result = await getOrderWithItems(id);
  if (!result) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(alreadyPaid ? result : { ...result, creditWarning });
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
  if (order.paymentStatus === "converted") { res.status(400).json({ error: CONVERTED_MSG }); return; }
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
  if (!orderBeforeCancel) { res.status(404).json({ error: "Order not found" }); return; }
  if (orderBeforeCancel.paymentStatus === "cancelled") { res.status(400).json({ error: "This order is already cancelled." }); return; }
  if (orderBeforeCancel.paymentStatus === "converted") { res.status(400).json({ error: CONVERTED_MSG }); return; }
  // A credit invoice that has customer receipts allocated to it cannot be cancelled until those receipts are voided
  const allocated = (await allocatedByOrder([id])).get(id) ?? 0;
  if (allocated > 0) { res.status(400).json({ error: `Receipts of Rs. ${allocated.toFixed(2)} are allocated to this credit invoice. Void those receipt vouchers first.` }); return; }
  const cnTotal = (await creditNotesByOrder([id])).get(id) ?? 0;
  if (cnTotal > 0) { res.status(400).json({ error: "This invoice has credit notes. Void them first." }); return; }
  if (orderBeforeCancel.paymentStatus === "paid") {
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

// ── Profit for a day (admin): paid orders only, excludes VAT and card charge ──
router.get("/profit/daily", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const from = new Date(String(req.query.from ?? ""));
  const to = new Date(String(req.query.to ?? ""));
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) { res.status(400).json({ error: "Valid from and to times are required." }); return; }

  const dayOrders = await db.select().from(ordersTable).where(and(
    eq(ordersTable.paymentStatus, "paid"),
    sql`COALESCE(${ordersTable.backdatedAt}, ${ordersTable.createdAt}) >= ${from}`,
    sql`COALESCE(${ordersTable.backdatedAt}, ${ordersTable.createdAt}) <= ${to}`,
  ));
  const ids = dayOrders.map(o => o.id);
  const items = ids.length ? await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, ids)) : [];
  const byOrder = new Map<number, typeof items>();
  for (const it of items) byOrder.set(it.orderId, [...(byOrder.get(it.orderId) ?? []), it]);

  let revenueAll = 0, revenue = 0, cost = 0, ncCost = 0, costedOrders = 0, uncostedOrders = 0, uncostedRevenue = 0;
  for (const o of dayOrders) {
    const its = byOrder.get(o.id) ?? [];
    const net = o.isNc ? 0 : Math.max(0, parseFloat(String(o.totalAmount)) - parseFloat(String(o.vatAmount ?? 0)));
    revenueAll += net;
    const complete = its.length > 0 && its.every(i => i.costComplete);
    if (!complete) { uncostedOrders++; uncostedRevenue += net; continue; }
    const c = its.reduce((s, i) => s + parseFloat(String(i.unitCost ?? 0)) * i.quantity, 0);
    costedOrders++; revenue += net; cost += c;
    if (o.isNc) ncCost += c;
  }
  const profit = revenue - cost;
  res.json({
    orders: dayOrders.length, costedOrders, uncostedOrders,
    revenueAll, revenue, cost, profit,
    marginPct: revenue > 0 ? (profit / revenue) * 100 : null,
    ncCost, uncostedRevenue,
  });
});

// ── Give older orders a cost using TODAY's ingredient prices (marked as estimates) ──
router.post("/profit/recalculate", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const pending = await db.select({ id: orderItemsTable.id, menuItemId: orderItemsTable.menuItemId }).from(orderItemsTable).where(eq(orderItemsTable.costComplete, false));
  const cache = new Map<number, { unitCost: string | null; costComplete: boolean }>();
  let updated = 0, stillIncomplete = 0;
  for (const row of pending) {
    let f = cache.get(row.menuItemId);
    if (!f) { f = await itemCostFields(row.menuItemId); cache.set(row.menuItemId, f); }
    if (!f.costComplete) { stillIncomplete++; continue; }
    await db.update(orderItemsTable).set({ unitCost: f.unitCost, costComplete: true, costEstimated: true }).where(eq(orderItemsTable.id, row.id));
    updated++;
  }
  res.json({ checked: pending.length, updated, stillIncomplete });
});

// ── Add or change the customer on an unpaid order. (Monthly accounts were retired on 2026-11-24: this never merges bills.) ──
router.patch("/orders/:id/customer", authenticate, async (req: any, res): Promise<void> => {
  const id = parseId(req.params.id);
  const customerId = Number(req.body?.loyaltyCustomerId);
  if (!Number.isInteger(customerId) || customerId <= 0) { res.status(400).json({ error: "Choose a customer." }); return; }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.paymentStatus !== "pending") { res.status(400).json({ error: "Only unpaid orders can change customer." }); return; }
  if (order.accountBill) { res.status(400).json({ error: MONTHLY_RETIRED_MSG }); return; }
  const [customer] = await db.select().from(loyaltyCustomersTable).where(eq(loyaltyCustomersTable.id, customerId));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  await db.update(ordersTable).set({ loyaltyCustomerId: customer.id }).where(eq(ordersTable.id, id));
  res.json({ ...(await getOrderWithItems(id)), mergedInto: null, accountOpened: false });
});

// Tiny endpoint for the notification chime: pending orders and their latest KOT number
router.get("/orders-signal", authenticate, async (_req, res): Promise<void> => {
  const rows = await db
    .select({ id: ordersTable.id, kot: sql<number>`COALESCE(MAX(${orderItemsTable.kotNumber}), 1)` })
    .from(ordersTable)
    .leftJoin(orderItemsTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(eq(ordersTable.orderStatus, "pending"))
    .groupBy(ordersTable.id);
  res.json(rows);
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
  if (order.accountBill) { res.status(400).json({ error: "This is a monthly account bill. It belongs to the customer, not to a table." }); return; }
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
  if (existing.paymentStatus === "converted") { res.status(400).json({ error: CONVERTED_MSG }); return; }
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
  if (order.paymentStatus === "converted") { res.status(400).json({ error: CONVERTED_MSG }); return; }

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
      accountBill: ordersTable.accountBill,
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