import { db, invoiceSequencesTable, voucherSequencesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { nepalDay } from "./ledgerData";
import { createRequire } from "node:module";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Tx | typeof db;

let NepaliDate: any = null;
function nepaliDateClass(): any {
  if (!NepaliDate) {
    // The production bundle provides a global require; tests (plain ESM) use createRequire.
    const lib = typeof require !== "undefined" ? require("nepali-date-converter") : createRequire(import.meta.url)("nepali-date-converter");
    NepaliDate = lib.default ?? lib;
  }
  return NepaliDate;
}

// Nepal's fiscal year runs Shrawan 1 (~mid-July) to Ashadh end. Label format: "2082/83".
// The BS date is taken from the Nepal calendar day, whatever the server's own timezone.
export function fiscalLabel(at: Date = new Date()): string {
  const [y, m, d] = nepalDay(at).split("-").map(Number);
  const bs = new (nepaliDateClass())(new Date(y, m - 1, d, 12, 0, 0));
  const bsYear = bs.getYear();
  const bsMonth = bs.getMonth() + 1; // 1 = Baisakh, 4 = Shrawan
  const start = bsMonth >= 4 ? bsYear : bsYear - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

// Next invoice number, e.g. 2082/83-00001. One atomic statement, so two tills paying at once never share a number.
// `at` picks the fiscal-year series: normally now; an invoice dated on an earlier day takes that day's fiscal year.
export async function nextInvoiceNumber(ex: Exec = db, at: Date = new Date()): Promise<string> {
  const fy = fiscalLabel(at);
  const [row] = await (ex as typeof db).insert(invoiceSequencesTable).values({ fiscalYear: fy, lastNumber: 1 })
    .onConflictDoUpdate({ target: invoiceSequencesTable.fiscalYear, set: { lastNumber: sql`${invoiceSequencesTable.lastNumber} + 1` } })
    .returning();
  return `${fy}-${String(row.lastNumber).padStart(5, "0")}`;
}

// Next voucher number for a voucher type, e.g. RV-2082/83-00001. The prefix is stored per type and year and can be edited.
// `at` picks the fiscal-year series (a backdated purchase bill takes its own date's year).
export async function nextVoucherNumber(ex: Exec, voucherType: string, defaultPrefix = voucherType, at: Date = new Date()): Promise<string> {
  const fy = fiscalLabel(at);
  const [row] = await (ex as typeof db).insert(voucherSequencesTable).values({ voucherType, fiscalYear: fy, prefix: defaultPrefix, lastNumber: 1 })
    .onConflictDoUpdate({ target: [voucherSequencesTable.voucherType, voucherSequencesTable.fiscalYear], set: { lastNumber: sql`${voucherSequencesTable.lastNumber} + 1` } })
    .returning();
  return `${row.prefix}-${fy}-${String(row.lastNumber).padStart(5, "0")}`;
}
