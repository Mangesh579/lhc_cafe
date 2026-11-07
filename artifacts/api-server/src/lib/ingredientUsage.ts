import { db, recipesTable, inventoryItemsTable, ingredientComponentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type Leaf = { inventoryItemId: number; quantity: number };

// Breaks an ingredient quantity down into the basic ingredients it is made of.
export async function expandUsage(inventoryItemId: number, quantity: number, trail: number[] = []): Promise<Leaf[]> {
  if (trail.includes(inventoryItemId) || trail.length > 6) return [{ inventoryItemId, quantity }];
  const components = await db.select().from(ingredientComponentsTable).where(eq(ingredientComponentsTable.parentItemId, inventoryItemId));
  if (components.length === 0) return [{ inventoryItemId, quantity }];

  const [parent] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, inventoryItemId));
  const batchYield = parseFloat(String((parent as any)?.batchYield ?? 1)) || 1;
  const factor = quantity / batchYield;

  const out: Leaf[] = [];
  for (const c of components) {
    out.push(...await expandUsage(c.childItemId, parseFloat(String(c.quantity)) * factor, [...trail, inventoryItemId]));
  }
  return out;
}

// A menu item's recipe lines, with composite ingredients replaced by their basic ingredients.
export async function expandRecipeLines(menuItemId: number) {
  const lines = await db.select().from(recipesTable).where(eq(recipesTable.menuItemId, menuItemId));
  const merged = new Map<number, { inventoryItemId: number; quantityRequired: number; wasteQuantity: number }>();
  const add = (id: number, qty: number, waste: number) => {
    const cur = merged.get(id) ?? { inventoryItemId: id, quantityRequired: 0, wasteQuantity: 0 };
    cur.quantityRequired += qty;
    cur.wasteQuantity += waste;
    merged.set(id, cur);
  };

  for (const line of lines) {
    const qty = parseFloat(String(line.quantityRequired));
    const waste = parseFloat(String((line as any).wasteQuantity ?? 0));
    for (const leaf of await expandUsage(line.inventoryItemId, qty)) add(leaf.inventoryItemId, leaf.quantity, 0);
    if (waste > 0) for (const leaf of await expandUsage(line.inventoryItemId, waste)) add(leaf.inventoryItemId, 0, leaf.quantity);
  }
  return Array.from(merged.values());
}