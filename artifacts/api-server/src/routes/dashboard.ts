import { Router } from "express";
import { db, ordersTable, menuItemsTable, inventoryItemsTable, loyaltyCustomersTable, orderItemsTable, creditNotesTable, creditNoteItemsTable } from "@workspace/db";
import { eq, gte, lte, and, sql, desc, count, sum, notInArray } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { accountSalesInRange } from "../lib/accountSales";
import { creditNotesBetween, reissuedOrderIds, reducesSales } from "../lib/ledgerData";

const router = Router();

// Credit-note aware (2026-11-27): an invoice re-issued by Wrong customer is not a second sale, and credit notes reduce sales
// on their own day (the day boundaries here follow the dashboard's own, the server's calendar day).
const dayStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function notReissued() {
  const ids = [...(await reissuedOrderIds())];
  return ids.length ? notInArray(ordersTable.id, ids) : undefined;
}
async function creditNotesTotal(from: Date, to: Date) {
  return (await creditNotesBetween(dayStr(from), dayStr(to))).filter(reducesSales).reduce((s, n) => s + n.total, 0);
}

router.get("/dashboard/stats", authenticate, async (_req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  const skipReissued = await notReissued();
  const [todayStats] = await db
    .select({
      totalSales: sql<number>`COALESCE(SUM(CAST(${ordersTable.totalAmount} AS NUMERIC)), 0)`,
      orderCount: sql<number>`COUNT(*)`,
    })
    .from(ordersTable)
    .where(and(gte(ordersTable.createdAt, today), lte(ordersTable.createdAt, todayEnd), eq(ordersTable.orderStatus, "completed"), eq(ordersTable.isNc, false), eq(ordersTable.accountBill, false), skipReissued));

  const [pendingCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(ordersTable)
    .where(sql`${ordersTable.orderStatus} IN ('pending', 'preparing', 'ready')`);

  const [weekStats] = await db
    .select({ total: sql<number>`COALESCE(SUM(CAST(${ordersTable.totalAmount} AS NUMERIC)), 0)` })
    .from(ordersTable)
    .where(and(gte(ordersTable.createdAt, weekStart), eq(ordersTable.orderStatus, "completed"), eq(ordersTable.isNc, false), eq(ordersTable.accountBill, false), skipReissued));

  const [menuCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(menuItemsTable);

  const [loyaltyCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(loyaltyCustomersTable);

  const allInventory = await db.select().from(inventoryItemsTable);
  const lowStockCount = allInventory.filter(i => {
    if (!i.minStockLevel) return false;
    return parseFloat(String(i.currentStock)) < parseFloat(String(i.minStockLevel));
  }).length;

  const acctToday = await accountSalesInRange(today, todayEnd);
  const acctWeek = await accountSalesInRange(weekStart, todayEnd);
  const todayCreditNotes = await creditNotesTotal(today, todayEnd);
  const weekCreditNotes = await creditNotesTotal(weekStart, todayEnd);
  const todaySales = Number(todayStats?.totalSales ?? 0) + acctToday.sales - todayCreditNotes;
  const todayOrders = Number(todayStats?.orderCount ?? 0) + acctToday.kots;
  const weekSales = Number(weekStats?.total ?? 0) + acctWeek.sales - weekCreditNotes;

  res.json({
    todaySales,
    todayOrders,
    pendingOrders: Number(pendingCount?.count ?? 0),
    lowStockCount,
    totalMenuItems: Number(menuCount?.count ?? 0),
    activeCustomers: Number(loyaltyCount?.count ?? 0),
    weekSales,
    todayCreditNotes, weekCreditNotes,
    avgOrderValue: todayOrders > 0 ? todaySales / todayOrders : 0,
  });
});

router.get("/dashboard/activity", authenticate, async (req, res): Promise<void> => {
  const limitNum = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

  // Get recent orders as activity
  const recentOrders = await db
    .select({
      id: ordersTable.id,
      totalAmount: ordersTable.totalAmount,
      orderStatus: ordersTable.orderStatus,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt))
    .limit(limitNum);

  const activity = recentOrders.map(o => ({
    id: o.id,
    type: "order",
    message: `Order #${o.id} — Rs. ${parseFloat(String(o.totalAmount)).toFixed(2)} — ${o.orderStatus}`,
    createdAt: o.createdAt,
  }));

  res.json(activity);
});

router.get("/dashboard/sales-by-day", authenticate, async (req, res): Promise<void> => {
  const days = req.query.days ? parseInt(req.query.days as string, 10) : 7;
  const results = [];
  const skipReissued = await notReissued();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    const dateEnd = new Date(date);
    dateEnd.setHours(23, 59, 59, 999);
    const [stats] = await db
      .select({
        total: sql<number>`COALESCE(SUM(CAST(${ordersTable.totalAmount} AS NUMERIC)), 0)`,
        orderCount: sql<number>`COUNT(*)`,
      })
      .from(ordersTable)
      .where(and(gte(ordersTable.createdAt, date), lte(ordersTable.createdAt, dateEnd), eq(ordersTable.orderStatus, "completed"), eq(ordersTable.isNc, false), eq(ordersTable.accountBill, false), skipReissued));
    const acct = await accountSalesInRange(date, dateEnd);
    const creditNotes = await creditNotesTotal(date, dateEnd);
    results.push({
      date: date.toISOString().split("T")[0],
      sales: Number(stats?.total ?? 0) + acct.sales - creditNotes,
      creditNotes,
      orders: Number(stats?.orderCount ?? 0) + acct.kots,
    });
  }
  res.json(results);
});

router.get("/dashboard/top-items", authenticate, async (_req, res): Promise<void> => {
  const reissued = [...(await reissuedOrderIds())];
  const topItems = await db
    .select({
      menuItemId: orderItemsTable.menuItemId,
      name: menuItemsTable.name,
      totalSold: sql<number>`SUM(${orderItemsTable.quantity})`,
      totalRevenue: sql<number>`SUM(CAST(${orderItemsTable.subtotal} AS NUMERIC))`,
    })
    .from(orderItemsTable)
    .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
    .where(reissued.length ? notInArray(orderItemsTable.orderId, reissued) : undefined)
    .groupBy(orderItemsTable.menuItemId, menuItemsTable.name);
  // Credited items (item-wise and cancel notes, not reissue) come off the quantity and revenue they were sold for
  const credited = await db.select({
    menuItemId: orderItemsTable.menuItemId,
    qty: sql<number>`SUM(${creditNoteItemsTable.quantity})`,
    amount: sql<number>`SUM(CAST(${creditNoteItemsTable.amount} AS NUMERIC))`,
  }).from(creditNoteItemsTable)
    .innerJoin(creditNotesTable, eq(creditNotesTable.id, creditNoteItemsTable.noteId))
    .innerJoin(orderItemsTable, eq(orderItemsTable.id, creditNoteItemsTable.orderItemId))
    .where(and(eq(creditNotesTable.status, "active"), sql`${creditNotesTable.kind} <> 'reissue'`))
    .groupBy(orderItemsTable.menuItemId);
  const less = new Map(credited.map(c => [c.menuItemId, c]));
  const rows = topItems.map(i => {
    const c = less.get(i.menuItemId);
    return { ...i, totalSold: Number(i.totalSold) - Number(c?.qty ?? 0), totalRevenue: Math.round((Number(i.totalRevenue) - Number(c?.amount ?? 0)) * 100) / 100 };
  });
  res.json(rows.sort((a, b) => b.totalSold - a.totalSold).slice(0, 10));
});

export default router;
