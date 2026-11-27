// Put a sale's ingredients back into stock, or take them out again, with a Stock Log line each.
import { inventoryItemsTable, inventoryLogsTable, orderItemsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { expandRecipeLines } from "./ingredientUsage";

type Recipes = Map<number, Awaited<ReturnType<typeof expandRecipeLines>>>;

// Read before the transaction: expandRecipeLines uses the shared connection, not the transaction's.
// Today's recipe is only the fallback (see restoreSaleStock).
export async function recipesFor(menuItemIds: number[]): Promise<Recipes> {
  const out: Recipes = new Map();
  for (const id of new Set(menuItemIds)) out.set(id, await expandRecipeLines(id));
  return out;
}

async function moveOne(tx: any, inventoryItemId: number, qty: number, reason: string, menuItemId: number | null, orderId: number, user: string) {
  if (!qty) return;
  await tx.execute(sql`SELECT id FROM inventory_items WHERE id = ${inventoryItemId} FOR UPDATE`);
  const [inv] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, inventoryItemId));
  if (!inv) return;
  const before = parseFloat(String(inv.currentStock));
  const after = before + qty;
  await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, inv.id));
  await tx.insert(inventoryLogsTable).values({
    inventoryItemId: inv.id, changeAmount: String(qty), stockBefore: String(before), stockAfter: String(after),
    reason, menuItemId, orderId, changedBy: user,
  });
}

// By today's recipe (recipe quantity plus prep waste, per unit sold), sign +1 puts back, -1 takes out
export async function moveStockForSold(tx: any, lines: { menuItemId: number; quantity: number }[], recipes: Recipes, sign: 1 | -1, reason: string, orderId: number, user: string) {
  for (const l of lines) {
    for (const r of recipes.get(l.menuItemId) ?? []) await moveOne(tx, r.inventoryItemId, (r.quantityRequired + r.wasteQuantity) * l.quantity * sign, reason, l.menuItemId, orderId, user);
  }
}

// "Not served" (2026-11-27): put back what the sale actually took out. For each credited menu item, the Stock Log lines the
// order recorded for it ("Order #..." lines: the sale, its prep waste, less any KOT cancelled) give the quantity per unit
// still sold, so a part credit puts back its share. Older orders whose Stock Log lines have no menu item (or no lines at all)
// fall back to today's recipe. Returns which menu items were restored each way.
export async function restoreSaleStock(tx: any, orderId: number, lines: { menuItemId: number; quantity: number }[], recipes: Recipes, reason: string, user: string): Promise<{ fromSale: number[]; fromRecipe: number[] }> {
  const logs = await tx.select().from(inventoryLogsTable).where(and(eq(inventoryLogsTable.orderId, orderId), sql`${inventoryLogsTable.reason} LIKE 'Order #%'`));
  const items = await tx.select({ menuItemId: orderItemsTable.menuItemId, quantity: orderItemsTable.quantity }).from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const out = { fromSale: [] as number[], fromRecipe: [] as number[] };
  for (const l of lines) {
    const mine = logs.filter((g: any) => g.menuItemId === l.menuItemId);
    const sold = items.filter((i: any) => i.menuItemId === l.menuItemId).reduce((s: number, i: any) => s + Number(i.quantity), 0);
    if (!mine.length || !(sold > 0)) { await moveStockForSold(tx, [l], recipes, 1, reason, orderId, user); out.fromRecipe.push(l.menuItemId); continue; }
    const taken = new Map<number, number>();
    for (const g of mine) taken.set(g.inventoryItemId, (taken.get(g.inventoryItemId) ?? 0) - parseFloat(String(g.changeAmount)));
    for (const [inventoryItemId, qty] of taken) if (qty > 0) await moveOne(tx, inventoryItemId, Math.round(qty * l.quantity / sold * 10000) / 10000, reason, l.menuItemId, orderId, user);
    out.fromSale.push(l.menuItemId);
  }
  return out;
}

// Voiding a "not served" cancel note: take out exactly what that note put back (its Stock Log lines name the note number).
// Returns how many lines were reversed (0 if none were found).
export async function reverseNoteStock(tx: any, orderId: number, noteNo: string, reason: string, user: string): Promise<number> {
  const logs = await tx.select().from(inventoryLogsTable).where(and(eq(inventoryLogsTable.orderId, orderId), sql`${inventoryLogsTable.reason} LIKE ${"%(" + noteNo + ")%"}`, sql`${inventoryLogsTable.changeAmount} > 0`));
  for (const g of logs) await moveOne(tx, g.inventoryItemId, -parseFloat(String(g.changeAmount)), reason, g.menuItemId, orderId, user);
  return logs.length;
}
