// Put a sale's ingredients back into stock (sign +1), or take them out again (sign -1), with a Stock Log line each.
// Same quantities as cancelling an order: recipe quantity plus prep waste, per unit sold.
import { inventoryItemsTable, inventoryLogsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { expandRecipeLines } from "./ingredientUsage";

type Recipes = Map<number, Awaited<ReturnType<typeof expandRecipeLines>>>;

// Read before the transaction: expandRecipeLines uses the shared connection, not the transaction's.
// shortcut: uses today's recipe, not the recipe on the day of the sale; fine until recipes are versioned.
export async function recipesFor(menuItemIds: number[]): Promise<Recipes> {
  const out: Recipes = new Map();
  for (const id of new Set(menuItemIds)) out.set(id, await expandRecipeLines(id));
  return out;
}

export async function moveStockForSold(tx: any, lines: { menuItemId: number; quantity: number }[], recipes: Recipes, sign: 1 | -1, reason: string, orderId: number, user: string) {
  for (const l of lines) {
    for (const r of recipes.get(l.menuItemId) ?? []) {
      const qty = (r.quantityRequired + r.wasteQuantity) * l.quantity * sign;
      if (!qty) continue;
      await tx.execute(sql`SELECT id FROM inventory_items WHERE id = ${r.inventoryItemId} FOR UPDATE`);
      const [inv] = await tx.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, r.inventoryItemId));
      if (!inv) continue;
      const before = parseFloat(String(inv.currentStock));
      const after = before + qty;
      await tx.update(inventoryItemsTable).set({ currentStock: String(after) }).where(eq(inventoryItemsTable.id, inv.id));
      await tx.insert(inventoryLogsTable).values({
        inventoryItemId: inv.id, changeAmount: String(qty), stockBefore: String(before), stockAfter: String(after),
        reason, menuItemId: l.menuItemId, orderId, changedBy: user,
      });
    }
  }
}
