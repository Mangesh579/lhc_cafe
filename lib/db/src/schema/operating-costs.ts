import { pgTable, serial, integer, text, numeric, boolean, primaryKey } from "drizzle-orm/pg-core";

export const operatingResourcesTable = pgTable("operating_resources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  unitCost: numeric("unit_cost", { precision: 12, scale: 4 }),
  expenseCategory: text("expense_category"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const operatingProfilesTable = pgTable("operating_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  note: text("note"),
});

export const operatingProfileUsageTable = pgTable("operating_profile_usage", {
  profileId: integer("profile_id").notNull(),
  resourceId: integer("resource_id").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 5 }).notNull().default("0"),
}, (t) => ({ pk: primaryKey({ columns: [t.profileId, t.resourceId] }) }));

export const costingSettingsTable = pgTable("costing_settings", {
  id: integer("id").primaryKey().default(1),
  allocationMethod: text("allocation_method").notNull().default("per_dish"),
  expectedMonthlyDishes: integer("expected_monthly_dishes"),
  includeOneTime: boolean("include_one_time").notNull().default(true),
  volumeBasis: text("volume_basis").notNull().default("auto"),
  volumeMonth: text("volume_month"),
});