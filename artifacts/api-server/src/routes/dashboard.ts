import { Router } from "express";
import { db, ordersTable, menuItemsTable, inventoryItemsTable, loyaltyCustomersTable, orderItemsTable } from "@workspace/db";
import { eq, gte, lte, and, sql, desc, count, sum } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.get("/dashboard/stats", authenticate, async (_req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  const [todayStats] = await db
    .select({
      totalSales: sql<number>`COALESCE(SUM(CAST(${ordersTable.totalAmount} AS NUMERIC)), 0)`,
      orderCount: sql<number>`COUNT(*)`,
    })
    .from(ordersTable)
    .where(and(gte(ordersTable.createdAt, today), lte(ordersTable.createdAt, todayEnd), eq(ordersTable.orderStatus, "completed")));

  const [pendingCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(ordersTable)
    .where(sql`${ordersTable.orderStatus} IN ('pending', 'preparing', 'ready')`);

  const [weekStats] = await db
    .select({ total: sql<number>`COALESCE(SUM(CAST(${ordersTable.totalAmount} AS NUMERIC)), 0)` })
    .from(ordersTable)
    .where(and(gte(ordersTable.createdAt, weekStart), eq(ordersTable.orderStatus, "completed")));

  const [menuCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(menuItemsTable);

  const [loyaltyCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(loyaltyCustomersTable);

  const allInventory = await db.select().from(inventoryItemsTable);
  const lowStockCount = allInventory.filter(i => {
    if (!i.minStockLevel) return false;
    return parseFloat(String(i.currentStock)) < parseFloat(String(i.minStockLevel));
  }).length;

  const todaySales = Number(todayStats?.totalSales ?? 0);
  const todayOrders = Number(todayStats?.orderCount ?? 0);
  const weekSales = Number(weekStats?.total ?? 0);

  res.json({
    todaySales,
    todayOrders,
    pendingOrders: Number(pendingCount?.count ?? 0),
    lowStockCount,
    totalMenuItems: Number(menuCount?.count ?? 0),
    activeCustomers: Number(loyaltyCount?.count ?? 0),
    weekSales,
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
      .where(and(gte(ordersTable.createdAt, date), lte(ordersTable.createdAt, dateEnd), eq(ordersTable.orderStatus, "completed")));
    results.push({
      date: date.toISOString().split("T")[0],
      sales: Number(stats?.total ?? 0),
      orders: Number(stats?.orderCount ?? 0),
    });
  }
  res.json(results);
});

router.get("/dashboard/top-items", authenticate, async (_req, res): Promise<void> => {
  const topItems = await db
    .select({
      menuItemId: orderItemsTable.menuItemId,
      name: menuItemsTable.name,
      totalSold: sql<number>`SUM(${orderItemsTable.quantity})`,
      totalRevenue: sql<number>`SUM(CAST(${orderItemsTable.subtotal} AS NUMERIC))`,
    })
    .from(orderItemsTable)
    .leftJoin(menuItemsTable, eq(orderItemsTable.menuItemId, menuItemsTable.id))
    .groupBy(orderItemsTable.menuItemId, menuItemsTable.name)
    .orderBy(sql`SUM(${orderItemsTable.quantity}) DESC`)
    .limit(10);
  res.json(topItems.map(i => ({ ...i, totalSold: Number(i.totalSold), totalRevenue: Number(i.totalRevenue) })));
});

export default router;
