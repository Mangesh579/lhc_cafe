import { Router } from "express";
import type { Response } from "express";
import { db, operatingResourcesTable, operatingProfilesTable, operatingProfileUsageTable, costingSettingsTable, menuItemsTable, menuCategoriesTable, ordersTable, orderItemsTable, expensesTable, wasteLogsTable, inventoryItemsTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { authenticate, requireAdminOrAccountant, type AuthRequest } from "../middlewares/auth";
import { loadCostingContext, ratesFor, itemOperating, evaluateOrder, currentYm, ymOf, shiftMonth, reportEntries } from "../lib/opcosting";
import { menuItemCosting } from "../lib/costing";
import { expandUsage } from "../lib/ingredientUsage";

const router = Router();

const isYm = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
const monthOf = (q: unknown) => (isYm(q) ? q : currentYm());
const idOf = (raw: string | string[]) => parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
const clean = (v: unknown, max: number): string | null => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" || isNaN(parseFloat(String(v))) ? null : parseFloat(String(v)));
const round2 = (n: number) => Math.round(n * 100) / 100;

function monthDates(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: new Date(y, m - 1, 1, 0, 0, 0, 0), to: new Date(y, m, 0, 23, 59, 59, 999), fromStr: `${ym}-01`, toStr: `${ym}-${String(last).padStart(2, "0")}` };
}

// Each report entry acts as one "sale" with its own date and revenue: a normal order is one sale,
// a monthly-account bill is one sale per KOT (on the day it was ordered).
async function paidOrdersWithItems(from: Date, to: Date) {
  const entries = await reportEntries(from, to);
  const orders: any[] = [];
  const byOrder = new Map<number, any[]>();
  entries.forEach((e, idx) => {
    const pid = idx + 1;
    orders.push({ ...e.order, id: pid, totalAmount: String(e.revenue), vatAmount: "0", createdAt: e.date, backdatedAt: null, _unpaid: !e.paid });
    byOrder.set(pid, e.items);
  });
  return { orders, byOrder };
}

async function paidOrdersWithItemsByOrderDate(from: Date, to: Date) {
  const orders = await db.select().from(ordersTable).where(and(
    eq(ordersTable.paymentStatus, "paid"),
    sql`COALESCE(${ordersTable.backdatedAt}, ${ordersTable.createdAt}) >= ${from}`,
    sql`COALESCE(${ordersTable.backdatedAt}, ${ordersTable.createdAt}) <= ${to}`,
  ));
  const ids = orders.map(o => o.id);
  const items = ids.length ? await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, ids)) : [];
  const byOrder = new Map<number, any[]>();
  for (const it of items) byOrder.set(it.orderId, [...(byOrder.get(it.orderId) ?? []), it]);
  return { orders, byOrder };
}

// ── Everything the settings screen needs ──
router.get("/costing/config", authenticate, requireAdminOrAccountant, async (_req, res): Promise<void> => {
  const ctx = await loadCostingContext();
  const profiles = await db.select().from(operatingProfilesTable).orderBy(operatingProfilesTable.id);
  const items = await db
    .select({ id: menuItemsTable.id, name: menuItemsTable.name, price: menuItemsTable.price, categoryName: menuCategoriesTable.name, profileId: menuItemsTable.operatingProfileId })
    .from(menuItemsTable)
    .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
    .orderBy(menuCategoriesTable.displayOrder, menuItemsTable.name);
  res.json({
    settings: ctx.settings,
    resources: Array.from(ctx.resources.values()),
    profiles: profiles.map(p => ({ id: p.id, name: p.name, note: p.note, usage: ctx.usageByProfile.get(p.id) ?? [] })),
    menuItems: items.map(i => ({ ...i, price: parseFloat(String(i.price)) })),
  });
});

