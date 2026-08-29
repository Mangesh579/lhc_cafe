import { pgTable, text, integer } from "drizzle-orm/pg-core";

export const invoiceSequencesTable = pgTable("invoice_sequences", {
  fiscalYear: text("fiscal_year").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});