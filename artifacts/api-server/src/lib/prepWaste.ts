import { db, recipesTable, inventoryItemsTable, inventoryLogsTable, wasteLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { expandRecipeLines } from "./ingredientUsage";

// Deducts each recipe line's per-serving waste quantity from inventory and
// records it in both the Stock Log and the Waste Log, linked to the order.
export async function applyPrepWaste(
  orderId: number,
  items: Array<{ menuItemId: number; quantity: number }>,
  orderLabel: string,
  changedBy: string,
  kotNumber: number = 1,
): Promise<void> {
  for (const item of items) {
    const recipes = await expandRecipeLines(item.menuItemId);
    for (const recipe of recipes) {
      const wasteQty = parseFloat(String((recipe as any).wasteQuantity ?? 0)) * item.quantity;
      if (!(wasteQty > 0)) continue;
      const [inv] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, recipe.inventoryItemId));
      if (!inv) continue;

      const stockBefore = parseFloat(String(inv.currentStock));
      const stockAfter = stockBefore - wasteQty;
      await db.update(inventoryItemsTable).set({ currentStock: String(stockAfter) }).where(eq(inventoryItemsTable.id, inv.id));

      await db.insert(inventoryLogsTable).values({
        inventoryItemId: inv.id,
        changeAmount: String(-wasteQty),
        stockBefore: String(stockBefore),
        stockAfter: String(stockAfter),
        reason: `${orderLabel} — prep waste`,
        menuItemId: item.menuItemId,
        orderId,
      });

      await db.insert(wasteLogsTable).values({
        inventoryItemId: inv.id,
        menuItemId: item.menuItemId,
        itemName: inv.name,
        quantity: String(wasteQty),
        unit: inv.unit,
        reason: `Prep waste — ${orderLabel}`,
        wasteValue: "0",
        department: inv.department,
        kotNumber,
        orderId,
        changedBy,
      });
    }
  }
}