router.put("/costing/settings", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const b = req.body ?? {};
  const method = b.allocationMethod === "by_sales" ? "by_sales" : "per_dish";
  const dishes = numOrNull(b.expectedMonthlyDishes);
  const values = {
    allocationMethod: method,
    expectedMonthlyDishes: dishes != null && dishes > 0 ? Math.round(dishes) : null,
    includeOneTime: b.includeOneTime !== false,
    volumeBasis: ["auto", "month", "manual"].includes(b.volumeBasis) ? b.volumeBasis : "auto",
    volumeMonth: isYm(b.volumeMonth) ? b.volumeMonth : null,
  };
  const updated = await db.update(costingSettingsTable).set(values).where(eq(costingSettingsTable.id, 1)).returning();
  if (updated.length === 0) await db.insert(costingSettingsTable).values({ id: 1, ...values });
  res.json({ success: true });
});

// ── Resources (gas, oil, water, soap…) ──
router.post("/costing/resources", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const name = clean(req.body?.name, 60), unit = clean(req.body?.unit, 20);
  if (!name || !unit) { res.status(400).json({ error: "A name and a unit are required." }); return; }
  const [row] = await db.insert(operatingResourcesTable).values({ name, unit, unitCost: numOrNull(req.body?.unitCost) == null ? null : String(numOrNull(req.body?.unitCost)), expenseCategory: clean(req.body?.expenseCategory, 80) }).returning();
  res.status(201).json(row);
});

router.patch("/costing/resources/:id", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const set: Record<string, unknown> = {};
  if (req.body?.unitCost !== undefined) { const c = numOrNull(req.body.unitCost); set.unitCost = c == null ? null : String(c); }
  if (req.body?.expenseCategory !== undefined) set.expenseCategory = clean(req.body.expenseCategory, 80);
  if (clean(req.body?.name, 60)) set.name = clean(req.body.name, 60);
  if (clean(req.body?.unit, 20)) set.unit = clean(req.body.unit, 20);
  if (Object.keys(set).length === 0) { res.json({ success: true }); return; }
  await db.update(operatingResourcesTable).set(set).where(eq(operatingResourcesTable.id, id));
  res.json({ success: true });
});

router.delete("/costing/resources/:id", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  await db.delete(operatingResourcesTable).where(eq(operatingResourcesTable.id, idOf(req.params.id)));
  res.sendStatus(204);
});

// ── Profiles ──
async function writeUsage(profileId: number, usage: any) {
  await db.delete(operatingProfileUsageTable).where(eq(operatingProfileUsageTable.profileId, profileId));
  for (const u of Array.isArray(usage) ? usage : []) {
    const q = numOrNull(u?.quantity);
    if (q != null && q > 0 && Number.isInteger(u?.resourceId)) {
      await db.insert(operatingProfileUsageTable).values({ profileId, resourceId: u.resourceId, quantity: String(q) });
    }
  }
}

router.post("/costing/profiles", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const name = clean(req.body?.name, 60);
  if (!name) { res.status(400).json({ error: "A profile name is required." }); return; }
  const [row] = await db.insert(operatingProfilesTable).values({ name, note: clean(req.body?.note, 200) }).returning();
  await writeUsage(row.id, req.body?.usage);
  res.status(201).json(row);
});

router.patch("/costing/profiles/:id", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  const name = clean(req.body?.name, 60);
  if (name) await db.update(operatingProfilesTable).set({ name, note: req.body?.note !== undefined ? clean(req.body.note, 200) : undefined }).where(eq(operatingProfilesTable.id, id));
  if (req.body?.usage !== undefined) await writeUsage(id, req.body.usage);
  res.json({ success: true });
});

router.delete("/costing/profiles/:id", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const id = idOf(req.params.id);
  await db.update(menuItemsTable).set({ operatingProfileId: null }).where(eq(menuItemsTable.operatingProfileId, id));
  await db.delete(operatingProfilesTable).where(eq(operatingProfilesTable.id, id));
  res.sendStatus(204);
});

router.put("/costing/assign-profile", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const ids: number[] = (Array.isArray(req.body?.menuItemIds) ? req.body.menuItemIds : []).filter((n: unknown) => Number.isInteger(n));
  const pid = req.body?.profileId == null || req.body.profileId === "" ? null : parseInt(String(req.body.profileId), 10);
  if (ids.length === 0) { res.status(400).json({ error: "No menu items given." }); return; }
  await db.update(menuItemsTable).set({ operatingProfileId: pid }).where(inArray(menuItemsTable.id, ids));
  res.json({ updated: ids.length });
});

