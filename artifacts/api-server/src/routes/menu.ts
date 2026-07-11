import { Router } from "express";
import { db, menuCategoriesTable, menuItemsTable, recipesTable, inventoryItemsTable, menuChangelogsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/auth";
import type { Response } from "express";

const router = Router();

// ─── Categories ───────────────────────────────────────────────────────────────

router.get("/menu-categories", authenticate, async (_req, res): Promise<void> => {
  const cats = await db.select().from(menuCategoriesTable).orderBy(menuCategoriesTable.displayOrder);
  res.json(cats);
});

router.post("/menu-categories", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, displayOrder } = req.body;
  if (!name) { res.status(400).json({ error: "Name required" }); return; }
  const [cat] = await db.insert(menuCategoriesTable).values({ name, displayOrder: displayOrder ?? 0 }).returning();
  await db.insert(menuChangelogsTable).values({ categoryId: cat.id, action: "category_created", newValue: name, changedBy: req.user?.username ?? "admin" });
  res.status(201).json(cat);
});

router.patch("/menu-categories/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, displayOrder } = req.body;
  const [cat] = await db.update(menuCategoriesTable).set({ ...(name && { name }), ...(displayOrder !== undefined && { displayOrder }) }).where(eq(menuCategoriesTable.id, id)).returning();
  if (!cat) { res.status(404).json({ error: "Category not found" }); return; }
  await db.insert(menuChangelogsTable).values({ categoryId: id, action: "category_updated", newValue: name, changedBy: req.user?.username ?? "admin" });
  res.json(cat);
});

router.delete("/menu-categories/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [cat] = await db.select().from(menuCategoriesTable).where(eq(menuCategoriesTable.id, id));
  if (cat) await db.insert(menuChangelogsTable).values({ categoryId: id, action: "category_deleted", oldValue: cat.name, changedBy: req.user?.username ?? "admin" });
  await db.delete(menuCategoriesTable).where(eq(menuCategoriesTable.id, id));
  res.sendStatus(204);
});

// ─── Menu Items ────────────────────────────────────────────────────────────────

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
      videoUrl: menuItemsTable.videoUrl,
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

router.post("/menu-items", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, description, price, categoryId, isAvailable, imageUrl, videoUrl, calories } = req.body;
  if (!name || price === undefined) { res.status(400).json({ error: "Name and price required" }); return; }
  const [item] = await db.insert(menuItemsTable).values({
    name, description: description ?? null, price: String(price),
    categoryId: categoryId ?? null, isAvailable: isAvailable ?? true,
    imageUrl: imageUrl ?? null, videoUrl: videoUrl ?? null, calories: calories ?? null,
  }).returning();
  await db.insert(menuChangelogsTable).values({ menuItemId: item.id, action: "item_created", newValue: `${name} @ Rs.${price}`, changedBy: req.user?.username ?? "admin" });
  const [cat] = item.categoryId ? await db.select().from(menuCategoriesTable).where(eq(menuCategoriesTable.id, item.categoryId)) : [null];
  res.status(201).json({ ...item, categoryName: cat?.name ?? null });
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
      videoUrl: menuItemsTable.videoUrl,
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

router.patch("/menu-items/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  // console.log("PATCH menu-items body:", JSON.stringify(req.body));
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, description, price, categoryId, isAvailable, imageUrl, videoUrl, calories } = req.body;
  const updateData: Record<string, unknown> = {};
  console.log("PATCH menu-item body:", JSON.stringify(req.body));
  console.log("videoUrl value:", videoUrl);
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (price !== undefined) updateData.price = String(price);
  if (categoryId !== undefined) updateData.categoryId = categoryId;
  if (isAvailable !== undefined) updateData.isAvailable = isAvailable;
  if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
  if (videoUrl !== undefined) updateData.videoUrl = videoUrl;
  if (calories !== undefined) updateData.calories = calories;

  const [before] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, id));
  const [item] = await db.update(menuItemsTable).set(updateData).where(eq(menuItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Menu item not found" }); return; }

  // Log the change
  if (isAvailable !== undefined && isAvailable !== before?.isAvailable) {
    await db.insert(menuChangelogsTable).values({ menuItemId: id, action: "availability_changed", fieldChanged: "isAvailable", oldValue: String(before?.isAvailable), newValue: String(isAvailable), changedBy: req.user?.username ?? "admin" });
  } else {
    const changedFields = Object.keys(updateData).join(", ");
    await db.insert(menuChangelogsTable).values({ menuItemId: id, action: "item_updated", fieldChanged: changedFields, newValue: name ?? price?.toString(), changedBy: req.user?.username ?? "admin" });
  }

  const [cat] = item.categoryId ? await db.select().from(menuCategoriesTable).where(eq(menuCategoriesTable.id, item.categoryId)) : [null];
  res.json({ ...item, categoryName: cat?.name ?? null });
});

router.delete("/menu-items/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [before] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, id));
  await db.delete(recipesTable).where(eq(recipesTable.menuItemId, id));
  await db.delete(menuItemsTable).where(eq(menuItemsTable.id, id));
  if (before) await db.insert(menuChangelogsTable).values({ menuItemId: id, action: "item_deleted", oldValue: before.name, changedBy: req.user?.username ?? "admin" });
  res.sendStatus(204);
});

// ─── Menu Changelog ────────────────────────────────────────────────────────────

router.get("/menu-changelog", authenticate, async (_req, res): Promise<void> => {
  const logs = await db.select().from(menuChangelogsTable).orderBy(desc(menuChangelogsTable.createdAt)).limit(200);
  res.json(logs);
});

// ─── Recipes ──────────────────────────────────────────────────────────────────

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

router.post("/menu-items/:id/recipes", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const menuItemId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { inventoryItemId, quantityRequired } = req.body;
  if (!inventoryItemId || quantityRequired == null) { res.status(400).json({ error: "inventoryItemId and quantityRequired required" }); return; }
  const [recipe] = await db.insert(recipesTable).values({
    menuItemId, inventoryItemId, quantityRequired: String(quantityRequired),
  }).onConflictDoUpdate({ target: [recipesTable.menuItemId, recipesTable.inventoryItemId], set: { quantityRequired: String(quantityRequired) } }).returning();
  const [inv] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, inventoryItemId));
  res.status(201).json({ ...recipe, ingredientName: inv?.name ?? "", unit: inv?.unit ?? "", caloriesPerUnit: inv?.caloriesPerUnit ?? null });
});

router.patch("/menu-items/:id/recipes/:ingredientId", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
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
