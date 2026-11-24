// db/migrations/005_suppliers_purchases.sql runs cleanly, twice, on a database without its objects, and its checks hold.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freshDb } from "./pgliteDb";

const SQL = readFileSync(fileURLToPath(new URL("../../../../db/migrations/005_suppliers_purchases.sql", import.meta.url)), "utf8");

it("migration 005 is idempotent and refuses duplicates and bad data", async () => {
  const { client } = await freshDb();
  await client.exec(`
    ALTER TABLE expenses DROP COLUMN purchase_bill_id; ALTER TABLE expenses DROP COLUMN purchase_bill_item_id;
    DROP TABLE ingredient_price_history; DROP TABLE purchase_bill_items; DROP TABLE purchase_bills; DROP TABLE ingredient_suppliers; DROP TABLE suppliers;`);
  await client.exec(SQL);
  await client.exec(SQL); // second run: no error
  const t = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('suppliers','ingredient_suppliers','purchase_bills','purchase_bill_items','ingredient_price_history')`);
  expect(t.rows[0].n).toBe(5);

  await client.exec(`INSERT INTO suppliers (id, name, pan, created_by) VALUES (1, 'Dairy Co', '123456789', 'admin')`);
  await expect(client.exec(`INSERT INTO suppliers (name, pan, created_by) VALUES ('Other', '123456789', 'admin')`)).rejects.toThrow(); // PAN unique
  await expect(client.exec(`INSERT INTO suppliers (name, pan, created_by) VALUES ('Bad', '12345', 'admin')`)).rejects.toThrow();     // 9 digits
  const bill = (no: string, status = "active", pj = no) => `INSERT INTO purchase_bills (pj_number, supplier_id, supplier_name, supplier_pan, bill_number, bill_number_key, bill_date, terms, due_date, subtotal, vat_amount, total, status, created_by)
    VALUES ('${pj}', 1, 'Dairy Co', '123456789', '${no}', lower('${no}'), '2026-11-20', 'credit', '2026-12-05', 100, 0, 100, '${status}', 'admin')`;
  await client.exec(bill("INV-1", "void", "PJ-1"));
  await client.exec(bill("INV-1", "active", "PJ-2"));                                      // a voided number can be re-entered
  await expect(client.exec(bill("INV-1", "active", "PJ-3"))).rejects.toThrow(/duplicate|unique/i); // but not twice while active
  await client.close();
}, 60000);