// ── Starting set: resources WITHOUT prices, and rough profiles to review ──
router.post("/costing/seed-defaults", authenticate, requireAdminOrAccountant, async (_req, res): Promise<void> => {
  const existing = await db.select().from(operatingResourcesTable).limit(1);
  if (existing.length > 0) { res.status(400).json({ error: "Operating resources are already set up." }); return; }

  const defs = [
    { name: "Gas (LPG)", unit: "kg", expenseCategory: "Cooking gas (LPG)" },
    { name: "Cooking oil", unit: "litre", expenseCategory: "Cooking oil" },
    { name: "Water", unit: "litre", expenseCategory: "Water" },
    { name: "Dishwashing soap", unit: "ml", expenseCategory: "Dishwashing and cleaning supplies" },
  ];
  const ids: number[] = [];
  for (let i = 0; i < defs.length; i++) {
    const [r] = await db.insert(operatingResourcesTable).values({ ...defs[i], sortOrder: i }).returning();
    ids.push(r.id);
  }
  const [gas, oil, water, soap] = ids;
  const profiles = [
    { name: "Cold drink (no cooking)", note: "Rough starting values - review", use: { [water]: 0.2, [soap]: 2 } },
    { name: "Espresso-machine drink", note: "Rough starting values - review", use: { [water]: 0.3, [soap]: 3 } },
    { name: "Boiled drink (tea, hot milk)", note: "Rough starting values - review", use: { [gas]: 0.006, [water]: 0.25, [soap]: 3 } },
    { name: "Light cooking (sandwich, grill, toast)", note: "Rough starting values - review", use: { [gas]: 0.012, [oil]: 0.01, [water]: 0.3, [soap]: 5 } },
    { name: "Fried item", note: "Rough starting values - review", use: { [gas]: 0.02, [oil]: 0.06, [water]: 0.3, [soap]: 6 } },
    { name: "Main dish", note: "Rough starting values - review", use: { [gas]: 0.03, [oil]: 0.03, [water]: 0.5, [soap]: 8 } },
    { name: "Ready item (bakery, no cooking)", note: "Rough starting values - review", use: { [water]: 0.05, [soap]: 1 } },
  ];
  for (const p of profiles) {
    const [row] = await db.insert(operatingProfilesTable).values({ name: p.name, note: p.note }).returning();
    await writeUsage(row.id, Object.entries(p.use).map(([rid, q]) => ({ resourceId: Number(rid), quantity: q })));
  }
  res.status(201).json({ resources: defs.length, profiles: profiles.length });
});

router.get("/costing/rates", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const ym = monthOf(req.query.month);
  const ctx = await loadCostingContext();
  res.json({ rates: ratesFor(ctx, ym), thisMonthVolume: ctx.volume.get(ym) ?? { dishes: 0, value: 0 } });
});

