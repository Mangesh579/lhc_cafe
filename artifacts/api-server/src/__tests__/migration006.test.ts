// db/migrations/006_purchase_bank_account.sql runs twice without error, and its checks hold.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freshDb } from "./pgliteDb";

const SQL = readFileSync(fileURLToPath(new URL("../../../../db/migrations/006_purchase_bank_account.sql", import.meta.url)), "utf8");

it("migration 006 is idempotent; cheque/online bills need Nabil or HBL; others have none", async () => {
  const { client } = await freshDb();
  await client.exec(`ALTER TABLE purchase_bills DROP COLUMN paid_from_account;`);
  await client.exec(`INSERT INTO suppliers (id, name, pan, created_by) VALUES (1, 'Dairy Co', '123456789', 'admin')`);
  const bill = (no: string, paidVia: string | null, account: string | null) =>
    `INSERT INTO purchase_bills (pj_number, supplier_id, supplier_name, supplier_pan, bill_number, bill_number_key, bill_date, terms, paid_via, ${account === undefined ? "" : ""}due_date, subtotal, vat_amount, total, created_by${account !== null ? ", paid_from_account" : ""})
     VALUES ('${no}', 1, 'Dairy Co', '123456789', '${no}', '${no}', '2026-11-20', '${paidVia ? "cash" : "credit"}', ${paidVia ? `'${paidVia}'` : "NULL"}, '2026-11-20', 100, 0, 100, 'admin'${account !== null ? `, '${account}'` : ""})`;
  // a cheque bill from before 006 has no account: it is kept (the check is NOT VALID for old rows)
  await client.exec(bill("OLD-CHQ", "cheque", null));
  await client.exec(SQL);
  await client.exec(SQL); // second run: no error
  const c = await client.query(`SELECT conname FROM pg_constraint WHERE conname LIKE 'purchase_bills_account_%' ORDER BY 1`);
  expect(c.rows).toHaveLength(2);
  await client.exec(bill("CHQ-OK", "cheque", "nabil"));
  await client.exec(bill("ONL-OK", "online", "hbl"));
  await client.exec(bill("DRW-OK", "drawer", null));
  await client.exec(bill("CRD-OK", null, null));
  await expect(client.exec(bill("CHQ-NO", "cheque", null))).rejects.toThrow();     // cheque needs an account
  await expect(client.exec(bill("ONL-BAD", "online", "sbi"))).rejects.toThrow();   // only nabil or hbl
  await expect(client.exec(bill("DRW-BAD", "drawer", "nabil"))).rejects.toThrow(); // drawer has none
  await expect(client.exec(bill("CRD-BAD", null, "hbl"))).rejects.toThrow();       // credit has none
  await client.close();
}, 60000);
