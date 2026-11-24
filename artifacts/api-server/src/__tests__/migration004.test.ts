// db/migrations/004_account_conversion.sql runs cleanly, twice, on a database without its objects.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freshDb } from "./pgliteDb";

const SQL = readFileSync(fileURLToPath(new URL("../../../../db/migrations/004_account_conversion.sql", import.meta.url)), "utf8");

it("migration 004 is idempotent and its checks hold", async () => {
  const { client } = await freshDb();
  // start from the state before 004 (001-003 objects exist; 004's do not)
  await client.exec(`DROP TABLE account_conversion_invoices; DROP TABLE account_conversions; ALTER TABLE orders DROP COLUMN converted_from_order_id;`);
  await client.exec(SQL);
  await client.exec(SQL); // second run: no error
  const t = await client.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('account_conversions','account_conversion_invoices') ORDER BY 1`);
  expect(t.rows.map(r => r.table_name)).toEqual(["account_conversion_invoices", "account_conversions"]);
  const c = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='converted_from_order_id'`);
  expect(c.rows).toHaveLength(1);

  // a bill can never be converted twice, and the totals must agree
  await client.exec(`INSERT INTO loyalty_customers (id, name, phone, email) VALUES (1, 'A', '1', 'a@x.invalid'); INSERT INTO orders (id, total_amount) VALUES (1, 100);`);
  const row = `INSERT INTO account_conversions (old_order_id, customer_id, bill_total, items_subtotal, discount, invoices_total, invoice_count, balance_before, balance_after, fingerprint, converted_by)`;
  await client.exec(`${row} VALUES (1, 1, 100, 100, 0, 100, 1, 0, 100, 'f', 'admin')`);
  await expect(client.exec(`${row} VALUES (1, 1, 100, 100, 0, 100, 1, 0, 100, 'f', 'admin')`)).rejects.toThrow(/duplicate|unique/i);
  await expect(client.exec(`${row} VALUES (1, 1, 100, 100, 0, 90, 1, 0, 90, 'f', 'admin')`)).rejects.toThrow();
  await client.close();
}, 60000);