// ── Month summary: management view, cash view and the checks between them ──
router.get("/costing/month-summary", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const ym = monthOf(req.query.month);
  const { from, to, fromStr, toStr } = monthDates(ym);
  const ctx = await loadCostingContext();
  const { orders, byOrder } = await paidOrdersWithItems(from, to);

  let revenue = 0, ingredient = 0, variable = 0, fixed = 0, incompleteOrders = 0;
  const resourceEst = new Map<string, number>();
  for (const o of orders) {
    const ev = evaluateOrder(ctx, o, byOrder.get(o.id) ?? []);
    revenue += ev.revenue; ingredient += ev.ingredient; variable += ev.variable; fixed += ev.fixed;
    if (!(ev.ingredientOk && ev.opOk)) incompleteOrders++;
    for (const [k, v] of ev.resourceCost) resourceEst.set(k, (resourceEst.get(k) ?? 0) + v);
  }
  const totalCost = ingredient + variable + fixed;

  const monthExpenses = await db.select().from(expensesTable).where(and(eq(expensesTable.status, "active"), sql`${expensesTable.expenseDate} >= ${fromStr}`, sql`${expensesTable.expenseDate} <= ${toStr}`));
  let direct = 0, indirect = 0;
  const byCategory = new Map<string, number>();
  for (const e of monthExpenses) {
    const a = parseFloat(String(e.amount));
    if (e.type === "direct") direct += a; else indirect += a;
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + a);
  }

  const rates = ratesFor(ctx, ym);
  res.json({
    month: ym, orders: orders.length, incompleteOrders,
    revenue: round2(revenue), ingredientCost: round2(ingredient), variableCost: round2(variable), overheadAllocated: round2(fixed),
    totalCost: round2(totalCost), netProfit: round2(revenue - totalCost), marginPct: revenue > 0 ? ((revenue - totalCost) / revenue) * 100 : null,
    expenses: { direct: round2(direct), indirect: round2(indirect), total: round2(direct + indirect) },
    cashProfit: round2(revenue - direct - indirect),
    purchasesVsRecipe: { directPurchases: round2(direct), recipeIngredientCost: round2(ingredient), difference: round2(direct - ingredient) },
    overheadPool: round2(rates.pool.total),
    resources: Array.from(ctx.resources.values()).map(r => ({
      name: r.name, unit: r.unit, linkedCategory: r.expenseCategory,
      estimatedCost: round2(resourceEst.get(r.name) ?? 0),
      actualBills: r.expenseCategory ? round2(byCategory.get(r.expenseCategory) ?? 0) : null,
    })),
    rates,
  });
});

// ── Day view for the dashboard: profit after ingredients and net profit ──
router.get("/profit/net-daily", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const from = new Date(String(req.query.from ?? "")), to = new Date(String(req.query.to ?? ""));
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) { res.status(400).json({ error: "Valid from and to times are required." }); return; }
  const ctx = await loadCostingContext();
  const { orders, byOrder } = await paidOrdersWithItems(from, to);

  const g = { revenue: 0, ingredientCost: 0, profit: 0, orders: 0, excludedOrders: 0 };
  const n = { revenue: 0, ingredientCost: 0, variableCost: 0, overheadCost: 0, profit: 0, orders: 0, excludedOrders: 0, excludedRevenue: 0 };
  let ncCost = 0;
  for (const o of orders) {
    const ev = evaluateOrder(ctx, o, byOrder.get(o.id) ?? []);
    if (ev.ingredientOk) { g.revenue += ev.revenue; g.ingredientCost += ev.ingredient; g.orders++; } else g.excludedOrders++;
    if (ev.ingredientOk && ev.opOk) {
      n.revenue += ev.revenue; n.ingredientCost += ev.ingredient; n.variableCost += ev.variable; n.overheadCost += ev.fixed; n.orders++;
      if (ev.isNc) ncCost += ev.ingredient + ev.variable + ev.fixed;
    } else { n.excludedOrders++; n.excludedRevenue += ev.revenue; }
  }
  g.profit = g.revenue - g.ingredientCost;
  n.profit = n.revenue - n.ingredientCost - n.variableCost - n.overheadCost;
  const rates = ratesFor(ctx, ymOf(from));
  res.json({
    orders: orders.length, gross: g,
    net: { ...n, marginPct: n.revenue > 0 ? (n.profit / n.revenue) * 100 : null },
    ncCost,
    overhead: { available: rates.available, estimatedBuckets: rates.estimatedBuckets, volumeSource: rates.volumeSource },
  });
});

