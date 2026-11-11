import { db, ordersTable, orderItemsTable, menuItemsTable, expensesTable, operatingResourcesTable, operatingProfilesTable, operatingProfileUsageTable, costingSettingsTable } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";

export const SALARY_CATEGORY = "Employee salaries and wages";
export const ELECTRICITY_CATEGORY = "Electricity";

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export const ymOf = (x: Date | string) => {
  const d = new Date(x);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const currentYm = () => ymOf(new Date());
export function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  return ymOf(new Date(y, m - 1 + delta, 1));
}

export type Settings = { allocationMethod: "per_dish" | "by_sales"; expectedMonthlyDishes: number | null; includeOneTime: boolean; volumeBasis: "auto" | "month" | "manual"; volumeMonth: string | null };
type Bucket = { salary: number; electricity: number; other: number };

export type MonthRates = {
  ym: string;
  method: Settings["allocationMethod"];
  available: boolean;
  expectedDishes: number | null;
  expectedSales: number | null;
  volumeSource: string;
  pool: Bucket & { total: number };
  estimatedBuckets: string[];
  perDish: Bucket;
  pct: Bucket;
};

export type CostingContext = {
  settings: Settings;
  resources: Map<number, { id: number; name: string; unit: string; unitCost: number | null; expenseCategory: string | null }>;
  usageByProfile: Map<number, { resourceId: number; quantity: number }[]>;
  profileByItem: Map<number, number | null>;
  indirect: { expenseDate: string; category: string; amount: number; isRecurring: boolean }[];
  volume: Map<string, { dishes: number; value: number }>;
  ratesCache: Map<string, MonthRates>;
};

let costingCache: { at: number; ctx: CostingContext } | null = null;
export async function loadCostingContext(): Promise<CostingContext> {
  if (costingCache && Date.now() - costingCache.at < 15000) return { ...costingCache.ctx, ratesCache: new Map() };
  const ctx = await loadCostingContextFresh();
  costingCache = { at: Date.now(), ctx };
  return { ...ctx, ratesCache: new Map() };
}

