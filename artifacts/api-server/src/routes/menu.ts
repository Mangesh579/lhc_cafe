import { Router } from "express";
import { db, menuCategoriesTable, menuItemsTable, recipesTable, inventoryItemsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router = Router();

// Categories
router.get("/menu-categories", authenticate, async (_req, res): Promise<void> => {
  const cats = await db.select().from(menuCategoriesTable).orderBy(menuCategoriesTable.displayOrder);
  res.json(cats);
});

router.post("/menu-categories", authenticate, async (req, res): Promise<void> => {
  const { name, displayOrder } = req.body;
  if (!name) { res.status(400).json({ error: "Name required" }); return; }
  const [cat] = await db.insert(menuCategoriesTable).values({ name, displayOrder: displayOrder ?? 0 }).returning();
  res.status(201).json(cat);
});

router.patch("/menu-categories/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, displayOrder } = req.body;
  const [cat] = await db.update(menuCategoriesTable).set({ ...(name && { name }), ...(displayOrder !== undefined && { displayOrder }) }).where(eq(menuCategoriesTable.id, id)).returning();
  if (!cat) { res.status(404).json({ error: "Category not found" }); return; }
  res.json(cat);
});

router.delete("/menu-categories/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(menuCategoriesTable).where(eq(menuCategoriesTable.id, id));
  res.sendStatus(204);
});

// Menu Items
router.get("/menu-items", authenticate, async (req, res): Promise<void> => {
  const { categoryId, available } = req.query;
  const items = await db
    .select({
      id: menuItemsTable.id,
      name: menuItemsTable.name,
      description: menuItemsTable.description,
      price: menuItemsTable.price,
      categoryId: menuItemsTable.categoryId,
      categoryName: menuCategoriesTable.name,
      isAvailable: menuItemsTable.isAvailable,
      imageUrl: menuItemsTable.imageUrl,
      calories: menuItemsTable.calories,
      createdAt: menuItemsTable.createdAt,
    })
    .from(menuItemsTable)
    .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
    .where(
      and(
        categoryId ? eq(menuItemsTable.categoryId, parseInt(categoryId as string, 10)) : undefined,
        available === "true" ? eq(menuItemsTable.isAvailable, true) : undefined,
      )
    )
    .orderBy(menuCategoriesTable.displayOrder, menuItemsTable.name);
  res.json(items);
});

router.post("/menu-items", authenticate, async (req, res): Promise<void> => {
  const { name, description, price, categoryId, isAvailable, imageUrl, calories } = req.body;
  if (!name || price === undefined) { res.status(400).json({ error: "Name and price required" }); return; }
  const [item] = await db.insert(menuItemsTable).values({
    name, description, price: String(price),
    categoryId: categoryId ?? null, isAvailable: isAvailable ?? true,
    imageUrl: imageUrl ?? null, calories: calories ?? null,
  }).returning();
  res.status(201).json({ ...item, categoryName: null });
});

router.get("/menu-items/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [item] = await db
    .select({
      id: menuItemsTable.id,
      name: menuItemsTable.name,
      description: menuItemsTable.description,
      price: menuItemsTable.price,
      categoryId: menuItemsTable.categoryId,
      categoryName: menuCategoriesTable.name,
      isAvailable: menuItemsTable.isAvailable,
      imageUrl: menuItemsTable.imageUrl,
      calories: menuItemsTable.calories,
      createdAt: menuItemsTable.createdAt,
    })
    .from(menuItemsTable)
    .leftJoin(menuCategoriesTable, eq(menuItemsTable.categoryId, menuCategoriesTable.id))
    .where(eq(menuItemsTable.id, id));
  if (!item) { res.status(404).json({ error: "Menu item not found" }); return; }

  const recipes = await db
    .select({
      menuItemId: recipesTable.menuItemId,
      inventoryItemId: recipesTable.inventoryItemId,
      ingredientName: inventoryItemsTable.name,
      unit: inventoryItemsTable.unit,
      quantityRequired: recipesTable.quantityRequired,
      caloriesPerUnit: inventoryItemsTable.caloriesPerUnit,
    })
    .from(recipesTable)
    .leftJoin(inventoryItemsTable, eq(recipesTable.inventoryItemId, inventoryItemsTable.id))
    .where(eq(recipesTable.menuItemId, id));

  res.json({ ...item, recipes });
});