// ── Monthly profit & loss (accounting view) ──
// Sales - recipe cost of dishes sold - complimentary (NC) food - ACTUAL indirect expenses. Each counted once.
// Direct purchases are only a memo line: the recipes already carry the ingredient cost of what was sold.
async function computePnl(ym: string) {
  const { from, to, fromStr, toStr } = monthDates(ym);
  const { orders, byOrder } = await paidOrdersWithItems(from, to);

  let sales = 0, cogs = 0, ncCost = 0, dishes = 0, ncDishes = 0, incomplete = 0;
  for (const o of orders) {
    const items = byOrder.get(o.id) ?? [];
    let cost = 0, qty = 0, ok = items.length > 0;
    for (const i of items) {
      cost += parseFloat(String(i.unitCost ?? 0)) * i.quantity;
      qty += i.quantity;
      if (!(i.unitCost != null && i.costComplete)) ok = false;
    }
    if (!ok) incomplete++;
    if (o.isNc) { ncCost += cost; ncDishes += qty; }
    else {
      sales += Math.max(0, parseFloat(String(o.totalAmount)) - parseFloat(String(o.vatAmount ?? 0)));
      cogs += cost; dishes += qty;
    }
  }

  const ex = await db.select().from(expensesTable).where(and(
    eq(expensesTable.status, "active"),
    sql`${expensesTable.expenseDate} >= ${fromStr}`,
    sql`${expensesTable.expenseDate} <= ${toStr}`,
  ));
  const byCat = new Map<string, number>();
  let overhead = 0, direct = 0;
  for (const e of ex) {
    const a = parseFloat(String(e.amount));
    if (e.type === "indirect") { overhead += a; byCat.set(e.category, (byCat.get(e.category) ?? 0) + a); }
    else direct += a;
  }

  const grossBefore = sales - cogs;
  // Recorded waste and spoilage: manual Waste Log entries only.
  // Automatic prep waste (tied to an order) is already inside the recipe cost.
  const wasteRows = await db.select().from(wasteLogsTable).where(and(
    sql`${wasteLogsTable.orderId} IS NULL`,
    sql`${wasteLogsTable.createdAt} >= ${from}`,
    sql`${wasteLogsTable.createdAt} <= ${to}`,
  ));
  const leafCosts = new Map<number, number | null>();
  const leafCost = async (id: number): Promise<number | null> => {
    if (!leafCosts.has(id)) {
      const [r] = await db.select({ c: inventoryItemsTable.costPerUnit }).from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
      leafCosts.set(id, r?.c == null ? null : parseFloat(String(r.c)));
    }
    return leafCosts.get(id) ?? null;
  };
  let wasteCost = 0, equipmentLoss = 0, wasteUnvalued = 0;
  const wasteByReason = new Map<string, number>();
  for (const w of wasteRows) {
    const qty = parseFloat(String(w.quantity));
    let value = parseFloat(String(w.wasteValue ?? 0));
    if (w.equipmentItemId) { equipmentLoss += value; continue; }
    if (!(value > 0)) {
      value = 0;
      if (w.inventoryItemId) {
        let ok = true;
        for (const leaf of await expandUsage(w.inventoryItemId, qty)) {
          const c = await leafCost(leaf.inventoryItemId);
          if (c == null) ok = false; else value += c * leaf.quantity;
        }
        if (!ok) wasteUnvalued++;
      } else if (w.menuItemId) {
        const mc = await menuItemCosting(w.menuItemId);
        value = mc.totalCost * qty;
        if (!mc.complete) wasteUnvalued++;
      } else wasteUnvalued++;
    }
    wasteCost += value;
    const key = (w.reason ?? "Other").trim() || "Other";
    wasteByReason.set(key, (wasteByReason.get(key) ?? 0) + value);
  }

  const grossAfter = grossBefore - ncCost - wasteCost;
  const net = grossAfter - overhead;
  return {
    month: ym, orders: orders.length, incompleteOrders: incomplete, dishesSold: dishes, ncDishes,
    sales: round2(sales), cogs: round2(cogs), grossBefore: round2(grossBefore),
    ncCost: round2(ncCost), grossAfter: round2(grossAfter),
    wasteCost: round2(wasteCost), wasteEntries: wasteRows.filter(w => !w.equipmentItemId).length, wasteUnvalued, equipmentLoss: round2(equipmentLoss),
    wasteByReason: Array.from(wasteByReason.entries()).map(([reason, total]) => ({ reason, total: round2(total) })).sort((a, b) => b.total - a.total).slice(0, 6),
    overhead: round2(overhead),
    overheadByCategory: Array.from(byCat.entries()).map(([category, total]) => ({ category, total: round2(total) })).sort((a, b) => b.total - a.total),
    netProfit: round2(net),
    grossMarginPct: sales > 0 ? (grossBefore / sales) * 100 : null,
    marginAfterNcPct: sales > 0 ? (grossAfter / sales) * 100 : null,
    netMarginPct: sales > 0 ? (net / sales) * 100 : null,
    directPurchases: round2(direct),
  };
}

