import { db, recipesTable, inventoryItemsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { expandUsage } from "./ingredientUsage";

const round4 = (n: number) => Math.round(n * 10000) / 10000;

// Full costing sheet for one menu item (cost of ONE serving). Composite ingredients
// (e.g. a sauce) are costed from the basic ingredients they are made of.
export async function menuItemCosting(menuItemId: number) {
  const rows = await db
    .select({
      inventoryItemId: recipesTable.inventoryItemId,
      quantityRequired: recipesTable.quantityRequired,
      wasteQuantity: recipesTable.wasteQuantity,
      ingredientName: inventoryItemsTable.name,
      unit: inventoryItemsTable.unit,
      costPerUnit: inventoryItemsTable.costPerUnit,
    })
    .from(recipesTable)
    .leftJoin(inventoryItemsTable, eq(recipesTable.inventoryItemId, inventoryItemsTable.id))
    .where(eq(recipesTable.menuItemId, menuItemId));

  const costCache = new Map<number, number | null>();
  const leafCost = async (id: number): Promise<number | null> => {
    if (!costCache.has(id)) {
      const [r] = await db.select({ c: inventoryItemsTable.costPerUnit }).from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
      costCache.set(id, r?.c == null ? null : parseFloat(String(r.c)));
    }
    return costCache.get(id) ?? null;
  };

  const lines: any[] = [];
  let totalCost = 0;
  let complete = rows.length > 0;

  for (const r of rows) {
    const qty = parseFloat(String(r.quantityRequired));
    const waste = parseFloat(String(r.wasteQuantity ?? 0));
    const totalQuantity = qty + waste;
    const leaves = await expandUsage(r.inventoryItemId, totalQuantity);
    const composite = !(leaves.length === 1 && leaves[0].inventoryItemId === r.inventoryItemId);

    let lineCost = 0;
    let lineComplete = leaves.length > 0;
    for (const leaf of leaves) {
      const c = await leafCost(leaf.inventoryItemId);
      if (c == null) lineComplete = false;
      else lineCost += c * leaf.quantity;
    }
    totalCost += lineCost;
    if (!lineComplete) complete = false;

    lines.push({
      inventoryItemId: r.inventoryItemId,
      ingredientName: r.ingredientName ?? "",
      unit: r.unit ?? "",
      quantityRequired: qty,
      wasteQuantity: waste,
      totalQuantity,
      costPerUnit: r.costPerUnit == null ? null : parseFloat(String(r.costPerUnit)),
      composite,
      lineCost: round4(lineCost),
      complete: lineComplete,
    });
  }
  return { lines, totalCost: round4(totalCost), complete };
}

// What gets saved on each order item at the moment of sale
export async function itemCostFields(menuItemId: number): Promise<{ unitCost: string | null; costComplete: boolean }> {
  const c = await menuItemCosting(menuItemId);
  if (c.lines.length === 0) return { unitCost: null, costComplete: false };
  return { unitCost: String(c.totalCost), costComplete: c.complete };
}