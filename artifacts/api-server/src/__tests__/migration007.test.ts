// db/migrations/007_supplier_payments.sql runs twice without error on a database without its objects, and its checks hold.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freshDb } from "./pgliteDb";

const SQL = readFileSync(fileURLToPath(new URL("../../../../db/migrations/007_supplier_payments.sql", import.meta.url)), "utf8");

it("migration 007 is idempotent; vouchers, accounts and opening bills are checked", async () => {
  const { client } = await freshDb();
  await client.exec(`DROP TABLE supplier_payment_allocations; DROP TABLE supplier_payments; DROP TABLE payables_settings; ALTER TABLE purchase_bills DROP COLUMN kind;`);
  await client.exec(`INSERT INTO suppliers (id, name, pan, created_by) VALUES (1, 'Dairy Co', '123456789', 'admin')`);
  // a part-A bill from before 007 becomes kind 'purchase'
  await client.exec(`INSERT INTO purchase_bills (id, pj_number, supplier_id, supplier_name, supplier_pan, bill_number, bill_number_key, bill_date, terms, due_date, subtotal, vat_amount, total, created_by)
    VALUES (1, 'PJ-1', 1, 'Dairy Co', '123456789', 'A', 'a', '2026-11-20', 'credit', '2026-12-05', 100, 0, 100, 'admin')`);
  await client.exec(SQL);
  await client.exec(SQL); // second run: no error
  expect((await client.query<{ kind: string }>(`SELECT kind FROM purchase_bills WHERE id = 1`)).rows[0].kind).toBe("purchase");
  expect((await client.query(`SELECT * FROM payables_settings`)).rows).toHaveLength(1);

  const pay = (no: string, type: string, via: string, account: string | null, ref: string | null) =>
    `INSERT INTO supplier_payments (voucher_no, voucher_type, supplier_id, payment_date, paid_via, paid_from_account, reference, amount, created_by)
     VALUES ('${no}', '${type}', 1, '2026-11-24', '${via}', ${account ? `'${account}'` : "NULL"}, ${ref ? `'${ref}'` : "NULL"}, 100, 'admin')`;
  await client.exec(pay("CV-1", "CV", "drawer", null, null));
  await client.exec(pay("PV-1", "PV", "cheque", "nabil", "CHQ 1"));
  await expect(client.exec(pay("PV-2", "CV", "cheque", "nabil", "CHQ 2"))).rejects.toThrow();  // cheque must be a PV
  await expect(client.exec(pay("PV-3", "PV", "online", null, "T"))).rejects.toThrow();         // online needs Nabil or HBL
  await expect(client.exec(pay("PV-4", "PV", "online", "hbl", null))).rejects.toThrow();       // and a reference
  await expect(client.exec(pay("CV-2", "CV", "drawer", "hbl", null))).rejects.toThrow();       // the drawer has no bank
  await expect(client.exec(pay("CV-1", "CV", "drawer", null, null))).rejects.toThrow(/duplicate|unique/i);
  // opening bills are credit bills without VAT
  await expect(client.exec(`INSERT INTO purchase_bills (pj_number, kind, supplier_id, supplier_name, supplier_pan, bill_number, bill_number_key, bill_date, terms, paid_via, paid_from_account, payment_reference, due_date, subtotal, vat_amount, total, created_by)
    VALUES ('OB-1', 'opening', 1, 'Dairy Co', '123456789', 'O', 'o', '2026-09-01', 'cash', 'cheque', 'nabil', 'x', '2026-09-01', 100, 0, 100, 'admin')`)).rejects.toThrow();
  await client.close();
}, 60000);