router.get("/costing/pnl", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const ym = monthOf(req.query.month);
  const pnl = await computePnl(ym);
  const { from, to } = monthDates(ym);
  const { orders } = await paidOrdersWithItems(from, to);
  const unpaidAccountSales = round2(orders.filter((o: any) => o._unpaid).reduce((s: number, o: any) => s + parseFloat(String(o.totalAmount)), 0));
  res.json({ ...pnl, unpaidAccountSales });
});

router.get("/costing/pnl-year", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const year = parseInt(String(req.query.year ?? ""), 10) || new Date().getFullYear();
  const months = [];
  for (let m = 1; m <= 12; m++) months.push(await computePnl(`${year}-${String(m).padStart(2, "0")}`));
  res.json({ year, months });
});

// ── Break-even: monthly overhead / gross margin ──
router.get("/costing/break-even", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const ym = monthOf(req.query.month);
  const cur = await computePnl(ym);
  const past: Awaited<ReturnType<typeof computePnl>>[] = [];
  for (let k = 1; k <= 3; k++) {
    const p = await computePnl(shiftMonth(ym, -k));
    if (p.sales > 0) past.push(p);
  }
  const pSales = past.reduce((s, p) => s + p.sales, 0);
  const pGross = past.reduce((s, p) => s + p.grossAfter, 0);
  const pDishes = past.reduce((s, p) => s + p.dishesSold, 0);
  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrent = ym === currentYm();
  res.json({
    month: ym,
    overhead: cur.overhead,
    overheadByCategory: cur.overheadByCategory,
    thisMonth: { sales: cur.sales, marginPct: cur.marginAfterNcPct, dishes: cur.dishesSold, avgDishPrice: cur.dishesSold > 0 ? cur.sales / cur.dishesSold : null },
    last3: past.length ? {
      months: past.length,
      avgOverhead: round2(past.reduce((s, p) => s + p.overhead, 0) / past.length),
      marginPct: pSales > 0 ? (pGross / pSales) * 100 : null,
      avgDishPrice: pDishes > 0 ? pSales / pDishes : null,
    } : null,
    daysInMonth, dayOfMonth: isCurrent ? new Date().getDate() : daysInMonth, isCurrent,
  });
});

// ── Every dish: selling price vs actual cost price ──
router.get("/costing/menu-summary", authenticate, requireAdminOrAccountant, async (req, res): Promise<void> => {
  const ym = monthOf(req.query.month);
  const ctx = await loadCostingContext();
  const rates = ratesFor(ctx, ym);
  const items = await db
    .select({ id: menuItemsTable.id, name: menuItemsTable.name, price: menuItemsTable.price, categoryName: menuCategoriesTable.name })
    .from(menuItemsTable)
    .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
    .orderBy(menuCategoriesTable.displayOrder, menuItemsTable.name);
  const rows: any[] = [];
  for (const it of items) {
    const price = parseFloat(String(it.price));
    const ing = await menuItemCosting(it.id);
    const op = itemOperating(ctx, it.id, price, rates);
    const actualCost = ing.totalCost + op.variable + op.fixed;
    rows.push({
      id: it.id, name: it.name, category: it.categoryName, price,
      ingredientCost: ing.totalCost, ingredientComplete: ing.complete,
      variable: op.variable, variableComplete: op.variableComplete, fixed: op.fixed, fixedComplete: op.fixedComplete,
      profileId: ctx.profileByItem.get(it.id) ?? null,
      actualCost, netProfit: price - actualCost, marginPct: price > 0 ? ((price - actualCost) / price) * 100 : null,
    });
  }
  res.json({ rows, rates });
});

export default router;