async function loadCostingContextFresh(): Promise<CostingContext> {
  const [s] = await db.select().from(costingSettingsTable).where(eq(costingSettingsTable.id, 1));
  const settings: Settings = {
    allocationMethod: s?.allocationMethod === "by_sales" ? "by_sales" : "per_dish",
    expectedMonthlyDishes: s?.expectedMonthlyDishes ?? null,
    includeOneTime: s?.includeOneTime ?? true,
    volumeBasis: s?.volumeBasis === "month" || s?.volumeBasis === "manual" ? (s.volumeBasis as "month" | "manual") : "auto",
    volumeMonth: s?.volumeMonth ?? null,
  };

  const resRows = await db.select().from(operatingResourcesTable).orderBy(operatingResourcesTable.sortOrder, operatingResourcesTable.id);
  const resources: CostingContext["resources"] = new Map();
  for (const r of resRows) resources.set(r.id, { id: r.id, name: r.name, unit: r.unit, unitCost: r.unitCost == null ? null : parseFloat(String(r.unitCost)), expenseCategory: r.expenseCategory ?? null });

  const usageRows = await db.select().from(operatingProfileUsageTable);
  const usageByProfile: CostingContext["usageByProfile"] = new Map();
  for (const u of usageRows) usageByProfile.set(u.profileId, [...(usageByProfile.get(u.profileId) ?? []), { resourceId: u.resourceId, quantity: parseFloat(String(u.quantity)) }]);

  const itemRows = await db.select({ id: menuItemsTable.id, profileId: menuItemsTable.operatingProfileId }).from(menuItemsTable);
  const profileByItem: CostingContext["profileByItem"] = new Map();
  for (const i of itemRows) profileByItem.set(i.id, i.profileId ?? null);

  const ex = await db.select().from(expensesTable).where(and(eq(expensesTable.status, "active"), eq(expensesTable.type, "indirect")));
  const indirect = ex.map(e => ({ expenseDate: e.expenseDate, category: e.category, amount: parseFloat(String(e.amount)), isRecurring: e.isRecurring }));

  const monthExpr = sql`to_char(CASE WHEN ${ordersTable.accountBill} = true AND ${ordersTable.backdatedAt} IS NULL AND ${orderItemsTable.kotAt} IS NOT NULL THEN ${orderItemsTable.kotAt} ELSE COALESCE(${ordersTable.backdatedAt}, ${ordersTable.createdAt}) END, 'YYYY-MM')`;
  const volRows = await db
    .select({
      ym: sql<string>`${monthExpr}`,
      dishes: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)`,
      value: sql<number>`COALESCE(SUM(CAST(${orderItemsTable.subtotal} AS NUMERIC)), 0)`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(sql`(${ordersTable.paymentStatus} = 'paid' OR (${ordersTable.accountBill} = true AND ${ordersTable.paymentStatus} = 'pending' AND ${ordersTable.orderStatus} <> 'cancelled'))`)
    .groupBy(monthExpr);
  const volume: CostingContext["volume"] = new Map();
  for (const v of volRows) volume.set(String(v.ym), { dishes: Number(v.dishes), value: Number(v.value) });

  return { settings, resources, usageByProfile, profileByItem, indirect, volume, ratesCache: new Map() };
}

// Monthly overhead pool and the per-dish (or % of sales) rate for one month
export function monthRates(ctx: CostingContext, ym: string): MonthRates {
  const resourceCats = new Set(Array.from(ctx.resources.values()).map(r => r.expenseCategory).filter(Boolean) as string[]);
  const bucketOf = (c: string): keyof Bucket => (c === SALARY_CATEGORY ? "salary" : c === ELECTRICITY_CATEGORY ? "electricity" : "other");
  const poolFor = (m: string): Bucket => {
    const b: Bucket = { salary: 0, electricity: 0, other: 0 };
    for (const r of ctx.indirect) {
      if (r.expenseDate.slice(0, 7) !== m) continue;
      if (resourceCats.has(r.category)) continue; // already covered by the per-dish operating estimate
      if (!ctx.settings.includeOneTime && !r.isRecurring) continue;
      b[bucketOf(r.category)] += r.amount;
    }
    return b;
  };

  const now = currentYm();
  const isOpen = ym >= now;
  const pool = poolFor(ym);
  const estimatedBuckets: string[] = [];
  if (isOpen) {
    const prev = poolFor(shiftMonth(ym, -1));
    (["salary", "electricity", "other"] as (keyof Bucket)[]).forEach(k => {
      if (pool[k] === 0 && prev[k] > 0) { pool[k] = prev[k]; estimatedBuckets.push(k); }
    });
  }
  const total = pool.salary + pool.electricity + pool.other;

  const own = ctx.volume.get(ym);
  const prevVols = [1, 2, 3].map(k => ctx.volume.get(shiftMonth(ym, -k))).filter(v => v && v.dishes > 0) as { dishes: number; value: number }[];
  const avg = (f: (v: { dishes: number; value: number }) => number) => prevVols.reduce((s, v) => s + f(v), 0) / prevVols.length;

  let expectedDishes: number | null = null, expectedSales: number | null = null, volumeSource = "none";
  if (!isOpen && own && own.dishes > 0) { expectedDishes = own.dishes; expectedSales = own.value; volumeSource = "actual dishes sold that month"; }
  else {
    const chosen = ctx.settings.volumeBasis === "month" && ctx.settings.volumeMonth ? ctx.volume.get(ctx.settings.volumeMonth) : undefined;
    if (chosen && chosen.dishes > 0) { expectedDishes = chosen.dishes; expectedSales = chosen.value; volumeSource = `dishes sold in ${ctx.settings.volumeMonth}`; }
    else if (ctx.settings.volumeBasis === "manual" && ctx.settings.expectedMonthlyDishes && ctx.settings.expectedMonthlyDishes > 0) { expectedDishes = ctx.settings.expectedMonthlyDishes; volumeSource = "the number you entered"; }
    else if (prevVols.length) { expectedDishes = avg(v => v.dishes); volumeSource = `average of the previous ${prevVols.length} month${prevVols.length === 1 ? "" : "s"}`; }
    else if (own && own.dishes > 0) { expectedDishes = own.dishes; volumeSource = "dishes sold so far this month"; }
    if (chosen && chosen.dishes > 0) { /* sales already taken from the chosen month */ }
    else if (prevVols.length) expectedSales = avg(v => v.value);
    else if (own && own.value > 0) expectedSales = own.value;
    if (!expectedSales && expectedDishes && own && own.dishes > 0) expectedSales = (own.value / own.dishes) * expectedDishes;
  }

  const zero: Bucket = { salary: 0, electricity: 0, other: 0 };
  let perDish = zero, pct = zero, available = false;
  if (ctx.settings.allocationMethod === "per_dish" && expectedDishes && expectedDishes > 0) {
    available = true;
    perDish = { salary: pool.salary / expectedDishes, electricity: pool.electricity / expectedDishes, other: pool.other / expectedDishes };
  } else if (ctx.settings.allocationMethod === "by_sales" && expectedSales && expectedSales > 0) {
    available = true;
    pct = { salary: pool.salary / expectedSales, electricity: pool.electricity / expectedSales, other: pool.other / expectedSales };
  }
  return { ym, method: ctx.settings.allocationMethod, available, expectedDishes, expectedSales, volumeSource, pool: { ...pool, total }, estimatedBuckets, perDish, pct };
}

// ── Reports count a monthly-account bill per KOT, on the day each KOT was ordered ──
// true: sales on monthly accounts count when ordered, even before the customer pays. false: only once paid.
export const INCLUDE_UNPAID_ACCOUNTS = true;

export type ReportEntry = { order: any; items: any[]; date: Date; revenue: number; paid: boolean };

export function itemReportDate(order: any, item: any): Date {
  if (order.backdatedAt) return new Date(order.backdatedAt);
  if (order.accountBill && item?.kotAt) return new Date(item.kotAt);
  return new Date(order.createdAt);
}

// A normal order is one entry. An account bill is one entry per KOT; its net revenue (after discount, without VAT)
// is shared between the KOTs by the value of their items.
export function orderEntries(order: any, items: any[]): ReportEntry[] {
  const total = parseFloat(String(order.totalAmount ?? 0));
  const vat = parseFloat(String(order.vatAmount ?? 0));
  const net = order.isNc ? 0 : Math.max(0, total - vat);
  const paid = order.paymentStatus === "paid";
  if (!order.accountBill || order.backdatedAt) {
    return [{ order, items, date: new Date(order.backdatedAt ?? order.createdAt), revenue: net, paid }];
  }
  const groups = new Map<number, any[]>();
  for (const it of items) { const k = it.kotNumber ?? 1; groups.set(k, [...(groups.get(k) ?? []), it]); }
  const value = (list: any[]) => list.reduce((s, i) => s + parseFloat(String(i.subtotal ?? 0)), 0);
  const all = value(items);
  return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]).map(([, list]) => ({
    order, items: list, date: itemReportDate(order, list[0]),
    revenue: all > 0 ? net * (value(list) / all) : 0, paid,
  }));
}

export async function reportEntries(from: Date, to: Date, opts: { accountOnly?: boolean } = {}): Promise<ReportEntry[]> {
  const normalPart = opts.accountOnly
    ? sql`false`
    : sql`(${ordersTable.accountBill} = false AND ${ordersTable.paymentStatus} = 'paid' AND COALESCE(${ordersTable.backdatedAt}, ${ordersTable.createdAt}) >= ${from} AND COALESCE(${ordersTable.backdatedAt}, ${ordersTable.createdAt}) <= ${to})`;
  const accountStatus = INCLUDE_UNPAID_ACCOUNTS
    ? sql`(${ordersTable.paymentStatus} = 'paid' OR (${ordersTable.paymentStatus} = 'pending' AND ${ordersTable.orderStatus} <> 'cancelled'))`
    : sql`${ordersTable.paymentStatus} = 'paid'`;
  const accountPart = sql`(${ordersTable.accountBill} = true AND ${ordersTable.backdatedAt} IS NULL AND ${accountStatus} AND ${ordersTable.id} IN (SELECT ${orderItemsTable.orderId} FROM ${orderItemsTable} WHERE ${orderItemsTable.kotAt} >= ${from} AND ${orderItemsTable.kotAt} <= ${to}))`;

  const orders = await db.select().from(ordersTable).where(sql`(${normalPart} OR ${accountPart})`);
  const ids = orders.map(o => o.id);
  const items = ids.length ? await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, ids)) : [];
  const byOrder = new Map<number, any[]>();
  for (const it of items) byOrder.set(it.orderId, [...(byOrder.get(it.orderId) ?? []), it]);

  const out: ReportEntry[] = [];
  for (const o of orders) for (const e of orderEntries(o, byOrder.get(o.id) ?? [])) if (e.date >= from && e.date <= to) out.push(e);
  return out;
}

export function ratesFor(ctx: CostingContext, ym: string): MonthRates {
  let r = ctx.ratesCache.get(ym);
  if (!r) { r = monthRates(ctx, ym); ctx.ratesCache.set(ym, r); }
  return r;
}

// Operating cost of ONE serving: variable (gas, oil, water, soap) plus its share of monthly overhead
export function itemOperating(ctx: CostingContext, menuItemId: number, unitPrice: number, rates: MonthRates) {
  const profileId = ctx.profileByItem.get(menuItemId) ?? null;
  const resources: { resource: string; unit: string; quantity: number; cost: number }[] = [];
  let variable = 0;
  let variableComplete = profileId != null;
  if (profileId != null) {
    for (const u of ctx.usageByProfile.get(profileId) ?? []) {
      const r = ctx.resources.get(u.resourceId);
      if (!r || !(u.quantity > 0)) continue;
      if (r.unitCost == null) variableComplete = false;
      const cost = u.quantity * (r.unitCost ?? 0);
      variable += cost;
      resources.push({ resource: r.name, unit: r.unit, quantity: u.quantity, cost: round4(cost) });
    }
  }
  const share = (b: keyof Bucket) => (rates.available ? (rates.method === "per_dish" ? rates.perDish[b] : unitPrice * rates.pct[b]) : 0);
  const salary = round4(share("salary")), electricity = round4(share("electricity")), other = round4(share("other"));
  return {
    profileAssigned: profileId != null, resources, variable: round4(variable), variableComplete,
    salary, electricity, other, fixed: round4(salary + electricity + other), fixedComplete: rates.available,
  };
}

export async function menuItemOperating(menuItemId: number, price: number, ym: string = currentYm()) {
  const ctx = await loadCostingContext();
  const op = itemOperating(ctx, menuItemId, price, ratesFor(ctx, ym));
  const pid = ctx.profileByItem.get(menuItemId) ?? null;
  let profileName: string | null = null;
  if (pid != null) {
    const [p] = await db.select().from(operatingProfilesTable).where(eq(operatingProfilesTable.id, pid));
    profileName = p?.name ?? null;
  }
  return { ...op, profileName };
}

// Revenue and the three cost layers for one paid order
export function evaluateOrder(ctx: CostingContext, order: any, items: any[]) {
  const rates = ratesFor(ctx, ymOf(order.backdatedAt ?? order.createdAt));
  let ingredient = 0, variable = 0, fixed = 0;
  let ingredientOk = items.length > 0, opOk = items.length > 0;
  const resourceCost = new Map<string, number>();
  for (const i of items) {
    const q = Number(i.quantity);
    ingredient += parseFloat(String(i.unitCost ?? 0)) * q;
    if (!(i.unitCost != null && i.costComplete)) ingredientOk = false;
    const op = itemOperating(ctx, i.menuItemId, parseFloat(String(i.unitPrice ?? 0)), rates);
    variable += op.variable * q;
    fixed += op.fixed * q;
    for (const r of op.resources) resourceCost.set(r.resource, (resourceCost.get(r.resource) ?? 0) + r.cost * q);
    if (!(op.variableComplete && op.fixedComplete)) opOk = false;
  }
  const total = parseFloat(String(order.totalAmount ?? 0));
  const vat = parseFloat(String(order.vatAmount ?? 0));
  const revenue = order.isNc ? 0 : Math.max(0, total - vat);
  return { revenue, ingredient, variable, fixed, ingredientOk, opOk, isNc: !!order.isNc, resourceCost };
}

// Adds opCost to every item of every order (Order Log, admin and accountant only)
export async function attachOperatingCosts(orders: any[]) {
  const ctx = await loadCostingContext();
  for (const o of orders) {
    const rates = ratesFor(ctx, ymOf(o.backdatedAt ?? o.createdAt));
    for (const i of o.items ?? []) i.opCost = itemOperating(ctx, i.menuItemId, parseFloat(String(i.unitPrice ?? 0)), o.accountBill && !o.backdatedAt && i.kotAt ? ratesFor(ctx, ymOf(i.kotAt)) : rates);
  }
}