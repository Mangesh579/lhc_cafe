// db/migrations/008_debit_notes.sql runs twice without error on a database without its objects, and its checks hold.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freshDb } from "./pgliteDb";

const SQL = readFileSync(fileURLToPath(new URL("../../../../db/migrations/008_debit_notes.sql", import.meta.url)), "utf8");

it("migration 008 is idempotent; debit note totals, lines and allocations are checked; negative expenses are allowed", async () => {
  const { client } = await freshDb();
  await client.exec(`ALTER TABLE expenses DROP COLUMN debit_note_id; ALTER TABLE ingredient_price_history DROP COLUMN returned_quantity;
    DROP TABLE debit_note_allocations; DROP TABLE debit_note_items; DROP TABLE debit_notes;`);
  await client.exec(`INSERT INTO suppliers (id, name, pan, created_by) VALUES (1, 'Dairy Co', '123456789', 'admin');
    INSERT INTO inventory_items (id, name, unit, department) VALUES (1, 'Milk', 'L', 'drink');
    INSERT INTO purchase_bills (id, pj_number, supplier_id, supplier_name, supplier_pan, bill_number, bill_number_key, bill_date, terms, due_date, subtotal, vat_amount, total, created_by)
      VALUES (1, 'PJ-1', 1, 'Dairy Co', '123456789', 'A', 'a', '2026-11-20', 'credit', '2026-12-05', 600, 78, 678, 'admin');
    INSERT INTO purchase_bill_items (id, bill_id, inventory_item_id, item_name, department, quantity, unit, rate, amount, vat_amount, line_total, stock_before, stock_after, cost_after)
      VALUES (1, 1, 1, 'Milk', 'drink', 3, 'L', 200, 600, 78, 678, 0, 3, 226);
    INSERT INTO ingredient_price_history (inventory_item_id, supplier_id, bill_id, bill_item_id, bill_date, quantity, unit, rate, landed_unit_cost)
      VALUES (1, 1, 1, 1, '2026-11-20', 3, 'L', 200, 226);`);
  await client.exec(SQL);
  await client.exec(SQL); // second run: no error
  expect((await client.query<{ returned_quantity: string }>(`SELECT returned_quantity FROM ingredient_price_history`)).rows[0].returned_quantity).toBe("0.0000");

  const note = (no: string, sub: number, vat: number, total: number) =>
    `INSERT INTO debit_notes (note_no, supplier_id, bill_id, note_date, reason, subtotal, vat_amount, total, created_by) VALUES ('${no}', 1, 1, '2026-11-24', 'Spoilt', ${sub}, ${vat}, ${total}, 'admin')`;
  await client.exec(note("DN-1", 200, 26, 226));
  await expect(client.exec(note("DN-2", 200, 26, 230))).rejects.toThrow();  // total = subtotal + VAT
  await expect(client.exec(note("DN-3", 0, 0, 0))).rejects.toThrow();       // nothing returned
  await expect(client.exec(note("DN-1", 200, 26, 226))).rejects.toThrow(/duplicate|unique/i);
  const line = (qty: number, amount: number, vat: number, total: number) =>
    `INSERT INTO debit_note_items (debit_note_id, bill_item_id, inventory_item_id, item_name, department, quantity, unit, amount, vat_amount, line_total, stock_before, stock_after)
     VALUES (1, 1, 1, 'Milk', 'drink', ${qty}, 'L', ${amount}, ${vat}, ${total}, 3, 2)`;
  await client.exec(line(1, 200, 26, 226));
  await expect(client.exec(line(0, 200, 26, 226))).rejects.toThrow();
  await expect(client.exec(line(1, 200, 26, 200))).rejects.toThrow();
  await expect(client.exec(`INSERT INTO debit_note_allocations (debit_note_id, bill_id, amount) VALUES (1, 1, 0)`)).rejects.toThrow();
  // the negative direct expense linked to the note
  await client.exec(`INSERT INTO expenses (type, category, amount, description, expense_date, debit_note_id, created_by)
    VALUES ('direct', 'Beverages', -226, 'Return DN-1', '2026-11-24', 1, 'admin')`);
  expect((await client.query(`SELECT amount FROM expenses WHERE debit_note_id = 1`)).rows).toHaveLength(1);
  await client.close();
}, 60000);