router.patch("/menu-items/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, description, price, categoryId, isAvailable, imageUrl, calories } = req.body;
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (price !== undefined) updateData.price = String(price);
  if (categoryId !== undefined) updateData.categoryId = categoryId;
  if (isAvailable !== undefined) updateData.isAvailable = isAvailable;
  if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
  if (calories !== undefined) updateData.calories = calories;

  const [item] = await db.update(menuItemsTable).set(updateData).where(eq(menuItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Menu item not found" }); return; }
  res.json({ ...item, categoryName: null });
});

router.delete("/menu-items/:id", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(recipesTable).where(eq(recipesTable.menuItemId, id));
  await db.delete(menuItemsTable).where(eq(menuItemsTable.id, id));
  res.sendStatus(204);
});

// Recipes
router.get("/menu-items/:id/recipes", authenticate, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const recipes = await db
    .select({
      menuItemId: recipesTable.menuItemId,
      inventoryItemId: recipesTable.inventoryItemId,
      ingredientName: inventoryItemsTable.name,
      unit: inventoryItemsTable.unit,
      quantityRequired: recipesTable.quantityRequired,
      caloriesPerUnit: inventoryItemsTable.caloriesPerUnit,
    })
    .from(recipesTable)
    .leftJoin(inventoryItemsTable, eq(recipesTable.inventoryItemId, inventoryItemsTable.id))
    .where(eq(recipesTable.menuItemId, id));
  res.json(recipes);
});

router.post("/menu-items/:id/recipes", authenticate, async (req, res): Promise<void> => {
  const menuItemId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { inventoryItemId, quantityRequired } = req.body;
  if (!inventoryItemId || !quantityRequired) { res.status(400).json({ error: "inventoryItemId and quantityRequired required" }); return; }
  const [recipe] = await db.insert(recipesTable).values({
    menuItemId, inventoryItemId, quantityRequired: String(quantityRequired),
  }).onConflictDoUpdate({ target: [recipesTable.menuItemId, recipesTable.inventoryItemId], set: { quantityRequired: String(quantityRequired) } }).returning();
  const [inv] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, inventoryItemId));
  res.status(201).json({ ...recipe, ingredientName: inv?.name ?? "", unit: inv?.unit ?? "", caloriesPerUnit: inv?.caloriesPerUnit ?? null });
});

router.patch("/menu-items/:id/recipes/:ingredientId", authenticate, async (req, res): Promise<void> => {
  const menuItemId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const ingredientId = parseInt(Array.isArray(req.params.ingredientId) ? req.params.ingredientId[0] : req.params.ingredientId, 10);
  const { quantityRequired } = req.body;
  const [recipe] = await db.update(recipesTable)
    .set({ quantityRequired: String(quantityRequired) })
    .where(and(eq(recipesTable.menuItemId, menuItemId), eq(recipesTable.inventoryItemId, ingredientId)))
    .returning();
  if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }
  const [inv] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, ingredientId));
  res.json({ ...recipe, ingredientName: inv?.name ?? "", unit: inv?.unit ?? "", caloriesPerUnit: inv?.caloriesPerUnit ?? null });
});

router.delete("/menu-items/:id/recipes/:ingredientId", authenticate, async (req, res): Promise<void> => {
  const menuItemId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const ingredientId = parseInt(Array.isArray(req.params.ingredientId) ? req.params.ingredientId[0] : req.params.ingredientId, 10);
  await db.delete(recipesTable).where(and(eq(recipesTable.menuItemId, menuItemId), eq(recipesTable.inventoryItemId, ingredientId)));
  res.sendStatus(204);
});

export default router;
