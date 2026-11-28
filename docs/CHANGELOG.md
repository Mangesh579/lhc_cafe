# Changelog

## 2026-11-22
- Cash drawer, payment-mode ledgers, orders.paid_at, expenses.paid_from_drawer, "QR Payment" label (commit 066e7ee). SQL run on server by owner. Added CLAUDE.md, docs/HANDOFF.md.
- Open: split payment, credit sales, settlements (steps 2 and 3).


## 2026-11-22 (b): Audit of step 1, then roadmap step 2 parts A and B

### Audit of step 1 (before any change)
- Cash drawer (routes/cash.ts, pages/cash-drawer.tsx): present, routed (/cash-drawer, sidebar), API mounted through routes/inventory.ts. Worked against a local copy of the schema.
- Payment-mode ledgers (routes/ledgers.ts, pages/ledgers.tsx): present and working. Defect: Collections "Total" included credit sales, which are receivables, not receipts. Fixed below.
- "QR Payment" label: present in POS, Pay dialog, receipts, Order Log filter and Ledgers. The stored value stays nabil_qr.
- orders.paid_at, expenses.paid_from_drawer: in the schema and set on payment.
- Day boundary: correct only while the PostgreSQL session timezone is UTC (paid_at/backdated_at are `timestamp without time zone` holding UTC). With the database timezone set to Asia/Kathmandu, a 12:10 am cash sale moved to the previous day (reproduced locally). Fixed below. Owner: run `SHOW timezone;` on the server and note the answer here.
- Typecheck and build: api-server, lhc-cafe and mockup-sandbox typecheck clean; both artifacts build (on Linux). `pnpm run typecheck` fails only in scripts/src/seed.ts (imports `bcryptjs` and `pg` without them in scripts/package.json); this predates the work.
- On Windows, tests and builds need esbuild's Windows binary, which pnpm-workspace.yaml strips; set ESBUILD_BINARY_PATH to an esbuild.exe 0.27.3, or build on the server.
- Other: a stray file named `udo -u postgres psql cafenexus -c SELECT ...` sits in artifacts/api-server/ (safe to delete). The invoice-number sequence was read-then-write, so two simultaneous payments could share a number. Fixed below.

### Delivered
A. Payment foundation
- Five modes: cash, nabil_qr (QR Payment), card_nabil (Card - Nabil POS), card_hbl (Card - HBL POS), credit. Legacy `card`/`esewa` still read as card (machine not recorded).
- New table order_payments (one row per part). Settlement accepts `payments: [{mode, amount, reference}]`; the parts must equal the bill to the paisa. orders.payment_method holds the single mode or `split`. Older screens that send one `paymentMethod` still work.
- paid_at recorded on settlement. Settlement runs in one transaction with a row lock: a double press or two tills give one invoice number and one set of rows. Invoice numbers come from one atomic upsert (lib/fiscal.ts).
- Cash drawer, Collections and every mode ledger read order_payments, falling back to orders.payment_method for orders with no rows. A split bill counts each part in its own mode. Credit and NC never count as cash.
- Day queries read paid_at/backdated_at `AT TIME ZONE 'UTC'`, so the Nepal day is right whatever the database timezone.
- UI: Pay dialog (Active Orders) has five mode buttons, Split payment with live "still to enter", references, and the payment parts on the printed bill. POS records the intended mode; split and credit are chosen at payment. Order Log shows the breakdown, filters by mode / split / "Credit, still owed", and exports the mode and outstanding amount.

B. Credit sales and receivables
- Credit needs a loyalty customer (picked in the Pay dialog). The bill gets its invoice number at that moment, is marked completed (leaves Active Orders) and posts to the customer's receivable. Credit may also be one part of a split.
- Optional credit_limit (warning, never a block) and credit_days on loyalty_customers.
- Receivables page (/receivables): balances, limit, overdue, oldest due; Overdue list; customer ledger; credit terms (admin/accountant).
- Receipt vouchers RV-<FY>-00001: cash, QR or bank; allocate fully or partly to specific invoices, keep the rest as an advance and allocate later; print; void with a reason (admin/accountant). Cash receipts go into that day's cash drawer; a cash receipt on a closed drawer day is refused. QR receipts go to the QR ledger, bank receipts to a new Bank ledger. The Credit ledger is the receivable control.
- A credit invoice with receipts allocated cannot be cancelled until those receipts are voided.
- Collections show Total sales (credit included), Customer receipts, and Money received (credit excluded); card is split into Nabil / HBL / not recorded.

### Tables
- New: order_payments, customer_receipts, receipt_allocations, voucher_sequences.
- Changed: loyalty_customers (+credit_limit, +credit_days). orders.paid_at repeated with IF NOT EXISTS. No existing rows are changed or backfilled.

### Migration
`db/migrations/001_payments_credit.sql`: NOT YET RUN on the server. Run it after a backup, before `deploy.sh` and before pushing the frontend to main.

### Tests
- `pnpm test`: 34 unit tests, all pass. Typecheck and build of both artifacts pass.
- Also run against a local throwaway Postgres 16 (not production): migration applied twice; 44 end-to-end API checks; a browser run of the new screens.
- Not run: production database; the real thermal printer; the QR order page (unchanged).

### Decisions made (by Claude; please confirm)
- A credit sale keeps payment_status = 'paid' ("settled and invoiced"), so sales, profit and VAT reports count it on its day. What is still owed comes from receipt allocations.
- Credit can be one part of a split bill.
- Loyalty points are earned on credit sales at the sale.
- A cash receipt from a credit customer goes into the cash drawer.
- Overdue uses the customer's credit days, or 30 days when none are set (placeholder).
- Partial credit/debit notes do not yet change a credit invoice's outstanding amount; full cancellation does.
- The OpenAPI spec and generated client still list only cash/nabil_qr; POS and the Pay dialog bypass the generated types.

### Open questions
- Accountant: default credit days and credit limits.
- Accountant: should a partial credit note reduce what a credit customer owes? How should a refund of a receipt be recorded?
- Accountant: one receipt settling several invoices is allowed now; confirm.
- Owner: database timezone (`SHOW timezone;`).
- Monthly accounts were not removed and not extended.


## 2026-11-23: Credit rules from the accountant's answers, credit notes, loyalty on payment, payout bill numbers

Built on the owner's Windows dev machine on top of commit 2b1c49e (migration 001 already run on the server).

### Delivered
1. Credit terms
- Default credit days 15 (was a 30-day placeholder) and one default credit limit for all customers, in a new one-row credit_settings table. The limit is blank until the owner sets it in Receivables > Change defaults (admin/accountant). A customer's own limit or days override the default; blank means "use the default".
- The limit still only warns (Pay dialog, settlement response, red in the Receivables list); it never blocks. Due dates and the overdue list use the effective days.
2. Customer credit notes (item-wise)
- credit_notes and credit_note_items; numbers CN-<FY>-00001 (voucher_sequences). Admin/accountant only. Each has a reason, prints, and is voided with a reason; never deleted.
- Each line is an item from the credit invoice: quantity limited to what is not yet credited (earlier notes count), priced at what was actually charged (the bill's discount applied), amount can be lowered for a price allowance; VAT at the invoice's own rate. The total cannot exceed what is still owed.
- Owed = credit part - credit notes - receipts allocated. Used by customer balances, the customer ledger, overdue, Order Log "Owes", receipt allocation and the Credit ledger.
- An invoice with active credit notes (or receipts) cannot be cancelled.
3. Loyalty points follow payment
- No points at a credit sale. Points are recomputed on the running total paid on the bill (non-credit parts + receipts allocated, capped at the bill after credit notes), pre-VAT, at the existing 1 point per Rs. 10. Each receipt earns in proportion; voiding a receipt takes the points back. Every change is written to loyalty_point_logs. The visit counts at the sale.
- Cash/QR/card bills earn in full at payment, as before. Bills paid before this change (loyalty_paid_basis empty) keep their points untouched.
4. Receipts and credit notes only for loyalty customers (clear message otherwise).
5. Petty cash bill number: POST /cash/payout refuses a payout without a bill number ("No bill, no payout") and stores it in expenses.bill_number. Cash Drawer form has a required field and lists it; the Expenses page and its export show it. Existing payouts keep an empty bill number.

### Files
- New: db/migrations/002_credit_rules_billno.sql; api-server src/lib/cashRules.ts; tests creditTerms, creditNotes, loyalty, pettyCash (.test.ts).
- Changed: lib/db schema payments.ts (credit_settings, credit_notes, credit_note_items), orders.ts (loyalty_paid_basis), expenses.ts (bill_number); api-server lib/receivableRules.ts, lib/receivables.ts; routes receivables.ts, orders.ts, cash.ts, ledgers.ts; __tests__/receivables.test.ts (15 days); lhc-cafe pages receivables.tsx, cash-drawer.tsx, expenses.tsx; CLAUDE.md (roadmap line); docs HANDOFF.md, TEST_PLAN_payments.md.

### Tables
- New: credit_settings (one row: 15 days, no limit), credit_notes, credit_note_items.
- Changed: orders (+loyalty_paid_basis), expenses (+bill_number). No existing row is changed.

### Migration
db/migrations/002_credit_rules_billno.sql: NOT YET RUN on the server.

### Tests
- Run: typecheck of api-server, lhc-cafe and mockup-sandbox: clean.
- Not run on this machine: `pnpm test` and both builds. esbuild's Windows binary is missing (pnpm-workspace.yaml strips it), so vitest and `pnpm run build` fail at startup; the API build fails the same way on unchanged main. Run them with ESBUILD_BINARY_PATH set (see HANDOFF), or on the server.
- New tests: credit terms (defaults, overrides, no warning until a limit is set, warn not block, due date), credit notes (discounted price, VAT, allowance, quantity limits with earlier notes, cap at outstanding, invalid items), loyalty (none at credit sale, proportional receipts, split, pre-VAT, rounding, void, cap after notes), petty cash (bill number required and trimmed).
- Not tested against any database on this machine. The same logic (with customer debit notes, since removed) passed end-to-end checks against a throwaway Postgres in the earlier cloud session.

### Decisions made (by Claude; please confirm)
- Following CLAUDE.md ("a debit note reduces what we owe the supplier"), only customer credit notes are built; supplier debit notes come with purchases (roadmap step 4).
- Credit notes only on credit invoices and never above what is still owed; refunds of received money are not handled (accountant: avoid refunds).
- Credit note lines are priced at the price actually charged; VAT at the invoice's own rate.
- Loyalty uses the pre-VAT amount and the existing 1 point per Rs. 10; total_spent moves with the points.
- Only admin and accountant issue/void credit notes and change default terms; supervisors can still record receipts.
- Drawer payouts require a bill number only; the CV voucher series and supplier PAN on cash expenses (CLAUDE.md) come with vouchers in roadmap step 5.

### Open questions
- Owner: the default credit limit amount.
- Accountant: should credit notes reach the sales/VAT reports before VAT registration?


## 2026-11-24: Migration 002 run; credit rules verified live

- The owner ran db/migrations/002_credit_rules_billno.sql on the server and deployed commit 7260b07 (API and frontend). Recorded as run in CLAUDE.md and docs/HANDOFF.md.
- Default credit terms set in production: 15 days, default limit Rs. 5,000 (owner's choice).
- Live test against https://api.sulimhadurbar.com with a temporary accountant login and a test customer ("ZZ Test Customer (Claude)", id 13): 43 checks passed. Covered default and per-customer terms, the over-limit warning (not blocking), credit sale (own invoice, leaves Active Orders, no points), points per receipt and their reversal on void, a cash bill earning points at once, a credit note (and its refusals and void), the Credit ledger and Order Log figures, receipts refused for non-loyalty customers, and a payout refused without a bill number. Real customers' balances were unchanged (total 2,660 before and after).
- Not tested live: saving a payout with a bill number (today's drawer was not open); the admin-only cancel guard; the screens themselves (API only).
- Test records left for the owner to clean up: orders #771 (2083/84-00295, credit 120), #772 (2083/84-00296, credit 60), #773 (2083/84-00297, cash 30) to cancel as admin; voided RV-2083/84-00004, RV-2083/84-00005 and CN-2083/84-00001 stay as audit records; the test customer keeps 3 points (cancelling does not reverse points); disable the temporary `test` user.
- Files: CLAUDE.md, docs/HANDOFF.md, docs/CHANGELOG.md. No code or tables changed.


## 2026-11-24: Card and QR settlements (roadmap step 3)

### Delivered
- New Settlements page (/settlements; admin, accountant, supervisor to view; admin and accountant to settle). For each machine (Card - Nabil POS, Card - HBL POS, QR Payment) and Nepal sales day it shows the unsettled sales total and bill count, with unsettled totals per machine at the top. Filters: unsettled / all days, machine.
- Sales come from order_payments (card_nabil, card_hbl, nabil_qr), falling back to orders.payment_method for orders without rows; a split bill counts each part on its own machine. NC, credit, cash and unpaid bills never count. QR receipt vouchers count as QR on their receipt date. Days use Nepal time (lib/ledgerData).
- Settle: the user enters what reached the bank, the date it arrived and the bank reference (required, like a bill number). The server recomputes the day's sales and refuses if they changed since the screen loaded. Bank charge = sales - received, booked as an expense (indirect, category "Bank and card charges", vendor = the bank, method bank transfer, bill no. = the reference, dated the settlement date; there is no VAT field on expenses). No expense when the charge is 0.
- Fee warning, never a block: Nabil POS outside 2.75%, HBL POS outside 3.00-3.25%, QR any shortfall (QR has no fee). A Rs. 0.50 rounding allowance applies (configurable). The warning is shown live in the dialog, asked to confirm, and stored with the settlement.
- QR and Nabil POS settle to the Nabil account; HBL POS to HBL.
- Settled days are read-only. The admin can void a settlement with a reason, which also voids its bank charge expense; the day can then be settled again. If a settled day's sales change later, the page shows the gap.
- Ledgers: the Card and QR ledgers show each settlement going out (amount to bank, bank charge), so their balance is what is still unsettled; the Bank ledger shows settlements coming in.
- Settings (admin/accountant): start date for tracking (default 2026-11-22, when split payments went live), rounding allowance, fee range per machine (CLAUDE.md: limits are settings, not hard-coded).
- "Bank and card charges" added to the indirect expense categories.

### Files
- New: db/migrations/003_settlements.sql; lib/db/src/schema/settlements.ts; api-server src/lib/settlementRules.ts, src/routes/settlements.ts, src/__tests__/settlements.test.ts; lhc-cafe src/pages/settlements.tsx.
- Changed: lib/db/src/schema/index.ts; api-server src/routes/index.ts, src/routes/ledgers.ts; lhc-cafe App.tsx, components/layout/Sidebar.tsx, lib/expenseApi.ts, pages/ledgers.tsx; CLAUDE.md (roadmap line); docs/HANDOFF.md.

### Tables
- New: settlement_machines (3 rows), settlement_settings (1 row), settlements. Expenses get new rows when a settlement has a bank charge. No existing row is changed.

### Migration
db/migrations/003_settlements.sql: NOT YET RUN on the server.

### Tests
- Run on the dev machine (with ESBUILD_BINARY_PATH): `pnpm test`, 74 tests pass (17 new in settlements.test.ts: machine mapping, split bills per machine, cash/credit/NC/unpaid excluded, payment_method fallback, legacy card kept apart, Nepal day boundary, QR receipts, Nabil exact and outside, rounding allowance, HBL inside and outside the range, QR no-fee warning, refusals, paisa, input checks). Typecheck: api-server, lhc-cafe, mockup-sandbox clean. Builds: API and frontend succeed.
- Not run: end-to-end against a database (no local Postgres; Docker Desktop was not running) and the screens in a browser. Nothing run against production.

### Decisions made (by Claude; please confirm)
- A day can be settled only after it ends (Nepal time); one settlement per machine and day.
- The bank reference is required, as the bill for the bank charge expense.
- The bank charge expense is dated the day the money reached the bank, not the sales day.
- QR receipt vouchers are included in QR settlements; bank receipts are not (they go straight to the bank).
- Received more than sales is refused (check the amount); a Rs. 0.50 rounding allowance before warning.
- Older "Card" payments without a machine are shown but cannot be settled.
- Voiding a settlement is admin-only.

### Open questions
- Accountant: does the card fee apply to the gross including VAT once VAT is on? (No change needed now; the charge is whatever the bank deducted.)
- Owner: start tracking from 2026-11-22, or from another date?


## 2026-11-24: Migration 003 run; settlements checked live

- The owner ran db/migrations/003_settlements.sql on the server and deployed commit 01ae1bc. Recorded as run in CLAUDE.md and docs/HANDOFF.md.
- Live check with the temporary accountant login (read-only, plus requests the server must refuse; nothing saved): 24 checks passed.
  - Machines and fee ranges as seeded (Nabil POS 2.75%, HBL POS 3.00-3.25%, QR no fee; QR and Nabil to the Nabil account); start date 2026-11-22; Rs. 0.50 allowance; today not listed.
  - Unsettled on 2026-11-24: Nabil POS Rs. 1,000 (23 Nov, 1 bill); QR Rs. 5,651 (22 Nov Rs. 3,780, 23 Nov Rs. 1,871, including QR receipt vouchers); HBL POS nothing. Every machine-day matches Ledgers > Collections.
  - One older "Card" payment with no machine (22 Nov, Rs. 250) is listed as not settleable, matching Collections.
  - Preview: no warning at the expected fee, a warning at 10% short. Refused: more than sales, no reference, bank date before the sales day, sales changed since loading (409), today, a day before the start date; void is admin-only. Card, QR and Bank ledgers load.
- Not checked: recording a real settlement (needs the bank statement amounts) and the screens in a browser.
- Files: CLAUDE.md, docs/HANDOFF.md, docs/CHANGELOG.md. No code or tables changed.


## 2026-11-24: Monthly-account conversion dry run (read-only)

### Delivered
- A read-only report of how every open monthly-account bill would become individual credit invoices. Nothing is converted, no data is changed and no monthly-account code was removed.
- API: GET /api/accounts/conversion-preview (admin and accountant). SELECT queries only. Option ?groupBy=visit (default: same Nepal day and same table), kot (one invoice per KOT) or day.
- Page: Monthly Accounts > "Conversion dry run" (/accounts/conversion), with an Excel export (planned invoices, issues, decisions).
- For each open bill: customer, KOT count, total; the planned invoices with day, table, time, KOTs and items, subtotal, share of the bill's discount, total and fiscal year; cancelled KOTs and loyalty redemptions for information. Summary: bills, customers, KOTs, invoices to create, totals, how many invoices would already be past the 15 credit days.
- Problems are listed per bill. "Blocks" (cannot convert cleanly): no loyalty customer, already invoiced, NC, payment rows, a total that does not equal items minus discount (plus VAT), an invoice that would be 0 or less, an empty bill with a total, bad item lines. "Check" (converts, but confirm): discount recorded for the whole bill (shared in proportion, to the paisa), items without a KOT time or table, a KOT spread over days or tables, price x quantity not matching the line, redemptions, more than one open bill for a customer, VAT on the bill, a backdated bill, a visit in an earlier fiscal year, a customer no longer marked monthly.
- The report also lists the decisions needed before conversion: the grouping, invoice numbering and dating, effect on past reports and due dates, discount split, loyalty points, and closing the old bill.

### Files
- New: artifacts/api-server/src/lib/accountConversion.ts, src/routes/accountConversion.ts, src/__tests__/accountConversion.test.ts; artifacts/lhc-cafe/src/pages/account-conversion.tsx.
- Changed: artifacts/api-server/src/routes/index.ts (mount); artifacts/lhc-cafe/src/App.tsx (route), pages/accounts.tsx (link only); docs/HANDOFF.md.
- Tables: none. Migration: none.

### Tests
- Run: `pnpm test` (with ESBUILD_BINARY_PATH), 86 tests pass (12 new: grouping per visit/KOT/day, Nepal day boundary, discount split to the paisa, total mismatch, blockers, missing KOT time/table, checks, cancelled KOTs, summary). Typecheck of all three artifacts clean; API and frontend builds succeed. A search of the new report code found no insert, update, delete or transaction calls.
- Not run: against any database. Not run against production, as asked. It runs on production only once deployed and opened by the admin or accountant; it is read-only.

### Open questions (shown in the report)
- Is "one per visit" = same Nepal day and same table?
- Invoice numbers today but dated at the visit (out of date order), or dated the conversion day?
- How to treat whole-bill discounts and redemptions.


## 2026-11-24: Monthly-account conversion (preview and confirm, one customer at a time)

Following the accountant's confirmation of 2026-11-24 (one credit invoice per visit, a visit = same Nepal day and same table, dated on the visit day; old bill closed as "converted" and linked).

### Delivered
- Admin only. On Monthly Accounts > Conversion dry run, each bill has "Preview conversion for <customer>". The preview shows exactly the invoices that will be created (visit day and time, table, KOTs and items, discount share, total), the customer's balance before and after, anything that refuses the bill, and the points to check. Converting needs a tick ("I have checked these invoices") and the Convert button for that one bill. There is no "convert all".
- The confirm step sends back a fingerprint of the preview; if the bill changed in between (a new or cancelled KOT, a discount), conversion is refused and must be previewed again.
- Each visit becomes a normal credit sale: invoice number in the visit's own fiscal-year series (nextInvoiceNumber now takes a date), payment_method credit with one order_payments credit row, paid_at and backdated_at = the visit's first KOT time, paid, completed, linked to the customer and to the old bill (orders.converted_from_order_id). Due date = visit day + credit days (from the existing receivables logic). Items are copied with their KOT numbers, times, tables, staff and cost snapshot; stock is not deducted again. Whole-bill discounts are shared in proportion, to the paisa, as in the dry run. No loyalty points at conversion (basis 0, so points follow each receipt); the customer's visit count goes up by the number of invoices.
- The old bill gets payment_status 'converted' (order status completed, so it leaves Active Orders), keeps its items, cancelled KOTs and redemptions, and its notes list the new invoice numbers. account_conversions (unique per old bill) and account_conversion_invoices record who, when, which bill, which invoices, the totals and the balance before and after.
- Everything for one bill runs in one transaction with the bill and customer rows locked. Inside it, the customer's balance after must equal the balance before plus the bill total (items minus the shared discount); otherwise everything is rolled back.
- Refused: anything the dry run marks as a block; a visit in a fiscal year other than the current one (an earlier year's register may be filed); the bill carries VAT; already converted (also enforced by a unique index); the bill belongs to another customer; the bill changed since the preview.
- Order routes now refuse to pay, discount, cancel, correct, change status of, or edit notes on a converted bill.
- Audit list "Conversions done" on the same page (admin, accountant); GET /api/accounts/conversions.
- API: GET /api/accounts/conversion/customers/:id/preview, POST /api/accounts/conversion/customers/:id/convert {billId, fingerprint, confirm: true}.

### Files
- New: db/migrations/004_account_conversion.sql; lib/db/src/schema/accountConversions.ts; api-server src/lib/accountConversionRun.ts; tests src/__tests__/accountConversionRun.test.ts, migration004.test.ts, pgliteDb.ts (test helper).
- Changed: lib/db/src/schema/index.ts, orders.ts (converted_from_order_id); api-server src/lib/fiscal.ts (nextInvoiceNumber(ex, at); require fallback for tests), src/routes/accountConversion.ts (preview, convert, audit routes), src/routes/orders.ts (converted guards), package.json (dev: @electric-sql/pglite 0.3.16, drizzle-kit); pnpm-lock.yaml; lhc-cafe src/pages/account-conversion.tsx; CLAUDE.md (roadmap line); docs/HANDOFF.md.
- Not removed: the monthly-account screens and merge code.

### Tables
- New: account_conversions, account_conversion_invoices. Changed: orders (+converted_from_order_id). Running the migration converts nothing.

### Migration
db/migrations/004_account_conversion.sql: NOT YET RUN on the server.

### Tests
- Run on the dev machine: `pnpm test` (ESBUILD_BINARY_PATH set), 96 tests pass. New database tests on PGlite (in-memory PostgreSQL): preview grouping and discount split (69.63 / 24.23 / 6.14 of Rs. 100); full conversion (three invoices 2083/84-00291 to 00293 continuing the series, credit rows, visit-time paid_at, items with KOT numbers and cost, due dates visit + 15, old bill converted with items kept, audit rows, no points, visits +3); balance check against an existing balance; double conversion refused (409, one audit row); rollback when the transaction fails at the end (no orders, items, payments or audit rows, invoice numbers not used up, bill still open, and it converts cleanly afterwards); a visit in fiscal year 2082/83 refused with nothing changed; a bill changed after preview refused; a dry-run block refused; another customer's bill refused. Migration 004 applied twice without error; its unique index refuses a second conversion and its check refuses mismatched totals.
- Typecheck of all three artifacts clean; API and frontend build. The API bundle contains no test code.
- Not run: against production or any real database; the page in a browser.

### Decisions made (by Claude; please confirm)
- Visits in an earlier fiscal year are refused rather than numbered into that year's series (its sales register may already be filed). The generator supports any year if the accountant wants otherwise.
- A bill with VAT is refused (VAT is not split per invoice yet; the cafe is not VAT registered).
- Loyalty redemptions and cancelled-KOT records stay on the old bill; prep-waste and stock logs also stay on the old bill (stock was deducted once, at ordering).
- Each new invoice counts as a visit (total_orders), as for a normal credit sale; no points.
- createdBy of each invoice is the staff member on its first KOT.

### Open questions
- Accountant: confirm the above, especially earlier-fiscal-year visits.
- Owner: after all open bills are converted, remove the monthly-account screens, the account-bill merge and the QR "charge to my account" option (not done yet).


## 2026-11-24: Head barista can receive payments; migration 004 run and open monthly bills converted

### Head barista records receipts
- Owner decision: the head barista also makes bills and takes payments, so they can now record receipts (Receivables > New receipt / Receive payment) and allocate a receipt's remainder. Supervisors, the admin and the accountant could already.
- Unchanged: voiding a receipt, credit notes and credit terms stay with the admin and the accountant.
- Files: artifacts/api-server/src/routes/receivables.ts (WRITE_ROLES), artifacts/lhc-cafe/src/pages/receivables.tsx (canWrite); CLAUDE.md (decision recorded). No tables, no migration.
- Tests: typecheck of api-server and lhc-cafe clean. No new unit test (a role list only).

### Migration 004 and the conversions
- The owner ran db/migrations/004_account_conversion.sql and deployed commit e484f60. Recorded as run in CLAUDE.md and docs/HANDOFF.md.
- Checked live (read-only, accountant login): the audit list loads, and the dry run shows 0 open monthly-account bills.
- Converted by the admin on 2026-11-24, one invoice each, no discounts; each balance went up by exactly the bill total:
  - Rajesh Shrestha, bill #703 -> 2083/84-00301, Rs. 220 (balance 0 -> 220)
  - Samir Shrestha, bill #770 -> 2083/84-00302, Rs. 150 (balance 1,270 -> 1,420)
  - Saroj Maharjan, bill #809 -> 2083/84-00303, Rs. 150 (balance 1,350 -> 1,500)
- Still to do: remove the monthly-account screens, the account-bill merge and the QR "charge to my account" option. Until then, a customer still marked as a monthly account can start a new monthly bill.


## 2026-11-24: Monthly accounts retired

All open monthly-account bills were converted on 2026-11-24 (3 bills). Checked live before this change with the read-only dry run: 0 open monthly bills.

### Delivered
- No more monthly (account) bills can be created:
  - Active Orders: "Make <customer> a monthly account" and the "make monthly too" option in Add customer are removed. Adding or changing a customer on an order only sets the customer; it never merges bills (PATCH /orders/:id/customer).
  - Staff orders (POST /orders): a customer's pays_monthly flag no longer sends the order to an account bill. Orders on a table still join that table's open bill as a new KOT (account bills excluded from that lookup).
  - QR page: the "Charge this order to my monthly account" checkbox, the "My monthly account" panel and the monthly-account card on My Order are removed. POST /public/order with chargeToAccount: true returns 410 with a clear message and places nothing. GET /public/loyalty/account answers "no monthly account". The QR OTP session binding (used only for the account) is removed; old qr_session_customers rows are kept.
  - API: PATCH /accounts/:id {paysMonthly: true} and GET /accounts return 410 with a clear message. Turning the flag off is still allowed. GET /accounts/customers (customer search for Add customer, the Pay dialog and Receivables) is unchanged except that it no longer returns paysMonthly.
  - lib/mergeOrders.ts removed (only the account flows used it). Table changes still merge with their own code.
- The pays_monthly flag is ignored everywhere and left in the data (no migration).
- Navigation: the Monthly Accounts page and sidebar entry are removed; /accounts opens Receivables. Receivables has a new tab "Converted monthly bills" (admin, accountant): the conversion history, read-only, plus a live check that no monthly bill is open (with a link to the conversion page for the admin if one ever is). The conversion page stays at /accounts/conversion, reachable from that link.
- Kept readable, nothing deleted: old account bills and their per-KOT tables (Order Log, per-KOT P&L reporting in lib/opcosting.ts and lib/accountSales.ts), converted bills, account_conversions and account_conversion_invoices, the conversion dry-run and audit routes.
- CLAUDE.md: Roadmap replaced with the owner's new list (1 monthly accounts retired; 2 suppliers and payables; 3 chart of accounts and posting; 4 reports; 5 VAT and TDS; 6 course fees; 7 payroll; 8 owner's live view; 9 CBMS). Staff clock-in was checked for item 7: it exists (attendance punches and shifts, routes/staff.ts).

### Files
- New: artifacts/api-server/src/lib/monthlyRetired.ts; artifacts/api-server/src/__tests__/monthlyRetired.test.ts; artifacts/lhc-cafe/src/components/ConvertedMonthlyBills.tsx.
- Changed: api-server routes/orders.ts, routes/accounts.ts, routes/public.ts, vitest.config.ts (dummy test-only env so the app loads in route tests); lhc-cafe App.tsx, components/layout/Sidebar.tsx, pages/orders.tsx, pages/public-order.tsx, pages/pos.tsx, pages/receivables.tsx, pages/account-conversion.tsx (back link); CLAUDE.md; docs/HANDOFF.md.
- Removed: artifacts/api-server/src/lib/mergeOrders.ts; artifacts/lhc-cafe/src/pages/accounts.tsx.
- Tables: none changed. Migration: none needed.

### Tests
- Run on the dev machine: `pnpm test`, 107 tests pass. New monthlyRetired.test.ts (11 tests) starts the real Express app on an in-memory PostgreSQL (PGlite): making a monthly account is refused (410) and the monthly list is gone; an order for a customer still flagged pays_monthly is a normal bill; orders on the same table still merge into one bill as KOT 2; adding a pays_monthly customer to an order never merges; QR "charge to my account" is refused with nothing placed; a normal QR order still joins the table's open bill; the QR account lookup says "no monthly account"; no monthly bill exists and the dry run shows 0; the conversion history, the converted bill with its items, and customer search are still readable.
- Typecheck of all three artifacts clean; API and frontend build.
- Live, read-only (accountant login): dry run shows 0 open monthly bills.
- Not run: the screens in a browser; anything that writes to production.

### Decisions made (by Claude; please confirm)
- pays_monthly is ignored rather than cleared, so the data still shows who used to pay monthly.
- The conversion page and its API stay (admin only), reachable only through the Receivables check, in case an old bill is ever found open.
- Old account bills in Active Orders still show their "Monthly account" label if one were ever open, so old data reads correctly.


## 2026-11-24: Suppliers and purchase bills (roadmap step 2, part A)

Plan approved by the owner the same day: docs/specs/step2-suppliers.md (audit, how bills fit the existing purchase and expense flow, roles, existing data, and the owner's answers).

### Delivered
- Supplier master (Suppliers page): name, PAN/VAT number (9 digits, mandatory, unique), address, phone, contact person, credit days, notes, active flag, type (goods or service; stored for TDS later). Admin and accountant edit; supervisors and the kitchen and drink heads can view (no amounts).
- Ingredient-supplier links: one or more suppliers per ingredient, at most one preferred. Unmapped ingredients (not made from other ingredients) are listed, with a banner on Suppliers and Inventory like the existing unlinked-ingredient banners. Saving a bill links its supplier to each ingredient automatically (preferred if there was none).
- Purchase bill (GRN), admin and accountant (/purchases/new):
  - Supplier dropdown fills in the PAN/VAT number and credit days; both can be edited on the bill (a warning shows if the PAN differs). The supplier's bill number and the bill date (as printed; backdating allowed within the fiscal year, never the future, Nepal time) are required.
  - Lines: ingredient, quantity (in its own unit), amount or rate, VAT per line or one VAT for the bill (shared over the lines to the paisa). VAT is stored but not claimed: it is part of the cost while the cafe is not VAT registered.
  - Credit (due = bill date + credit days) or paid now from the cash drawer, by cheque (number required) or online (reference required).
  - Refused: no PAN, no bill number, a duplicate bill number from the same PAN (any case or spacing; also enforced by a unique index; a voided bill's number may be entered again), composite ingredients, service-provider suppliers, an earlier fiscal year, a closed drawer day for drawer-paid bills.
  - Each bill gets a purchase-journal number (PJ-2083/84-00001, editable prefix, fiscal year of the bill date).
- Saving a bill runs in one transaction. For each line:
  - stock goes up in the ingredient's own inventory (kitchen or drink), with a Stock Log line;
  - cost per unit uses the same formula as before (weighted average by default, or the bill's price);
  - the last-purchase fields update. An older (backdated) bill never replaces a newer last purchase or price, and uses the average;
  - one direct expense is booked (same categories as before, linked to the bill, read-only on Expenses). So the accounting P&L memo, cash profit and the Expenses page count the purchase once;
  - a price-history row is stored.
  The supplier payable goes up for credit bills. A drawer-paid bill shows as a payout in that day's cash drawer.
- Bills are immutable. Void (with a reason), in one transaction:
  - takes the stock back out;
  - voids the linked expenses and price-history rows;
  - clears the payable;
  - restores cost per unit and the last-purchase fields only where nothing has changed them since (otherwise they are left and the void says which).
  Bills are never deleted.
- Supplier ledger: every bill with number, date, items, total, paid, balance, due date and overdue flag; totals billed, paid, balance and overdue; the items of each unpaid bill. Purchase-bills list for all suppliers. Price history per ingredient and supplier.
- The old one-ingredient Record purchase (no PAN, no bill number) returns 410; Inventory's cart button opens the bill form for that ingredient. Existing purchases and expenses are untouched and readable; they are not turned into bills or payables.

### Files
- New: db/migrations/005_suppliers_purchases.sql; lib/db/src/schema/purchases.ts; api-server src/lib/purchaseRules.ts, src/lib/purchasePosting.ts, src/routes/purchases.ts, tests purchaseRules, purchaseBills, migration005 (.test.ts); lhc-cafe src/pages/suppliers.tsx, src/pages/purchase-bill.tsx, src/components/SupplierGapsBanner.tsx; docs/specs/step2-suppliers.md.
- Changed: lib/db/src/schema/index.ts, expenses.ts (purchase_bill_id, purchase_bill_item_id); api-server src/lib/fiscal.ts (nextVoucherNumber takes a date), src/routes/expenses.ts (bill-linked expenses read-only; Record purchase closed), src/routes/index.ts; lhc-cafe App.tsx, Sidebar.tsx (Suppliers), pages/inventory.tsx (cart button opens the bill form; old dialog removed; banner), pages/expenses.tsx (bill-linked rows read-only; "Credit (supplier bill)" label); CLAUDE.md (owner decisions, roadmap step 2); docs/HANDOFF.md.

### Tables
- New: suppliers, ingredient_suppliers, purchase_bills, purchase_bill_items, ingredient_price_history. Changed: expenses (+purchase_bill_id, +purchase_bill_item_id). No existing row is changed.

### Migration
db/migrations/005_suppliers_purchases.sql: NOT YET RUN on the server.

### Tests
- Run on the dev machine: `pnpm test`, 135 tests pass. New:
  - purchaseRules (11): totals and due date, PAN and bill number required, bill VAT shared to the paisa, cash payment details, backdating and the Nepal day boundary (11:50 pm / 12:10 am), earlier fiscal year refused, zero lines refused, weighted and last cost, backdated bills not "latest", overdue days on the Nepal day, PAN and bill-number normalising, supplier checks.
  - purchaseBills (16, real routes on PGlite with the clock fixed):
    - suppliers and PAN uniqueness; other roles get no amounts and cannot edit;
    - the unmapped list;
    - refusals; a credit bill's stock in the right department, cost (111.8667 = (10 x 100 + 678) / 15), last purchase, Stock Log, two linked expenses, price history, auto-link, ledger and due date;
    - the P&L memo counting it once (1,808); the duplicate refused (case and spacing) with nothing posted; composite, service supplier, future and earlier-year dates refused;
    - a drawer-paid bill in the cash drawer; a backdated bill not overwriting the last purchase; bill expenses read-only; the old path closed (410);
    - void reversing stock, expenses, price history and payable, with cost left where later bills changed it, and restored where untouched; a voided number re-entered; overdue on the Nepal day; voided bills still listed.
  - migration005 (1): runs twice, PAN unique and 9 digits, duplicate active bill refused, voided number re-enterable.
- Typecheck of all three artifacts clean; API and frontend build.
- Not run: the screens in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- Bills dated in an earlier fiscal year are refused (as for the monthly-account conversion).
- An older (backdated) bill never replaces a newer last purchase or, with "this bill's price", the cost; it uses the weighted average.
- Service-provider suppliers cannot have purchase bills (their bills stay on Expenses until vouchers and TDS).
- Unlinking a supplier from an ingredient deletes the link row (a setting; no bill or stock is affected).
- Line units must be the ingredient's own unit; unit conversion is not built.

### Next
- Part B (payments PV/CV, partial and full, allocation to bills, aging) and part C (returns with item-wise debit notes): later prompts.


## 2026-11-24: Migration 005 run

- The owner ran db/migrations/005_suppliers_purchases.sql on the server and deployed commit aab299d (suppliers and purchase bills, part A). Recorded as run in CLAUDE.md and docs/HANDOFF.md.
- Checked live (read-only, accountant login): the Suppliers, Purchase bills and unmapped-ingredient routes answer from the new tables. At the time: 0 suppliers, 0 bills, 293 ingredients with no supplier linked.
- Files: CLAUDE.md, docs/HANDOFF.md, docs/CHANGELOG.md. No code or tables changed.


## 2026-11-24: Part A additions (bank account on cheque/online bills; spec for opening balances and posting)

The owner's approval of part A arrived with four additions after part A was already live (migration 005 run, commit aab299d). Handled as follows:

1. Refuse a drawer-paid bill on a closed drawer day: already in part A (lib/purchasePosting.ts, same rule as cash receipts). Added a route test: the bill is refused with "The cash drawer for <day> is closed…", nothing is posted (stock unchanged, no bill), and the same bill paid by cheque that day is accepted.
2. Cheque and online bills store the bank account that paid (Nabil or HBL) with the cheque number or transaction reference.
   - New column purchase_bills.paid_from_account, required for cheque and online bills, empty for drawer and credit bills (API check, form field, database checks).
   - It shows on the bill, in the bill lists and in the expense description.
   - A new migration 006 is used because 005 had already run on the server.
3. Spec section 12, "Opening supplier balances" (part B): the accountant enters, per supplier, the unpaid bills at the start date (bill number, date, due date, amount). No stock, costing, price history or expense. A payable that part B payments can be allocated to. Same duplicate check. Opening balance of Accounts Payable in step 3. Not built.
4. Spec section 13, note for roadmap step 3, using the chart of accounts the accountant approved on 2026-11-24:
   - purchases post to 1400 Inventory - Kitchen / 1410 Inventory - Drinks, against 2100 Accounts Payable, 1100 Cash on Hand, or 1200 Bank - Nabil / 1210 Bank - HBL by how they were paid;
   - only consumption posts to 5000/5010 Ingredient consumption (waste 5100, NC 5200);
   - purchase expense rows (purchase_bill_id or, older, inventory_item_id) must never be posted as costs again.
   Also recorded in CLAUDE.md under the chart of accounts.

### Files
- New: db/migrations/006_purchase_bank_account.sql; artifacts/api-server/src/__tests__/migration006.test.ts.
- Changed: lib/db/src/schema/purchases.ts (paid_from_account); api-server src/lib/purchaseRules.ts, src/lib/purchasePosting.ts, tests purchaseRules and purchaseBills; lhc-cafe pages/purchase-bill.tsx (bank account field), pages/suppliers.tsx (shows it); docs/specs/step2-suppliers.md (sections 11 to 13); CLAUDE.md; docs/HANDOFF.md.

### Tables
- Changed: purchase_bills (+paid_from_account, with two checks; the "required" check is NOT VALID so any cheque/online bill entered before 006 is kept as it is). No existing row is changed.

### Migration
db/migrations/006_purchase_bank_account.sql: NOT YET RUN on the server.

### Tests
- Run on the dev machine: `pnpm test`, 139 tests pass. New:
  - a pure test: cheque and online need Nabil or HBL, drawer and credit have none;
  - two route tests: the closed drawer day is refused with nothing posted, and an online bill stores HBL with its reference;
  - migration006: runs twice; an old cheque bill without an account is kept; cheque/online need nabil or hbl; drawer and credit refuse an account.
- Typecheck of all three artifacts clean; API and frontend build.
- Not run: the screens in a browser; anything against production.


## 2026-11-24: Migration 006 run

- The owner ran db/migrations/006_purchase_bank_account.sql on the server and deployed commit 535451b. Recorded as run in CLAUDE.md and docs/HANDOFF.md.
- Checked live (accountant login): the purchase-bill list loads (it selects the new paid_from_account column), and a cheque bill without a bank account is refused by the API ("Choose the bank account that paid: Nabil or HBL.") before anything is saved. No purchase bills exist yet.
- Files: CLAUDE.md, docs/HANDOFF.md, docs/CHANGELOG.md. No code or tables changed.


## 2026-11-24: Supplier payments, opening balances and aging (roadmap step 2, part B)

### Delivered
1. Supplier payments (Suppliers > Payments, and "Pay <supplier>" on each ledger; admin and accountant):
   - How paid:
     - cash from the drawer, which gets a **CV** number;
     - by cheque (cheque number + Nabil or HBL) or online transfer (reference + Nabil or HBL), which get a **PV** number.
     Numbers come from the existing voucher sequences with editable prefixes, in the fiscal year of the payment date.
   - The payment date is the real date: backdating within the fiscal year, never the future (Nepal day).
   - A payment can be partial or full and allocated across that supplier's open bills (including opening bills), with an "Oldest first" helper. Anything not allocated stays as an advance to the supplier (account 1350 in step 3) and can be allocated later. Over-allocation, another supplier's bills and paid bills are refused.
   - No payment ever creates an expense: the bill's expense is already the cost record.
   - A CV payment reduces that day's expected drawer cash, read from its own table the same way the drawer already reads customer cash receipts. It is shown on the Cash Drawer and in the cash ledger. It is refused when that drawer day is closed, the same rule as cash receipts and drawer-paid bills.
   - PV payments, and bills paid by cheque or online when bought, now show as money out in the Bank ledger.
   - Payments are immutable. Void with a reason (admin or accountant) restores the bills' balances and the drawer; it is refused on a closed drawer day.
   - Voucher shown on screen and printed (Cash voucher / Payment voucher, with the allocations and any advance).
   - A purchase bill with payments allocated cannot be voided until those payments are voided.
2. Opening supplier balances (Suppliers > Opening balances):
   - The accountant sets the opening-balance date, then enters each supplier's unpaid bills at that date: bill number, bill date (on or before the opening date; any fiscal year), due date and amount.
   - They are purchase_bills of kind "opening" with an OB number: no lines, no stock change, no expense, no drawer effect.
   - They show in the supplier ledger as "opening", count in the payable, are paid, aged and voided like bills, and follow the same duplicate rule (supplier PAN + bill number) both ways.
3. Aging and ledger:
   - Payables aging by supplier on the Nepal day: not yet due, 1-15, 16-30, 31-60, over 60 days past due, with total owed, advance and net.
   - Bills due this week (today to today + 6) and overdue bills. Excel export (aging, due this week, overdue).
   - The supplier ledger now shows payments and a running balance (bills and opening bills add; paid-at-purchase and payments subtract; negative = advance), with Excel export (ledger, bills, payments). The supplier list shows net payable and any advance.
4. Roles: payments, aging, ledgers, opening bills and the opening date are admin and accountant only. The API refuses all other roles, and their supplier list has no amounts.

### Files
- New: db/migrations/007_supplier_payments.sql; api-server src/lib/payableRules.ts, src/lib/payables.ts, src/lib/supplierPaymentsRead.ts, tests payableRules, supplierPayments, migration007 (.test.ts); lhc-cafe src/components/SupplierPayables.tsx.
- Changed: lib/db/src/schema/purchases.ts (kind, payables_settings, supplier_payments, supplier_payment_allocations); api-server src/lib/purchasePosting.ts (void refused with allocations), src/routes/purchases.ts (payments, opening bills, settings, aging, ledger), src/routes/cash.ts (CV payments in the drawer), src/routes/ledgers.ts (cash and bank ledgers); lhc-cafe pages/suppliers.tsx, pages/cash-drawer.tsx; CLAUDE.md (roadmap step 2); docs/HANDOFF.md; docs/specs/step2-suppliers.md.

### Tables
- New: payables_settings (one row, opening date empty), supplier_payments, supplier_payment_allocations. Changed: purchase_bills (+kind, default 'purchase'). No existing row is changed.

### Migration
db/migrations/007_supplier_payments.sql: NOT YET RUN on the server.

### Tests
- Run on the dev machine: `pnpm test`, 166 tests pass. New:
  - payableRules (11): CV/PV rules and the bank account; real payment date (backdating, no future, no earlier year, Nepal midnight); allocation (partial, several bills, advance, refusals); oldest first; opening bills (date needed, on or before it, any fiscal year, due after bill); every aging bucket edge (0, 1, 15, 16, 30, 31, 60, 61 days) and Nepal midnight (11:50 pm not due, 12:10 am 1 day late); per-supplier totals with advance; due this week; the running-balance ledger.
  - supplierPayments (15, real routes on PGlite, clock fixed):
    - partial PV with no new expense; one payment over two bills leaving a 100 advance (ledger net -100); refused allocations;
    - the advance allocated later; a CV lowering the drawer's expected cash with no expense and appearing in the cash ledger;
    - a closed drawer day refusing a CV and its void; void restoring balances and the drawer (supervisor refused, reason needed, never deleted);
    - bill void refused with allocations; voucher fetch for print and the PV in the bank ledger;
    - opening date needed (admin/accountant, not future); an opening bill with no stock, expense or drawer effect, in the ledger as opening; duplicates both ways; opening bills paid and void refused when paid;
    - aging buckets (not due, 1, 30, 61 days) with due this week and overdue; roles (supervisor, head chef, staff refused; no amounts in their supplier list).
  - migration007 (1): runs twice; an old bill becomes 'purchase'; CV/PV and account checks; duplicate voucher refused; an opening bill must be credit.
- The migration test caught a check that let an online payment without a bank account through (SQL treats NULL as passing); fixed before finishing.
- Typecheck of all three artifacts clean; API and frontend build.
- Not run: the screens in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- Opening bills live in purchase_bills (kind 'opening') so the duplicate check, ledger, payments and aging need no second path. They are dated on or before the opening-balance date (a setting) and may be in an earlier fiscal year. Their numbers (OB) use the entry date's fiscal year.
- "Not yet due" includes bills due today; 1-15 starts the day after the due date (Nepal day).
- Payments dated in an earlier fiscal year are refused, like bills.
- The supplier's net payable = owed on bills - advances; a negative running balance is shown as an advance.


## 2026-11-24: Migration 007 run

- The owner ran db/migrations/007_supplier_payments.sql on the server and deployed commit b567f0e (supplier payments, opening balances and aging, part B). Recorded as run in CLAUDE.md and docs/HANDOFF.md.
- Checked live (read-only, accountant login): the opening-balance settings, supplier payments, aging and purchase-bill routes answer from the new tables. At the time: opening-balance date not set, 0 payments, 0 bills, nothing owed.
- Files: CLAUDE.md, docs/HANDOFF.md, docs/CHANGELOG.md. No code or tables changed.


## 2026-11-24: Purchase returns with item-wise debit notes (roadmap step 2, part C)

### Summary
- Plan written first: docs/specs/step2-suppliers.md section 14. Nothing needed stopping.
- Debit notes (DN-<FY>-00001, voucher series DN, editable prefix) against an existing active purchase bill. Opening bills are refused with a clear message. Lines are chosen from the bill: quantity up to bought minus already returned, an optional reason per line, a reason for the note. Date: real return day, backdating to the bill date allowed, no future, current fiscal year, Nepal day.
- Effects, in one transaction with row locks: stock down in the ingredient's own inventory with a Stock Log line; the payable down by the returned value including its share of VAT (applied to its own bill up to what it still owes; the rest is a credit (advance) with the supplier, allocatable to other bills or left); one linked negative direct expense per line (category of the original expense; the original is never edited; read-only on Expenses); the price-history row records the returned quantity (and is voided when the whole line is returned). No cash or drawer effect.
- Void with a reason (admin or accountant) puts back stock (with a Stock Log line), the payable, price history and voids the negative expenses. Never deleted. A purchase bill with an active debit note cannot be voided until the note is voided.
- Shown in: the supplier ledger (running balance, "Returned" total, Excel sheet "Debit notes"), aging (lower owed or a larger advance), the bill detail (returns, "Return items"), price history (net, bought and returned quantity), a printable debit note, and Suppliers > Returns (list, print, allocate, void, Excel export with notes and items). Admin and accountant only.

### Files
- New: db/migrations/008_debit_notes.sql; api-server src/lib/debitNoteRules.ts, src/lib/debitNotes.ts, tests debitNoteRules, debitNotes, migration008 (.test.ts); lhc-cafe src/components/DebitNotes.tsx.
- Changed: lib/db/src/schema/purchases.ts (debit_notes, debit_note_items, debit_note_allocations, price history returned_quantity), lib/db/src/schema/expenses.ts (debit_note_id); api-server src/lib/payables.ts (bill balances and advances include debit notes), src/lib/payableRules.ts (ledger entries), src/lib/purchasePosting.ts (bill void refused with an active debit note), src/routes/purchases.ts (debit-note routes, ledger, bill detail, price history); lhc-cafe pages/suppliers.tsx; CLAUDE.md (roadmap step 2); docs/HANDOFF.md; docs/specs/step2-suppliers.md.

### Tables
- New: debit_notes, debit_note_items, debit_note_allocations. Changed: expenses (+debit_note_id), ingredient_price_history (+returned_quantity, default 0). No existing row is changed.

### Migration
db/migrations/008_debit_notes.sql: NOT YET RUN on the server.

### Tests
- Run on the dev machine: `pnpm test`, 23 files, 182 tests pass. New:
  - debitNoteRules (6): partial value with VAT share (4 kg of 10 kg rice = 400 + 52); exact remainder (33.33 + 66.67); limits (bought minus returned, same line twice); refusals; own bill then advance; date rules (backdating, no future, not before the bill, earlier fiscal year) and Nepal midnight (12:10 am).
  - debitNotes (9, real routes on PGlite, clock fixed): partial return (kitchen stock down, Stock Log, negative expense, original expense untouched, bill balance, price history, cost per unit unchanged); limits and a second partial return taking the remainder (price history voided); a return against a paid bill becoming an advance and then allocated (over-allocation refused); ledger running balance and totals; aging and the P&L memo; opening bill, future date and pre-bill date refused; bill void refused while a note is active; void (supervisor refused, reason needed, stock, expense, price history, payable and P&L restored, second void refused, never deleted); fetch for print; the negative expense cannot be voided on Expenses; supervisor and head barista refused on every route.
  - migration008 (1): runs twice; total = subtotal + VAT, line_total = amount + VAT, quantity > 0, allocation > 0, unique number; a negative expense with debit_note_id is accepted.
- Typecheck: api-server, lhc-cafe, db clean (`pnpm run typecheck` still fails only in scripts/src/seed.ts, as before). Both artifacts build.
- Not run: the screens in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- Cost per unit is NOT recalculated on a return. Taking the returned value out of the average ((stock x average - value) / (stock - qty)) jumps or goes negative when little stock is left or stock is already used. Past sales profit never changes either way. Step 3 posting: Dr 2100 Accounts Payable, Cr 1400/1410 Inventory at the returned value.
- The note is applied to its own bill first; only the part above that bill's balance becomes an advance.
- A bill line can be returned even if its stock was already used (within the bought quantity); stock may go negative as elsewhere.

### Open questions
- Before running 008, confirm that expenses.amount accepts negative amounts on the server (query in the server steps).


## 2026-11-25: Migration 008 run

- The owner ran db/migrations/008_debit_notes.sql on the server (after a backup) and deployed part C (purchase returns with item-wise debit notes). Recorded as run in CLAUDE.md and docs/HANDOFF.md. Roadmap step 2 is complete.
- After the restart the API logged "Server listening" and /api/healthz answered 200. An older "Failed query ... order_items" entry in the pm2 error log came from a dropped database connection in orders.ts, which this change did not touch. If it shows up again in new logs, look into it separately.
- Files: CLAUDE.md, docs/HANDOFF.md, docs/CHANGELOG.md. No code or tables changed.


## 2026-11-25: Four card machines (LHC and Sulimha Durbar)

### Owner's testing of 2026-11-25 and answers
- Asked for: cancelling or moving a credit invoice in Receivables, petty cash without a bill number, hotel guests' included breakfast, and two more card machines.
- Answers: Sulimha Durbar is a separate business and pays LHC for guests' breakfasts at cost; Sulimha machine money lands in Sulimha's bank and Sulimha transfers it to LHC later (Nabil or HBL account), same fees (Nabil 2.75%, HBL 3.00-3.25%); petty cash gets a CV number with an optional bill number; order of work: card machines, receivables cancel/wrong customer, petty cash, room stays (plan first). Recorded in CLAUDE.md.

### Summary (this task: the card machines)
- Labels: Card - LHC Nabil POS, Card - LHC HBL POS (stored values card_nabil / card_hbl unchanged, so past sales stay on LHC's machines), new Card - Sulimha Nabil POS, Card - Sulimha HBL POS (card_sulimha_nabil / card_sulimha_hbl).
- All four count as card everywhere: Pay dialog (Active Orders) and POS buttons, split payments, receipts, Order Log filter, Collections (card split per machine, Excel), Card ledger.
- Settlements: two new machines (sulimha_nabil_pos, sulimha_hbl_pos, collected_by 'sulimha', same fee ranges). Settling one asks which LHC account Sulimha transferred into (Nabil or HBL) and refuses without it; the fee is a "Bank and card charges" expense with vendor Sulimha Durbar; the Bank ledger shows the money arriving "(transferred by Sulimha Durbar)".

### Files
- New: db/migrations/009_sulimha_card_machines.sql; api-server src/__tests__/sulimhaCards.test.ts.
- Changed: lib/db/src/schema/settlements.ts (collected_by), lib/db/src/schema/payments.ts (comment); api-server src/lib/payments.ts, src/lib/ledgerData.ts, src/lib/settlementRules.ts, src/routes/settlements.ts, src/routes/ledgers.ts, src/routes/orders.ts (comment); lhc-cafe src/lib/payments.ts, pages/orders.tsx, pages/pos.tsx, pages/order-log.tsx, pages/ledgers.tsx, pages/settlements.tsx; CLAUDE.md; docs/HANDOFF.md.

### Tables
- Changed: order_payments (mode check allows the two Sulimha modes), settlement_machines (+collected_by default 'lhc'; nabil_pos and hbl_pos relabelled; two rows added). No payment, order or settlement row is changed.

### Migration
db/migrations/009_sulimha_card_machines.sql: NOT YET RUN on the server.

### Tests
- Run on the dev machine: `pnpm test`, 24 files, 188 tests pass. New sulimhaCards (6): labels and modes; split bill per machine and collections per machine; settlement input with the LHC account; routes on PGlite (a Sulimha HBL sale unsettled "via Sulimha Durbar", refused without the account, settled into Nabil with the 3% fee as an expense from Sulimha Durbar, Bank ledger in, Card ledger back to 0); migration 009 runs twice, allows the new modes, refuses others, relabels and adds the machines.
- Typecheck api-server, lhc-cafe, libs clean; both artifacts build.
- Not run: the screens in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- The existing card_nabil / card_hbl become LHC's machines (relabel only), so every past card sale stays LHC's.
- A Sulimha machine is "settled" when Sulimha's transfer reaches LHC; the gap is the card fee (warning outside the range), booked as a bank charge like LHC's machines.

### Open questions
- Step 3 posting needs an account for money owed by Sulimha Durbar (e.g. "Receivable - Sulimha Durbar"); the approved chart of accounts has none yet. Ask the accountant.


## 2026-11-26: Migration 009 run

- The owner ran db/migrations/009_sulimha_card_machines.sql on the server (after a backup) and deployed the four card machines (LHC Nabil/HBL POS, Sulimha Nabil/HBL POS). Recorded as run in CLAUDE.md and docs/HANDOFF.md.
- Files: CLAUDE.md, docs/HANDOFF.md, docs/CHANGELOG.md. No code or tables changed.


## 2026-11-26: Receivables, Cancel invoice and Wrong customer

### Summary
- Skills used: ponytail, tdd, backend-patterns, react-patterns (owner's global CLAUDE.md asks to load fitting skills).
- On each credit invoice in a customer's Receivables ledger (admin and accountant), next to Credit note:
  - Cancel: a full credit note for what is still owed (to the paisa; earlier item-wise notes are respected), dated today, with a reason. "Not served: put the stock back" (owner: ask each time) puts the ingredients back with Stock Log lines; voiding that note takes them out again.
  - Wrong customer: a full credit note on the old invoice and a new credit invoice for the right customer, with the same items, KOTs and cost snapshot, a credit payment part, dated on the visit day (new number in that fiscal year). No stock change. Loyalty points come when the customer pays. The note cannot be voided; to undo, move the new invoice back.
- Both refuse split bills (part cash/QR/card: use an item-wise credit note) and invoices with receipts allocated (void them first). Wrong customer also refuses an invoice that already has credit notes. A print of the credit note is offered after saving.

### Files
- New: db/migrations/010_credit_note_kinds.sql; api-server src/lib/stockMoves.ts, tests cancelInvoiceRules, cancelInvoice (.test.ts); lhc-cafe src/components/InvoiceActions.tsx.
- Changed: lib/db/src/schema/payments.ts (credit_notes kind, stock_restored, reissued_order_id); api-server src/lib/receivableRules.ts (fullCreditNote), src/routes/receivables.ts (two routes, void rules, note fields); lhc-cafe pages/receivables.tsx; CLAUDE.md; docs/HANDOFF.md.

### Tables
- Changed: credit_notes (+kind default 'note', +stock_restored default false, +reissued_order_id). Existing notes become 'note'. Wrong customer adds rows to orders, order_items and order_payments (the new invoice); nothing is edited or deleted.

### Migration
db/migrations/010_credit_note_kinds.sql: NOT YET RUN on the server.

### Tests
- Run on the dev machine: `pnpm test`, 26 files, 198 tests pass. New:
  - cancelInvoiceRules (4): full note equals what is owed with a discount; rounding paisa on the last line with VAT; only what an earlier note left; nothing left refused.
  - cancelInvoice (6, real routes on PGlite): cancel to the paisa with stock unchanged (supervisor refused, reason needed, second cancel refused); "not served" restores stock and voiding takes it out again with the balance back; split bill and allocated receipts refused; wrong customer (head barista refused, same customer refused, new invoice on the visit day with items, KOT and cost, old one at 0, stock unchanged, reissue note not voidable, moving back works); with an item-wise note, move refused and cancel credits the rest; migration 010 runs twice and its checks hold.
- Typecheck api-server, lhc-cafe, libs clean; both artifacts build.
- Not run: the screens in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- The cancel or reissue note is dated today; the re-issued invoice is dated on the visit day (the rule for invoices).
- Stock is put back by today's recipe (same as cancelling an order).


## 2026-11-26: Migration 010 run

- The owner ran db/migrations/010_credit_note_kinds.sql on the server (after a backup) and deployed Cancel invoice and Wrong customer. The code had already reached main in commit d271248 ("commits for handoff 9") instead of its own branch. Recorded as run in CLAUDE.md and docs/HANDOFF.md.
- Files: CLAUDE.md, docs/HANDOFF.md, docs/CHANGELOG.md. No code or tables changed.


## 2026-11-26: Petty cash, CV number with an optional bill number

### Summary
- Skills used: ponytail, tdd, backend-patterns, react-patterns, database-migrations.
- Every petty cash payout from the drawer gets its own CV number (owner, 2026-11-25), in the same CV series as suppliers paid in cash from the drawer, in the fiscal year of the payout day. This covers the Cash Drawer payout and an expense on the Expenses page ticked "Paid from the cash drawer". Other expenses get no CV.
- The bill number is now optional on payouts. The Expenses page add form has a "Bill no. (if any)" field (the API now saves it).
- "Record payout and print CV" prints the cash voucher (CV no., date, paid to, bill no. or "No bill", what for, amount, Paid by / Received by / Approved by). Reprint from the Cash Drawer entries and the Expenses list. Excel export gains a CV no. column.

### Files
- New: db/migrations/011_petty_cash_cv.sql; api-server src/__tests__/pettyCashVoucher.test.ts; lhc-cafe src/lib/pettyCash.ts.
- Changed: lib/db/src/schema/expenses.ts (voucher_no, unique index); api-server src/lib/cashRules.ts, src/routes/cash.ts, src/routes/expenses.ts, src/__tests__/pettyCash.test.ts; lhc-cafe pages/cash-drawer.tsx, pages/expenses.tsx; CLAUDE.md; docs/HANDOFF.md.

### Tables
- Changed: expenses (+voucher_no text, unique index expenses_voucher_no_idx). Existing rows unchanged (no CV). New CV numbers use voucher_sequences type 'CV' (already used by supplier payments).

### Migration
db/migrations/011_petty_cash_cv.sql: NOT YET RUN on the server.

### Tests
- Run on the dev machine: `pnpm test`, 27 files, 202 tests pass. New or changed:
  - pettyCash (4): payout without a bill accepted; bill kept trimmed; amount and category checked; no bill and nothing about who or what refused.
  - pettyCashVoucher (3, real routes on PGlite): payouts continue the CV series after a supplier CV (00002, 00003), with and without a bill, shown on the drawer day with the right expected cash; an Expenses-page drawer expense gets the next CV and its bill number, a bank expense none; migration 011 runs twice, keeps old rows, refuses a duplicate CV.
- Typecheck api-server, lhc-cafe, libs clean; both artifacts build.
- Not run: the screens or the print in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- Petty cash shares the CV series with supplier cash payments (both are cash vouchers from the drawer).
- Without a bill, the payout must say who was paid or what it was for.
- Old payouts are not given CV numbers afterwards (numbers would be out of date order).


## 2026-11-26: Migration 011 run

- The owner ran db/migrations/011_petty_cash_cv.sql on the server (after a backup), merged petty-cash-cv into main from the terminal (678d04d) and deployed petty cash CV numbers. Recorded as run in CLAUDE.md and docs/HANDOFF.md.
- Files: CLAUDE.md, docs/HANDOFF.md, docs/CHANGELOG.md. No code or tables changed.


## 2026-11-26: Complimentary at payment, Rs 0 bills, HBL 3%

### Summary
- Skills used: ponytail, diagnosing-bugs, tdd, backend-patterns, react-patterns.
- Bug: a 100% discount bill could not be paid with any method (Nabil POS, cash, QR, all): the API refused every Rs 0 payment part ("Enter an amount above 0"). It was a validation rule, not a card fee. Now a Rs 0 bill settles with no payment method (payment_method 'none', no order_payments rows, invoice number given). Money entered against a Rs 0 bill, or a Rs 0 part on a real bill, is still refused.
- Complimentary (owner asked for a recommendation): guests the cafe treats use NC (at ingredient cost, Complimentary cost, name required, no payment method). New: "Complimentary (NC): not charged" in the payment dialog, so an open bill can become NC at the payment step (before, only at the POS when placing the order). Loyalty rewards stay a discount on the sale.
- HBL POS fee 3% for both LHC and Sulimha HBL POS: no code; the owner sets it in Settlements > Settings (both HBL rows from 3 to 3).

### Files
- New: api-server src/__tests__/zeroBillNc.test.ts.
- Changed: api-server src/lib/payments.ts (validateSplit Rs 0, summaryMethod 'none', label), src/routes/orders.ts (NC at the payment step), src/__tests__/payments.test.ts; lhc-cafe src/lib/payments.ts (label), src/pages/orders.tsx (Complimentary option, Rs 0 state); CLAUDE.md; docs/HANDOFF.md.

### Tables
- No schema change. orders.payment_method gets a new value 'none' for Rs 0 bills.

### Migration
None.

### Tests
- Run on the dev machine: `pnpm test`, 28 files, 207 tests pass. New:
  - payments (2): Rs 0 bill gives no parts whatever mode was picked, summary 'none'; money against Rs 0 and Rs 0 on a real bill refused.
  - zeroBillNc (3, real routes on PGlite): 100% discount then settle with Nabil POS parts, a single HBL mode, or no parts: paid, 'none', invoice number, no payment rows; Rs 0 part on a Rs 300 bill refused; complimentary at the payment step needs a name, then the bill is NC at cost (2 x 40 = 80), no payment rows, invoice number given, even if payment parts were sent.
- Typecheck api-server, lhc-cafe, libs clean; both artifacts build.
- Not run: the dialog in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- Loyalty rewards are a discount (Discounts allowed), not NC: the customer earned them by buying.
- A Rs 0 bill still gets an invoice number (IRD: one invoice per sale).

### Open questions
- A per-item reward (one free coffee on a bigger bill) still needs the discount % worked out by hand. A "reward item" button can be added if this is common.


## 2026-11-26: Reward item button (loyalty reward)

### Summary
- Skills used: ponytail, tdd, backend-patterns, react-patterns.
- Payment dialog (Orders): "Reward item (loyalty)" picks an item on the bill; one unit's price comes off the bill first, then any staff discount % on the rest. Never below Rs 0 (then "Settle Rs 0 bill"). Shown on screen, on the printed bill and the receipt preview; the order notes record "Loyalty reward: 1 x Latte (Rs. 150.00)" and the reason.
- Fix found on the way: a discount at the payment step replaced any discount already on the bill (e.g. given at the POS) in orders.discount_amount, while the total kept both. It now adds to it.

### Files
- Changed: api-server src/lib/payments.ts (billDiscount), src/routes/orders.ts (discount route: rewardItemId, adds to the earlier discount), src/__tests__/payments.test.ts, src/__tests__/zeroBillNc.test.ts; lhc-cafe src/pages/orders.tsx; CLAUDE.md; docs/HANDOFF.md.

### Tables
- No schema change.

### Migration
None.

### Tests
- Run on the dev machine: `pnpm test`, 28 files, 212 tests pass. New:
  - payments (3): reward then staff % (450, 150 off, 10% = 270); reward bigger than the bill gives Rs 0; staff % outside 0-100 refused.
  - zeroBillNc (2, real routes on PGlite): reward on a bill with Rs 10 already off gives 140 with total discount 160 and the note, an item from another bill refused, then paid by Nabil POS; a reward covering the whole bill settles as Rs 0 ('none').
- Typecheck api-server, lhc-cafe, libs clean; both artifacts build.
- Not run: the dialog or the print in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- One reward item per bill, one unit, at the price it was sold at.


## 2026-11-26: Plan for hotel room stays

### Summary
- Skills used: ponytail, backend-patterns, database-migrations.
- Wrote docs/specs/room-stays.md: a room stay ties bills together. Included breakfasts become credit invoices to Sulimha Durbar at cost, extras become credit invoices to the guest at menu prices, and check-out is one receipt (cash, QR or card on any machine) settling the extras, with a folio print. It reuses credit invoices, receivables and receipts. Draft migration 012 is described: hotel_rooms, room_stays, orders.room_stay_id and stay_charge, optional customer email, no_points, card modes on receipts.
- Nothing built. Eight questions for the owner and the accountant are in section 11.

### Files
- New: docs/specs/room-stays.md. Changed: CLAUDE.md, docs/HANDOFF.md.

### Tables
- None changed.

### Migration
None (012 is a draft in the plan, not written).

### Tests
- None (plan only).


## 2026-11-26: Room stays plan updated with the owner's answers

### Summary
- docs/specs/room-stays.md now has the owner's answers (section 12):
  - a fixed Rs 800 per breakfast, VAT added on top once registered;
  - only menu items marked breakfast;
  - Sulimha's reception opens stays (a new reception role, Stays page only);
  - no loyalty points for hotel guests;
  - the rooms are the tables 103 to 402.
- The plan is changed to match: hotel_rooms dropped for cafe_tables.is_room, menu_items.is_breakfast, orders.breakfast_count, a hotel_settings price, the reception role, and no_points dropped (points are off on stay orders).
- Five questions are still open (section 13): a guest who leaves with unpaid extras, the menu price as the stand-in cost, Rs 800 per person or per room, reception logins, whether the room tables exist.

### Files
- Changed: docs/specs/room-stays.md.

### Migration
None (012 is still a draft in the plan).

### Tests
- None (plan only).


## 2026-11-26: Hotel room stays (migration 012)

### Summary
- Skills used: ponytail, tdd, backend-patterns, react-patterns, database-migrations.
- Owner's answers (docs/specs/room-stays.md sections 12 and 14):
  - Rs 800 per person for an included breakfast, VAT on top later;
  - the menu price stands in for a missing recipe cost in LHC's cost view;
  - breakfast items only;
  - reception opens stays, with one login each;
  - no points;
  - the rooms are the tables named 103 ... 402;
  - a guest who leaves with unpaid extras: the admin moves them to Sulimha.
- **Room Stays page:** rooms with the guest, dates, breakfasts today against guests, and extras "paid" or "Rs X to pay at LHC". Check in (the guest is found by phone or added; email optional), change, check out, cancel (only with no bills). The folio with a check-out payment (receipt by cash, QR or any card machine, oldest bill first) and a folio print. History with Excel. Settings: the breakfast price and the Sulimha Durbar customer.
- **Payment screen (Orders), "Hotel room" box** (filled in when the bill is on a room table): pay now, charge to room (a credit invoice on the guest, no credit-limit warning), or included breakfast (a credit invoice to Sulimha Durbar at the price x breakfasts; breakfast items only; refused if breakfast is not included; warns of items with no recipe cost).
- **Reception role:** the API refuses everything except /api/stays and auth/me and change-password; the app shows only Room Stays. A Users page option.
- **Receipts:** the four card modes. Card receipts count in that machine's settlement, the card ledger, and the collections Excel (Receipts - Card).
- **Menu:** a Breakfast tick box. **NC label** is now "owner / staff".
- **No points** on stay bills (syncLoyaltyForOrder skips them).
- **Shared reissueInvoice** (from Wrong customer) moves unpaid extras to Sulimha when the admin closes a stay; the re-issued bill keeps its stay link.

### Files
- New: db/migrations/012_room_stays.sql; lib/db/src/schema/stays.ts; api-server src/lib/stayRules.ts, src/routes/stays.ts, tests stayRules, stays (.test.ts); lhc-cafe src/pages/stays.tsx.
- Changed:
  - lib/db schema: orders.ts, menu-items.ts, tables.ts, loyalty.ts, index.ts.
  - api-server: middlewares/auth.ts (reception guard), routes/orders.ts (roomCharge), routes/receivables.ts (reissueInvoice, card modes message), routes/menu.ts (isBreakfast), routes/settlements.ts, routes/ledgers.ts, routes/index.ts, lib/receivables.ts (no points on stay bills), lib/receivableRules.ts (card receipt modes), lib/ledgerData.ts (receiptsCard), lib/settlementRules.ts (card receipts), __tests__/settlements.test.ts.
  - lhc-cafe: App.tsx, components/layout/Sidebar.tsx, contexts/notifications.tsx, lib/payments.ts, pages/orders.tsx, pages/menu.tsx, pages/users.tsx, pages/ledgers.tsx, pages/pos.tsx.
  - Docs: CLAUDE.md, docs/HANDOFF.md, docs/specs/room-stays.md.

### Tables
- New: room_stays, hotel_settings.
- Changed:
  - cafe_tables (+is_room; the 12 room tables set);
  - orders (+room_stay_id, stay_charge, breakfast_count, check);
  - menu_items (+is_breakfast);
  - loyalty_customers (email optional);
  - customer_receipts (mode check adds the card modes).

### Migration
db/migrations/012_room_stays.sql: NOT YET RUN on the server.

### Tests
- Run on the dev machine: `pnpm test`, 30 files, 228 tests pass. New:
  - stayRules (6):
    - check-in cleaned, email optional, the required fields and dates;
    - breakfast bill 2 x 800 = 1600, a non-breakfast item and count 0 refused;
    - cost view 691 with the menu price for a no-recipe item.
  - stays (9, real routes on PGlite):
    - reception refused on orders and receivables, allowed on stays and auth/me; rooms listed by name;
    - check-in on rooms only, one open stay per room, guest without an email;
    - breakfast needs the Sulimha customer (admin-only setting), then Rs 1,600 on Sulimha, credit, stay fields, note, no-recipe list, LHC cost for the admin only, breakfasts today;
    - a non-breakfast item refused;
    - extras on the guest: reception sees only the amount owed, cannot close, cannot cancel with bills;
    - check-out by card on LHC HBL POS plus cash, no points, reception closes;
    - breakfast refused when not included; unpaid extras: supervisor refused, admin needs a reason, then the extra is re-issued to Sulimha;
    - cancel needs a reason;
    - migration 012 runs twice, marks rooms by name (with spaces), keeps emails, allows card receipts and an email-less customer, one open stay per room, and a breakfast bill needs a count. This test found and fixed a NULL gap in the check.
  - settlements (+1): card receipts go to their machine.
- Typecheck api-server, lhc-cafe, libs clean; both artifacts build.
- Not run: the screens in a browser; the reception login in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- Room charges are made on the payment screen (not the POS), because room bills often come from the room's QR.
- A guest found by phone is reused; a new guest goes on the customer list (with no points on stay bills).
- The breakfast warning counts adults plus children against the breakfasts used today; it never blocks.


## 2026-11-27: Migration 012 run

- The owner ran db/migrations/012_room_stays.sql on the server (after a backup), merged room-stays into main from the terminal (f8af8aa) and deployed hotel room stays. Recorded as run in CLAUDE.md and docs/HANDOFF.md.
- Files: CLAUDE.md, docs/HANDOFF.md, docs/CHANGELOG.md. No code or tables changed.


## 2026-11-27: Credit-note aware reports, Sulimha collections, breakfast line prices, not-served stock

### Summary
- Skills used: ponytail, tdd, backend-patterns, react-patterns, database-migrations.
- **Credit notes reduce sales.**
  - New readers in lib/ledgerData.ts: creditNotesBetween (active notes by Nepal note date, with the cost put back by not-served cancels), reissuedOrderIds and creditNoteEffect.
  - Collections: Credit notes and Net sales columns, VAT after notes; the totals reconcile.
  - Dashboard: today, the week and sales by day less notes; top items less credited items.
  - Profit: today and by day, revenue less notes and cost less the stock put back.
  - P&L: sales before notes, less credit notes, net sales; cost less the stock put back; Excel with the same lines and columns.
  - Order Log: each order shows its credit notes; paid sales after notes; profit after notes; CSV, Excel and PDF with Credit notes, Net after credit notes and Note columns.
  - **Wrong customer:** the reissue note is not a credit and the re-issued invoice is not counted, so the sale counts once, on the original invoice and day. The Order Log marks both ("Moved to ...", "Re-issue of ...: not counted again").
- **Sulimha's machines:**
  - Collections has a Sulimha POS column (bills and receipts on Sulimha's machines). Card is now LHC's machines only.
  - Sulimha's money is out of Money received until a Sulimha settlement is recorded; the transfer then counts on its settled date (Sulimha transfers column).
- **Hotel breakfast:** new breakfast invoices spread Rs 800 x breakfasts over the item lines in proportion to their menu value (to the paisa, the last line takes the remainder), so item and category reports add up to the invoice. Old invoices are not changed. The folio's cost view now uses the menu item's price as the stand-in cost.
- **Not served:** a cancel with "Not served" reverses the Stock Log movements the order recorded for each credited menu item (the sale, its prep waste, less any KOT cancelled), in proportion for a part credit. Older orders whose Stock Log lines have no menu item use today's recipe; the cancel's response says which ("stock": fromSale or fromRecipe). Voiding the note takes out exactly the lines it put back (found by the note number), falling back to the recipe only if none are found.
- **Docs:**
  - CLAUDE.md: the bill rule now applies to purchases and non-petty-cash expenses, and petty cash follows the owner's 2026-11-25 rule; a rule for reports and credit notes is added.
  - docs/HANDOFF.md: item 25; Known limits and Next work rewritten (stale items removed).

### Files
- New: api-server src/__tests__/collectionsCreditNotes.test.ts, src/__tests__/reportsCreditNotes.test.ts.
- Changed:
  - api-server: src/lib/ledgerData.ts, lib/stockMoves.ts, lib/stayRules.ts (allocateTotal); src/routes/ledgers.ts, routes/dashboard.ts, routes/opcosting.ts, routes/orders.ts (credit-note info on orders, profit/daily, breakfast allocation), routes/receivables.ts (stock reversal), routes/stays.ts (cost view).
  - api-server tests: sulimhaCards (collections expectation), stayRules (+2), stays (allocation).
  - lhc-cafe: pages/ledgers.tsx, pages/order-log.tsx, components/ProfitLoss.tsx, components/ProfitTodayCard.tsx.
  - Docs: CLAUDE.md, docs/HANDOFF.md.

### Tables
- None changed. New breakfast invoices store re-priced order_items.unit_price and subtotal at the moment they are billed.

### Migration
None needed.

### Tests
- Run on the dev machine: `pnpm test`, 32 files, 241 tests pass; typecheck api-server, lhc-cafe and libs clean; both artifacts build.
- New:
  - collectionsCreditNotes (4): note on its own day, reconciled totals; VAT follows the note; a moved sale counts once with no row for the reissue note; Sulimha column, received only by transfer.
  - reportsCreditNotes (7, real routes on PGlite):
    - Collections (sales 2,000, notes 1,000, net 1,000, received 250);
    - P&L (2,000 - 1,000 = 1,000, cost 320 - 160);
    - profit by day (revenue 1,000, cost 160);
    - dashboard (today's notes 1,000; top items 8 sold - 4 credited);
    - Order Log fields (credit notes, movedTo, reissueOf);
    - not served restores 0.3 L per latte as the sale took (today's recipe is 0.25), and voiding takes exactly that out again;
    - a part credit restores its share; an older order without menu items on its Stock Log uses today's recipe.
  - stayRules (+2): allocation 900:500 of 1,600 to the paisa, and by quantity when there is no menu value.
  - stays (+1 assertion): a breakfast bill's lines total Rs 1,600.
- Changed: sulimhaCards: Card 300, Sulimha POS 600, received 400 (was card 900, received 1,000), the owner's new rule.
- Not run: the screens in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- A credit note counts on its own date, not on the invoice's date, so closed days do not change.
- A Wrong-customer move is not a sales return: neither the note nor the re-issued invoice is counted.
- A Sulimha transfer counts in Money received at the amount received (after Sulimha's fee), on the settlement's date.
- Breakfast lines share the total by their menu value.


## 2026-11-27: Hotel breakfast invoices name the guest, room and breakfasts; breakfast preselected

### Summary
- Skills used: ponytail, tdd, backend-patterns, react-patterns.
- **Stay text on invoices:** an invoice charged to a stay now carries its stay text: "Hotel breakfast x N · Room R · Guest" for an included breakfast (billed to Sulimha Durbar), or "Room R · Guest (charged to room)" for an extra. It shows in:
  - the Order Log: a badge, and the reprinted bill (Billed To: Sulimha Durbar; Hotel breakfast (included): N x Rs. price; Room and Guest);
  - Receivables: under the invoice number in the invoices list, and in the ledger description, i.e. Sulimha Durbar's statement ("Credit sale · Hotel breakfast x 2 · Room 103 · Ram Thapa");
  - the API: orders and credit invoices carry `stay` {room, guestName, stayCharge, breakfastCount} and `stayText`.
- **Old invoices:** the text is read through orders.room_stay_id each time, so no invoice row is changed.
- **Payment screen:** when the bill's room has an open stay with breakfast included and every item is a breakfast item, "Included breakfast" is preselected and the count is filled from the stay's adults (it was adults less today's breakfasts). Order items now carry isBreakfast.
- **Warning (never a block):** when the stay's breakfasts today with this bill would be more than its guests (adults plus children). The dialog shows the counts, and the payment answer returns breakfastWarning, shown in the toast.

### Files
- New: api-server src/lib/stayInfo.ts (stayInfoByOrder).
- Changed: api-server src/lib/stayRules.ts (stayText, breakfastWarning), src/lib/receivables.ts (stay on credit invoices), src/routes/receivables.ts (ledger description), src/routes/orders.ts (stay on orders, isBreakfast on items, breakfastWarning); tests stayRules (+2), stays (+1); lhc-cafe pages/order-log.tsx, pages/receivables.tsx, pages/orders.tsx; docs/HANDOFF.md.

### Tables
- None changed.

### Migration
None.

### Tests
- Run on the dev machine: `pnpm test`, 32 files, 244 tests pass; typecheck api-server, lhc-cafe and libs clean; both artifacts build.
- New:
  - stayRules: stay text for a breakfast and an extra, and empty without a stay; the warning at 2+1 for 2 guests, none at 2+1 for 3, none at 0+2 for 2.
  - stays (real routes on PGlite):
    - Sulimha's statement: the invoice shows stay and stayText, and the ledger reads "Credit sale · Hotel breakfast x 2 · Room 103 · Ram Thapa";
    - GET /orders/:id has the stay text and Sulimha as the customer;
    - the bill's items carry isBreakfast;
    - a third breakfast today is saved (not blocked) with the warning.
- Not run: the payment dialog's preselect and the printed bill in a browser (the frontend has no test runner); anything against production.


## 2026-11-27: Plan for step 3 (ledger)

### Summary
- Skills used: ponytail, backend-patterns, database-migrations.
- Wrote docs/specs/step3-ledger.md:
  - tables: accounts with headers and an active flag, an expense-category map, immutable balanced journal entries and lines with customer/supplier sub-ledger ids, posting days, ledger settings, month closes; opening balances as one opening entry;
  - how every event posts, with its source document;
  - the next-day review screen with problems, late-change reversals and reconciliation against Collections, the drawer, Receivables, Payables and Settlements;
  - lock after N days and the Nepali month close;
  - the build in parts 3a (accounts and engine), 3b (sales, credit notes, receipts, settlements, review), 3c (purchases, payments, expenses, drawer, consumption) and 3d (lock and month close), with the tests for each.
- 13 questions for the owner and the accountant (section 12). Nothing built.

### Files
- New: docs/specs/step3-ledger.md. Changed: docs/HANDOFF.md.

### Migration
None (013 to 016 are drafts in the plan).

### Tests
- None (plan only).


## 2026-11-27: Ledger part 3a, accounts and the journal engine (migration 013)

### Summary
- Skills used: ponytail, tdd, backend-patterns, database-migrations, react-patterns.
- **Plan updated** (docs/specs/step3-ledger.md): the owner's and accountant's answers (section 13, CLAUDE.md "Step 3 answers"), the new accounts, the start date, lock 3 days, breakfast to 4020, other cash in/out accounts, stock differences to 5150, VAT bills stopped and the bank fields in 3b, the opening balances as a draft with an audit trail, and "3a as built" (section 14).
- **Migration 013:**
  - **accounts:** the approved chart with the headers 1000 and 2000, plus 1280 Receivable - Sulimha Durbar (card collections), 3050 Opening balance equity, 4020 Hotel breakfast income, 5150 Stock adjustment, and 7110 Petty cash, no bill (inactive).
  - **expense_account_map:** the 21 Expenses-page categories with the accountant's defaults, unconfirmed.
  - **journal_entries / journal_lines:** triggers refuse UPDATE and DELETE; a deferred trigger refuses an unbalanced entry at commit; lines only on postable, active accounts; one post per source; an entry is reversed once.
  - **ledger_settings:** start date 2026-12-16 (Poush 1, 2083 BS, worked out with the nepali-date-converter library), lock 3 days, opening balances "draft".
  - **opening_balance_lines and opening_balance_log.**
- **Engine:**
  - lib/glRules.ts (pure): check an entry's lines (balance, sides, accounts, the customer on 1300 and the supplier on 2100 only), the balance by normal side, the mirror for a reversal, the 3050 balancer.
  - lib/ledger.ts: postEntry (numbered JV-2083/84-00001, refused before the start date), reverseEntry, trialBalance, accountLedger.
  - lib/openingBalances.ts: fill from the app, add/change/remove with the log, confirm (admin) into one OP entry on the start date.
  - lib/fiscal.ts: bsLabel and adOfBs.
- **API (routes/gl.ts, admin and accountant):** /gl/settings, /gl/accounts (+ /:code/ledger), /gl/expense-map, /gl/journals (+ /:id, /:id/reverse), /gl/trial-balance, /gl/opening (fill, lines, confirm).
- **Screen:** a "Chart of Accounts" page (sidebar, admin and accountant):
  - the start date card (BS and AD, lock);
  - "To do before posting" (unmapped and unconfirmed categories, the opening draft);
  - tabs for Accounts, Expense categories, Journals, Trial balance and Opening balances.

### Files
- New: db/migrations/013_ledger_accounts_journal.sql; lib/db/src/schema/ledger.ts; api-server src/lib/glRules.ts, lib/ledger.ts, lib/openingBalances.ts, routes/gl.ts, tests glRules, gl (.test.ts); lhc-cafe src/pages/chart-of-accounts.tsx.
- Changed: lib/db/src/schema/index.ts; api-server src/lib/fiscal.ts, src/routes/index.ts; lhc-cafe App.tsx, components/layout/Sidebar.tsx; CLAUDE.md (roadmap line); docs/HANDOFF.md; docs/specs/step3-ledger.md.

### Tables
- New: accounts, expense_account_map, journal_entries, journal_lines, ledger_settings, opening_balance_lines, opening_balance_log. Nothing existing is changed; nothing is posted.

### Migration
db/migrations/013_ledger_accounts_journal.sql: NOT YET RUN on the server.

### Tests
- Run on the dev machine: `pnpm test`, 34 files, 259 tests pass; typecheck api-server, lhc-cafe and libs clean; both artifacts build.
- New:
  - glRules (7): balance to the paisa; refused unbalanced, single, two-sided, header, inactive and unknown accounts; the customer on 1300 and the supplier on 2100 only; the balance by normal side; the mirror; the 3050 balancer.
  - gl (8, real routes on PGlite with migration 013):
    - settings: 1 Poush 2083 / 2026-12-16, lock 3, 4 refused, 2 allowed, the start date by the admin only;
    - the JV engine: refusals, numbering, lines with the customer;
    - reversal: once, not of a reversal, the trial balance balanced;
    - the database refuses update, delete, unbalanced and header lines;
    - accounts: add, duplicate refused, inactive rules, 52 accounts;
    - the expense map: 21 defaults (milk to 1400, coffee to 1410), an in-use category without an account listed, confirm;
    - opening balances: fill (customer 700, stock 200/500), typed bank, change, the log, the accountant refused, the admin confirms into OP-2083/84-00001 balanced by 3050 (49,400), read-only after, the start date then fixed;
    - migration 013 runs twice (51 accounts, 2 headers, 1 inactive, 21 categories, the settings).
  - The trigger bug found by these tests is fixed: PL/pgSQL checks both branches of a CASE against the triggering row.
- Not run: the page in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- The opening entry uses its own number series (OP-...), because OB is already used for opening supplier bills.
- The lock setting allows 2 or 3 days only (the accountant's range).
- Opening balances filled "from the app" are today's figures and should be filled again on the start date.


## 2026-11-27: Ledger 3a fix: journal entry revisions (migration 013 edited)

### Summary
- Skills used: ponytail, tdd, database-migrations.
- **Design fix before 013 is run:** the unique index allowed one 'post' entry per source, but principle 5 needs a reversal followed by a corrected entry for the same source.
  - journal_entries gains `revision integer NOT NULL DEFAULT 1`.
  - The unique index journal_entries_source_idx is now (source_type, source_id, revision) for kinds 'post' and 'opening'.
- **Engine (lib/ledger.ts):**
  - postEntry gives a sourced 'post'/'opening' entry revision 1, or the next revision, but only when the revision in force has been reversed ("... is still in force for this document. Reverse it before posting the corrected entry.").
  - reverseEntry's reversal carries the revision it reverses.
  - Manual JVs stay revision 1.
- **Migration 013 is edited, not 014**, because CLAUDE.md does not mark 013 as run. Because main already holds the ledger-3a merge (and 013 may have been run on the server before the merge), the edited 013 also repairs an older run: `ADD COLUMN IF NOT EXISTS revision` and a rebuild of the index (DROP INDEX IF EXISTS, then CREATE).
- **Plan (docs/specs/step3-ledger.md):** principle 2 and the journal_entries table now describe revisions.

### Files
- Changed: db/migrations/013_ledger_accounts_journal.sql; lib/db/src/schema/ledger.ts; api-server src/lib/ledger.ts, src/__tests__/gl.test.ts; docs/specs/step3-ledger.md; docs/HANDOFF.md.

### Tables
- journal_entries: +revision (default 1); the unique index now covers revision.

### Migration
db/migrations/013_ledger_accounts_journal.sql (edited): NOT YET RUN on the server. If the first version was already run, running the edited file again adds the column and rebuilds the index.

### Tests
- Run on the dev machine: `pnpm test`, 34 files, 261 tests pass; typecheck api-server, lhc-cafe and libs clean; both artifacts build.
- New in gl:
  - post as revision 1;
  - a second post without reversing refused;
  - reverse (the reversal carries revision 1);
  - repost as revision 2;
  - a third without reversing the second refused;
  - reverse, then revision 3;
  - the database refuses a duplicate source and revision;
  - the trial balance nets to the revision in force (200);
  - migration 013 creates the (source_type, source_id, revision) index;
  - re-running the new 013 on a database built by the first 013 adds revision (default 1) and rebuilds the index.


## 2026-11-27: Migration 013 run

- The owner ran db/migrations/013_ledger_accounts_journal.sql on the server (the edited version, with journal_entries.revision and the (source_type, source_id, revision) index) and deployed ledger 3a with the revision fix (79247ba). Recorded as run in CLAUDE.md and docs/HANDOFF.md.
- **Open:** the owner has not yet said whether the first version of 013 had been run before the edit. Either way, the edited file leaves the same result; the check queries (the revision column and the index on revision) confirm it.
- Files: CLAUDE.md, docs/HANDOFF.md, docs/CHANGELOG.md. No code or tables changed.


## 2026-11-27: Ledger part 3b, posting of sales, credit notes, receipts and settlements (migration 014)

### Summary
- Skills used: ponytail, tdd, backend-patterns, react-patterns, database-migrations.
- **Migration 014:**
  - menu_categories.revenue_kind (food | beverage);
  - ledger_settings.vat_enabled (false);
  - bank_account (nabil | hbl) on customer_receipts, cash_movements and expenses;
  - cash_movements.account_code;
  - posting_days.
- **Operational changes:**
  - a receipt by bank, a drawer deposit, and an expense by bank transfer or cheque now require the bank;
  - other cash in/out requires its account (4200, 7100, 3000, 3100);
  - VAT bills are refused by the payment API ("VAT bills are stopped until LHC is VAT registered") and greyed out on the payment screen and the reprint, until the admin switches VAT on;
  - GET /gl/vat-status for every role.
- **Posting rules (lib/postingRules.ts, pure)**, one entry per document:
  - **Bills (SJ):** each part to its account: 1100 cash, 1270 QR, 1250/1260 LHC POS, 1280 Sulimha POS, 1300 credit with the customer; an older card with no machine goes to 1250, flagged. Sales go to 4000/4010 by the item's category at the gross item value. Also: 4950 for the discount; 4020 for a hotel breakfast; 2200 for VAT (flagged while VAT is off); a Rs 0 bill posts the sale and the full discount.
  - **Credit notes (SJ):** 4900 + 2200 against 1300. A Wrong-customer move is a 1300 to 1300 transfer between the customers.
  - **Receipts (RJ):** the mode's account, or 1200/1210 by the bank, against 1300.
  - **Settlements (ST):** the bank for what was received, 7000 for the fee, the machine cleared at gross.
- **Review and posting (lib/glPosting.ts; GET /gl/days, GET /gl/days/:day, POST /gl/days/:day/post):**
  - the blockers, must-fix and acknowledge problems, late changes and reconciliation (plan section 15);
  - posting in one transaction, the day row first;
  - late changes use journal revisions: reverse, then post at the next revision.
- **Screens (Chart of Accounts):**
  - "Post a day" (days list, review, problems, reconciliation, late changes, entries, totals, a note, Post);
  - "Menu categories" (Food / Beverage);
  - the VAT switch (admin).
  - **Other screens:** Receivables (the bank on a bank receipt), Cash Drawer (the bank on deposits, the account on other in/out), Expenses (the bank for bank transfer and cheque), Orders payment (VAT bill only when VAT is on), Order Log reprint (likewise).

### Files
- New: db/migrations/014_ledger_posting.sql; api-server src/lib/postingRules.ts, lib/glPosting.ts, tests postingRules, glPosting (.test.ts); lhc-cafe src/components/PostDay.tsx.
- Changed:
  - lib/db schema: menu-categories.ts, cash.ts, payments.ts, expenses.ts, ledger.ts.
  - api-server: routes/gl.ts, routes/orders.ts (VAT refusal), routes/receivables.ts (receipt bank), routes/cash.ts (deposit bank, other account), routes/expenses.ts (bank); __tests__/cancelInvoice.test.ts (its bank receipt names the bank).
  - lhc-cafe: pages/chart-of-accounts.tsx, pages/orders.tsx, pages/order-log.tsx, pages/receivables.tsx, pages/cash-drawer.tsx, pages/expenses.tsx.
  - Docs: CLAUDE.md, docs/HANDOFF.md, docs/specs/step3-ledger.md.

### Tables
- Changed: menu_categories, ledger_settings, customer_receipts, cash_movements, expenses (new columns, all nullable or defaulted).
- New: posting_days. Nothing existing is changed.

### Migration
db/migrations/014_ledger_posting.sql: NOT YET RUN on the server.

### Tests
- Run on the dev machine: `pnpm test`, 36 files, 279 tests pass; typecheck api-server, lhc-cafe and libs clean; both artifacts build.
- New:
  - postingRules (10):
    - a split bill of cash + QR + credit;
    - a discount;
    - Sulimha and HBL machines;
    - a breakfast to 4020;
    - a Rs 0 bill;
    - a VAT bill flagged;
    - must-fix (category, credit customer, mode) and acknowledge (card machine) problems;
    - a credit note with VAT, and a Wrong-customer transfer;
    - receipts in each mode, and a bank receipt needing the bank;
    - LHC, QR and Sulimha settlements with the fee.
  - glPosting (8, real routes on PGlite with 013 and 014):
    - blockers (before the start date, today, out of order) and must-fix problems (opening, category);
    - after the fixes: entries per invoice, lines, the drawer acknowledgement, and reconciliation equal (sales 1,425, receivables 300, Nabil POS 225);
    - posting needs a note, posts 5 entries, and only once; the trial balance is balanced;
    - day 2: a cancelled bill is reversed, a backdated bank receipt is posted late, and the Sulimha bill and the settlement post;
    - day 3: a changed bill is reversed and re-posted as revision 2;
    - VAT bills refused while VAT is off, and the admin alone switches it on;
    - the bank and account fields;
    - migration 014 runs twice, with its checks.
- Not run: the screens in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- Journal numbers have their own series, SJ (sales and credit notes), RJ (receipts) and ST (settlements), so the RV, CV and PV document numbers are not consumed.
- The ingredient cost put back by a not-served cancel posts with consumption in 3c, not in 3b.
- A day is posted only after it has ended (Nepal time).
- Confirmed opening balances are a must-fix before the first posting.


## 2026-11-27: Migration 014 run

- The owner ran db/migrations/014_ledger_posting.sql on the server (after a backup) and deployed ledger 3b (70fb1c9). Recorded as run in CLAUDE.md and docs/HANDOFF.md.
- Files: CLAUDE.md, docs/HANDOFF.md, docs/CHANGELOG.md. No code or tables changed.


## 2026-11-27: Ledger 3b fixes: Rs 0 bills, read-only preview, faster late check

### Summary
- Skills used: ponytail, tdd, backend-patterns, react-patterns.
- **Rs 0 bills:** saleEntry skips payment parts of Rs 0. A Rs 0 bill (payment_method 'none', no payment rows, so it reached the rules as a 'none' part of Rs 0) no longer raises "no account". A fully discounted bill posts sales at the gross value and the discount to 4950, with no payment line.
- **Preview a day** (Chart of Accounts > Post a day; GET /gl/preview/:day, admin and accountant):
  - any day that has ended, even before the ledger start date, shows what would post, the problems and the reconciliation;
  - the banner says "Preview", and there is no Post button;
  - the API marks canPost false and never writes;
  - posting stays only on POST /gl/days/:day/post, with its own checks.
- **Late check:** unposted late sources are found by the database: sources with no journal entry at all (NOT EXISTS on journal_entries), instead of re-reading every source since the start date.
  - Same results: a source with any entry is either in force (checked as a late change) or was reversed because it was cancelled or voided, which cannot be undone.
- **Fix found by the preview test:** the "already posted" check on a day's own sources now looks at every entry in force, whatever its date. A source posted late or re-posted on a later day is no longer shown again when that earlier day is previewed. Posting itself was not affected (a day's later days are never posted before it).

### Files
- Changed: api-server src/lib/postingRules.ts, src/lib/glPosting.ts, src/routes/gl.ts, tests postingRules (+2), glPosting (+2); lhc-cafe src/components/PostDay.tsx.

### Tables
- None changed.

### Migration
None.

### Tests
- Run on the dev machine: `pnpm test`, 36 files, 283 tests pass; typecheck api-server, lhc-cafe and libs clean; both artifacts build.
- New:
  - postingRules: a Rs 0 reward bill (a 'none' part of Rs 0) gives 4950 / 4010 with no problem; a Rs 0 bill from a 100% discount picked as card gives the sales and the discount only.
  - glPosting: a day with a Rs 0 reward bill and no payment rows posts cleanly, and the bill cancelled earlier is not picked up again as late. The preview:
    - staff refused, today refused;
    - before the start date it shows the entry and the reconciliation (sales 400 = 400) with canPost false;
    - a posted day previews as already posted with nothing left;
    - no journal entry or posting day is written;
    - POST on that day is still refused.
- Not run: the preview in a browser; anything against production.


## 2026-11-27: Ledger part 3c, purchases, payments, expenses, the drawer and consumption

### Summary
- Skills used: ponytail, tdd, backend-patterns, database-migrations, react-patterns.
- **No migration:** every field needed already exists.
- **Posting rules (lib/postingRules.ts, pure):**
  - **purchase bills (PB):** 1400 kitchen / 1410 drink lines at line total (VAT in cost), against 2100 with the supplier, 1100 (drawer) or 1200/1210 (cheque or online). A cheque or online bill with no bank is a must-fix; opening bills are not posted.
  - **supplier payments (SP):** 2100 with the supplier against 1100 or the bank; an advance takes the supplier below zero.
  - **debit notes (DJ):** 2100 against 1400/1410.
  - **expenses (EX):** through expense_account_map, against 1100 or 1200/1210 by the bank. Card or QR, a missing bank or an unmapped category is a must-fix. Petty cash with no bill is flagged "no bill" (acknowledge).
  - **cash movements (CM):** deposit 1200/1210, owner draw 3100, other in/out to its account.
  - **drawer close (CC):** short Dr 7050, over Cr 7050.
  - **consumption (CO), one per day:**
    - Dr 5000/5010 by category kind from the sold items' cost snapshots;
    - Dr 5200 for NC; Dr 5100 for Waste Log entries (value, or quantity x cost);
    - against 1400/1410 by the recipe's ingredient departments;
    - not-served cancels reverse their consumption;
    - items with no recipe cost flagged (acknowledge) with the sales they carry.
- **Review (lib/glPosting.ts):**
  - **Skipped rows:** expense rows of purchase bills, debit notes, the old Record purchase and settlement bank charges are never posted.
  - **Late changes:** every new type is reversed, re-posted at the next revision, or posted late. A day's consumption is rebuilt when its sales change, and a late sale on a day with no consumption entry adds one.
  - **New checks:**
    - cash: the day's 1100 movement against the Cash Drawer's expected change; the 1100 balance at the close against the count;
    - payables: total and each supplier, against credit bills less payments and debit notes as at the day;
    - stock: 1400/1410 against stock x cost now, information only.
- **Fix found by the tests:** a posted document's acknowledged problem (for example "no bill") came back on every later day's review. It now comes back only if the document's entry changes.
- **Screen:** information-only reconciliation rows show "ℹ" and never red.

### Files
- New: api-server src/__tests__/postingRules3c.test.ts, src/__tests__/glPosting3c.test.ts.
- Changed: api-server src/lib/postingRules.ts, src/lib/glPosting.ts, src/routes/cash.ts (computeDay exported), src/__tests__/glPosting.test.ts (the "no recipe cost" acknowledgement); lhc-cafe src/components/PostDay.tsx; CLAUDE.md; docs/HANDOFF.md; docs/specs/step3-ledger.md.

### Tables
- None changed.

### Migration
None.

### Tests
- Run on the dev machine: `pnpm test`, 38 files, 303 tests pass; typecheck api-server, lhc-cafe and libs clean; both artifacts build.
- New:
  - postingRules3c (11):
    - a credit bill with kitchen and drink lines;
    - drawer-paid and HBL cheque bills; a bill with no bank;
    - payments from the drawer and online; a payment with no bank;
    - a debit note;
    - petty cash with a bill, and with no bill (flagged);
    - cheque from HBL; card, a missing bank and an unmapped category refused;
    - a deposit, an owner draw, other in and out; a deposit with no bank;
    - a short and an over (and none at 0);
    - the full consumption entry (sold, NC, put back, waste, the no-cost flag) and an empty day.
  - glPosting3c (9, real routes on PGlite with 013 and 014), one worked day on 16 Dec:
    - three bills (credit, drawer, HBL cheque);
    - a payment with a Rs 500 advance and a debit note;
    - three expenses, the purchase expense row never posted;
    - "no bill" flagged on one petty cash only;
    - a deposit, an owner draw, a Rs 120 short;
    - consumption 5000 120 / 5010 40 / 5200 120 / 5100 40 against 1400 280 / 1410 40;
    - cash movement -4,150 = the drawer, cash at the close 1,730 = the count, payables -600 = Suppliers, sales 650; stock marked information;
    - 13 entries posted, the trial balance balanced.
  - On 17 Dec: a Rs 35 over, cash at the close 1,765 = the count, the 16th's acknowledged problem not raised again.
  - On 18 Dec: a supplier payment voided after posting is reversed.
- Not run: the review screen in a browser; anything against production.

### Decisions made (by Claude; please confirm)
- **Consumption's stock credit:** split between 1400 and 1410 by today's recipe cost of each menu item (the amount is the sale's snapshot). The confirmed answer credits inventory by ingredient department, and the snapshot has no per-ingredient split.
- **Cash expenses:** an expense paid in cash but not from the drawer also credits 1100 Cash on Hand.
- **Waste:** Waste Log entries for equipment are not posted (equipment is not stock).
- **Journal series:** purchases (PB), supplier payments (SP), debit notes (DJ), expenses (EX), cash movements (CM), drawer close (CC) and consumption (CO). The PJ, CV, PV and DN document numbers are untouched.


## 2026-11-27: Fixing room-charged bills; ledger 3c fixes (expenses cash, drawer re-close, waste department)

### Summary
- Skills used: ponytail, tdd, backend-patterns, react-patterns.
- **Room-charged bills (and any credit invoice) can be fixed where staff work:** Order Log (opened order), the Orders page (paid credit bill) and the Stays folio (extras and breakfasts).
  - **Admin and accountant:**
    - **Cancel invoice:** the existing cancel route, with a reason and "Food was not served, put the stock back".
    - **Credit note:** the existing item-wise dialog, moved into components/CreditNoteDialog.tsx and shared with Receivables.
    - **Move to another room:** an open stay.
  - **Others:** "To fix a mistake on this bill ask the admin or accountant (Cancel invoice)".
  - No new money logic.
- **Receipts in the way:** when a cancel or move is refused because receipts are allocated, the message is "The guest has already paid for this bill (Rs. X). Void receipt RV-... first."
- **Move to another room:**
  - POST /receivables/invoices/:id/move accepts stayId (an open stay, not the bill's own).
  - reissueInvoice takes an optional target stay: the new invoice gets that room_stay_id and keeps stay_charge.
  - Extras go to that stay's guest; an included breakfast stays billed to Sulimha Durbar and needs breakfast included.
  - Moving to Sulimha Durbar when a guest leaves keeps the stay as before.
  - A bill with an active reissue note no longer shows on its old folio.
- **a) Expenses:**
  - **Posting rule:** an expense paid in cash but not from the drawer is a must-fix ("paid in cash but not from the drawer: say which account it came from") and does not post.
  - **POST /expenses:** refuses cash without "paid from the drawer", and card or QR.
  - **PATCH:** refuses a change to such a method; an existing row keeps the method it has.
  - **Form:** "Paid from the cash drawer" is ticked by default, and new expenses offer no card or QR.
- **b) Drawer close:** the unposted scan counts a close as unposted when it has no entry in force (a reversed one does not count), so a drawer reopened and closed again posts its new difference.
- **c) Waste:** stock is credited by the ingredient's own department, or the waste record's when no ingredient is linked.

### Files
- New: lhc-cafe src/components/CreditNoteDialog.tsx, src/components/InvoiceFix.tsx; api-server src/__tests__/roomBillFixes.test.ts.
- Changed:
  - api-server: src/routes/receivables.ts (receipt names, move with stayId, reissueInvoice target stay), src/routes/stays.ts (moved bills off the folio), src/routes/expenses.ts (method rule), src/lib/postingRules.ts (cash not from the drawer), src/lib/glPosting.ts (drawer close in force, waste department), src/lib/stayRules.ts and src/lib/stayInfo.ts (stayId).
  - api-server tests: postingRules3c, glPosting3c, cancelInvoice (message), pettyCashVoucher (a bank-transfer expense names its bank).
  - lhc-cafe: pages/receivables.tsx (uses the shared dialog), pages/order-log.tsx, pages/orders.tsx, pages/stays.tsx, pages/expenses.tsx, components/InvoiceActions.tsx (wording).
  - Docs: docs/HANDOFF.md.

### Tables
- None changed.

### Migration
None.

### Tests
- Run on the dev machine: `pnpm test`, 39 files, 311 tests pass; typecheck api-server, lhc-cafe and libs clean; both artifacts build.
- New:
  - roomBillFixes (5):
    - a room extra cancelled as served keeps the stock, and with the tick puts it back, the folio then owing 0;
    - an included breakfast cancelled (Rs 1,600 off Sulimha);
    - an allocated receipt refused with "The guest has already paid for this bill (Rs. 500.00). Void receipt RV-... first.";
    - an extra moved to room 104: on Sita's folio with room_stay_id and stay_charge, gone from room 103's folio;
    - a breakfast moved stays on Sulimha;
    - every credit note dated today; staff refused.
  - postingRules3c: cash not from the drawer is a must-fix.
  - glPosting3c:
    - the waste record says "drink" but rice is kitchen, and stock is credited 1400;
    - a drawer reopened after posting reverses its short, and closed again with another count, the new Rs 50 short posts late;
    - expenses: cash not from the drawer, and card, refused; the drawer and a cheque with its bank allowed; a changed method refused; an existing cash row edited with its own method allowed.
- Not run: the screens in a browser; anything against production.

## 2026-11-27 (k): Ledger part 3d, the period lock and the Nepali month close

### Summary
- **The lock:** a posted day is locked once ledger_settings.lock_after_days (3) days have passed after it. Posted on day D, it is still open on D+3 and locked from D+4. A posted day inside the 3 days stays editable; a change then is reversed and re-posted on the next posted day (3b/3c).
- **One shared guard:** lib/periodLock.ts (assertOpenPeriod / lockGuard). Every write route that creates, edits, voids or backdates a document dated in a locked day refuses it with 400 `{ error, locked: true }`. The message gives the date (AD and BS), says it is locked, and says "Enter it on today's date or ask the admin to reopen the day." (or "the month" when its month is closed).
- **Paid bills:** cancelling or correcting a paid bill dated in a locked day is refused with "For a credit invoice use Cancel invoice (a credit note dated today); otherwise ask the admin to reopen the day." A credit note is always dated today, so it is never blocked: that is the way to fix a locked day.
- **Admin reopen of a locked day:**
  - Post a day > the day > Reopen day. Admin only; a reason is required.
  - It is logged in day_reopens (who, when, why).
  - The day is open again until it re-locks by the same rule, counted from the reopen date (reopened on the 20th, it locks on the 24th).
  - The accountant sees the locks but cannot reopen.
  - Refused for a day that is not locked, a day that is not posted, or a day in a closed month.
- **Month close (BS month):** Chart of Accounts > Month close. Allowed only when:
  - the month has ended;
  - every day in it, from the ledger start, is posted and locked;
  - the month-end checks agree, or a note acknowledges them. The checks are receivables, payables, the four machines, and the cash count when the last day's drawer is closed.
  - The close records who and when, the note, the trial balance totals and the checks.
  - A closed month locks every day in it, and an admin reopen of one of its days is refused until the month is reopened.
  - The accountant or the admin closes a month. Only the admin reopens it, with a reason (who, when and why are kept on the row). It can be closed again later, and the history keeps every close.
- **Screens:**
  - **Post a day list:** "locked", "locked · month closed" or "open for edits until <date>" on each posted day, and a panel on the day saying what that means.
  - **Month close tab:**
    - the months, each with its status and counts of days posted and locked;
    - the month's blockers and its checks;
    - its summary: income, expenses, profit and the number of entries;
    - the trial balance at the month end;
    - close or reopen, and the history;
    - Excel: the trial balance, with the month's movement and the balance to date, plus a summary sheet.
  - A refused write shows the server's message in the existing error toasts.

### Routes guarded (the date checked)
- Orders:
  - POST /orders with backdatedAt (the backdated day);
  - PATCH /orders/:id/cancel when the bill is paid (its paid day);
  - POST /orders/:id/corrections (the bill's paid day).
  - Paid-later bills post on the day they are paid, which is today, so settling a bill is not blocked.
- Receivables:
  - POST /receipts (receipt date);
  - POST /receipts/:id/void (receipt date);
  - POST /credit-notes/:id/void (note date).
- Settlements: POST /settlements (settled on); POST /settlements/:id/void (settled on).
- Purchases:
  - POST /purchase-bills (bill date) and POST /purchase-bills/:id/void (bill date);
  - POST /opening-bills (bill date);
  - POST /supplier-payments (payment date) and POST /supplier-payments/:id/void (payment date);
  - POST /debit-notes (note date) and POST /debit-notes/:id/void (note date).
- Expenses and petty cash:
  - POST /expenses (expense date);
  - PATCH /expenses/:id (the old date, and the new date when it moves);
  - POST /expenses/:id/void (expense date);
  - POST /expenses/copy-recurring (every date the copy would write; all or nothing).
- Cash drawer:
  - POST /cash/open and POST /cash/reopen;
  - through requireOpenDay: POST /cash/movements, POST /cash/movements/:id/void, POST /cash/payout (petty cash) and POST /cash/close.
- Waste: POST /waste (dated now: refused only inside a closed month); DELETE /waste/:id (the entry's Nepal day).
- Ledger: POST /gl/journals (the JV's date); POST /gl/journals/:id/reverse (the reversal's date).
- Not guarded, because they are always dated today:
  - Cancel invoice and Wrong customer / Move to another room (credit notes dated today, re-issued invoice on its visit day as before). Corrected in (m) below: the item-wise POST /credit-notes takes a date and is now guarded;
  - paying a bill;
  - room-stay charges: breakfasts and extras are invoices made now;
  - receipt allocation (it does not change the ledger).

### Files
- New:
  - api-server: src/lib/periodLock.ts, src/lib/monthClose.ts, src/__tests__/periodLock.test.ts, src/__tests__/monthClose.test.ts;
  - lhc-cafe: src/components/MonthClose.tsx;
  - db/migrations/015_period_lock.sql.
- Changed:
  - lib/db: src/schema/ledger.ts (posting_days.reopened_on, day_reopens, period_closes).
  - api-server lib: src/lib/fiscal.ts (bsYearMonthOf, bsMonthRange); src/lib/glPosting.ts (lock status in listDays, balanceChecksAt for the month end).
  - api-server routes: gl.ts (reopen, months, close, reopen month; guards on JV and reverse), orders.ts, receivables.ts, settlements.ts, purchases.ts, expenses.ts, cash.ts, waste.ts.
  - lhc-cafe: src/components/PostDay.tsx (lock status, Reopen day), src/pages/chart-of-accounts.tsx (Month close tab).
  - Docs: CLAUDE.md, docs/HANDOFF.md, docs/specs/step3-ledger.md (section 17).

### Tables
- posting_days: + reopened_on (date, null).
- New: day_reopens (day, reason, reopened_by, reopened_at).
- New: period_closes:
  - bs_year, bs_month, from_day, to_day;
  - status (closed or reopened), note, totals;
  - closed_by/at, reopened_by/at, reopen_reason;
  - at most one close in force per month (a unique partial index).

### Migration
- db/migrations/015_period_lock.sql. Run on the server by the owner (recorded 2026-11-27). Idempotent (tested twice on PGlite). Run it after a backup and before deploy.sh.
- Named 015, not 016 as asked: the last migration is 014, and 016 would leave a gap in the numbering.

### Decisions
- The lock is computed, not stored. lockOn = (reopened_on if later than the day, else the day) + lock_after_days + 1. Tightening lock_after_days to 2 takes effect at once.
- A day that is not posted is never locked by the day rule; only a closed month locks it. In practice a month cannot close with unposted days.
- The month-end checks reuse the posting checks with nothing pending. Stock stays information only.
- Closing needs a balanced trial balance, which the database's balance triggers already ensure.

### Tests
- Run on the dev machine:
  - `pnpm test`: 41 files, 380 tests pass;
  - typecheck clean for api-server, lhc-cafe and the libs;
  - both artifacts build.
- New, periodLock (60):
  - the lock rule;
  - the Post a day list: the 16th locked on the 20th, the 17th still open (D+3);
  - the boundary: the 17th locked on D+4;
  - each of 26 guarded routes refuses the locked day with the date and the message, and does not refuse the open day (the paid-bill routes name Cancel invoice);
  - a new credit note on a locked day's invoice is not blocked;
  - copy-recurring into locked dates is refused;
  - day reopen: the accountant gets 403, a reason is required, an open day cannot be reopened; then reopen, edit, still open on the 23rd, locked again on the 24th, with the log row;
  - migration 015 runs twice.
- New, monthClose (9), on Poush 2083:
  - refused before the month ends;
  - refused with a day not posted;
  - refused with a posted day not locked yet;
  - refused with a failing receivables check and no note, then closed by the accountant with a note;
  - the closed month's trial balance balances, with the summary (rent 5,000, profit -5,000);
  - a late expense in the closed month is refused ("its month is closed"), and the admin's day reopen there is refused;
  - month reopen: admin only, with a reason; afterwards a day reopen works;
  - closed again after that day re-locks, with a history of 2.
- Not run: the screens in a browser; anything against production.

## 2026-11-27 (l): Migration 015 recorded as run
- The owner ran db/migrations/015_period_lock.sql on the server. Recorded in CLAUDE.md, docs/HANDOFF.md and the 3d entry above. Docs only; no code, no SQL, nothing to deploy.

## 2026-11-27 (m): Two fixes to ledger 3d

### Summary
1. **Item-wise credit notes:** POST /credit-notes takes a note date, so it is now guarded ("This credit note"). A note dated in a locked day is refused; one dated today is accepted. The 3d entry wrongly said every credit note is dated today: only Cancel invoice and Move are.
2. **Days before the ledger start:** once ledger_settings.opening_status is 'confirmed', every day before ledger_settings.start_date is locked.
   - lockStatusOf returns them as not posted, locked: true, beforeStart: true.
   - The message reads: "<what> is dated <day> (<BS>), which is before the ledger start (the opening balances are confirmed); enter it on today's date or ask the admin."
   - The admin day reopen is refused for these days ("before the ledger start ... cannot be reopened"). The Post a day list starts at the start date, so it never offers one.
   - The same guard covers every route listed in 3d, including POST /opening-bills: once the opening balances are confirmed, an opening bill dated before the start is refused.
   - The start date itself is not locked by this rule.
   - Before confirmation nothing changes: pre-start documents are still accepted.

### Files
- api-server:
  - src/routes/receivables.ts;
  - src/lib/periodLock.ts (beforeStart);
  - src/lib/monthClose.ts (reopen refusal);
  - new test src/__tests__/periodLockStart.test.ts;
  - src/__tests__/glPosting3c.test.ts: the "existing row keeps its method" expense moved from 2026-12-10 to 2026-12-18, because a pre-start date is now locked after confirmation.
- Docs: docs/CHANGELOG.md.

### Tables and migration
None.

### Tests
- Run on the dev machine:
  - `pnpm test`: 42 files, 386 tests pass;
  - typecheck clean for api-server, lhc-cafe and the libs;
  - both artifacts build.
- New, periodLockStart (6):
  - before confirmation, a November opening bill is accepted;
  - after confirmation, a purchase bill, an opening bill, a receipt, an expense and a drawer movement dated in November are refused with the before-start message;
  - the start date is not locked;
  - the admin cannot reopen a November day;
  - an item-wise note dated on a locked day is refused, and one dated today is accepted.
- Not run: the screens in a browser; anything against production.

## 2026-11-27 (n): Step 4 plan (reports from the ledger)
- Wrote docs/specs/step4-reports.md, a plan only; nothing is built.
- It covers:
  - Day Book, General Ledger with drill-down, Cash and Bank Books, Trial Balance (as at and for a period);
  - Profit and Loss, Balance Sheet, customer and supplier statements from the journal, and the month-against-month comparison;
  - admin and accountant only, read-only, Excel and PDF with BS dates and lakh grouping, performance for a year of data;
  - 15 questions for the accountant, each with a recommended answer;
  - build parts 4a, 4b and 4c with their tests.
- Proposed migration 016_report_indexes.sql (indexes only) for 4a; not written yet.
- Open: the "Aegis-style" comparison format is not described anywhere; the accountant is asked for a sample (question 9.8).

## 2026-11-27 (o): Ledger part 3e, stock adjustments post to 5150

### Summary
- **What counts as an adjustment:** a stock change made by hand is now marked on the Stock Log (inventory_logs.kind = 'adjustment'), with the ingredient's cost per unit at that moment (inventory_logs.unit_cost). The four places:
  - POST /inventory/:id/adjust by the admin;
  - the admin's approval of an adjustment request (POST /inventory/requests/:id/approve);
  - the admin's direct stock edit in PATCH /inventory/:id;
  - the "Initial stock" log when an ingredient is created with stock above 0.
- **Every other log stays kind null:** orders, purchases, debit notes, waste, cancels and an ingredient created at 0. Their own documents post them.
- **Posting:** one entry per adjustment, source_type 'stock_adjustment', source_id = the log id, voucher type SA, dated on the log's Nepal day.
  - An increase is Dr 1400 (kitchen) or 1410 (drink), by the ingredient's department, Cr 5150. A decrease is Dr 5150, Cr 1400/1410.
  - The amount is |change| x unit_cost.
- **No cost:** a log with no cost (unit_cost null or 0) is an acknowledge-level problem, "Stock adjustment #<id>: adjustment of <item> (<+/-change unit>) with no cost, not posted."
- **Where it appears:** in the day review, the totals, the unposted-sources scan (a late log is added on the next posted day) and the late-change check.
  - A Stock Log row never changes once written, so a posted adjustment is never re-checked, only added.
  - Logs before the ledger start are never posted: the review and the scan start at the start date.
- **Stock check:** 1400/1410 against stock x cost stays information only. Its note now says what is left to explain: cost-per-unit changes since the stock was bought, sales or waste with no cost, adjustments with no cost, and days not posted yet.
- **Step 4 plan:** stock_adjustment added to the drill-down list (Inventory > Stock Log) and SA to the Day Book voucher types. The report indexes planned as migration 016 are now 017_report_indexes.sql.

### Files
- New: db/migrations/016_stock_adjustments.sql; api-server src/__tests__/stockAdjustments.test.ts.
- Changed:
  - lib/db: src/schema/inventory.ts (kind, unitCost);
  - api-server: src/routes/inventory.ts (the four hand changes); src/lib/postingRules.ts (stockAdjustmentEntry, STOCK_ADJUSTMENT); src/lib/glPosting.ts (adjustment sources in the review, the scan and the totals; the posted ones skipped in the late check; the stock note);
  - Docs: CLAUDE.md, docs/HANDOFF.md, docs/specs/step3-ledger.md (section 18), docs/specs/step4-reports.md (drill-down, SA, 017).

### Tables
- inventory_logs: + kind (text, null or 'adjustment', with a check); + unit_cost (numeric(12,4)); a partial index on created_at where kind = 'adjustment'.
- No existing row changed: older logs stay kind null and never post.

### Migration
- db/migrations/016_stock_adjustments.sql. Run on the server by the owner (recorded 2026-11-28). Idempotent (tested twice on PGlite). Run it after a backup and before deploy.sh: the new code writes the new columns, so the API must not be deployed before it.

### Decisions
- The direct edit snapshots the cost after the same request's change, so an edit that sets both the stock and a new cost values the change at the new cost.
- An adjustment that rounds to under Rs 0.01 posts nothing and raises nothing.
- An ingredient with no department recorded is treated as kitchen (1400).
- The hand changes are dated now, so they never meet the day lock. Only a closed month could lock today, and that cannot happen while the month is running.

### Tests
- Run on the dev machine:
  - `pnpm test`: 43 files, 398 tests pass;
  - typecheck clean for api-server, lhc-cafe and the libs;
  - both artifacts build.
- New, stockAdjustments (12), through the real routes on 16 Dec 2026:
  - the Stock Log kinds and costs;
  - a new ingredient with starting stock (Dr 1400 200 / Cr 5150);
  - an increase on a drink (Dr 1410 500);
  - a decrease (Dr 5150 40);
  - a head chef's request approved by the admin (Dr 5150 20);
  - a direct edit (Dr 1400 40);
  - an ingredient with no cost (the ack with "+3 kg");
  - a pre-start log never in the review or the journal;
  - the day balances with 5150 at Dr 60 / Cr 740;
  - posting gives five SA entries, and nothing again the next day;
  - the rule's zero-cost and rounding cases;
  - migration 016 runs twice.
- Not run: the screens in a browser; anything against production.

## 2026-11-28: Migration 016 recorded as run
- The owner ran db/migrations/016_stock_adjustments.sql on the server. Recorded in CLAUDE.md, docs/HANDOFF.md and the 3e entry above. Docs only; no code, no SQL, nothing to deploy.

## 2026-11-28: Reports part 4a, the books from the ledger

### Summary
- **New Reports page** (/reports, sidebar "Reports", admin and accountant only), with four tabs. Each reads the journal only and is a GET.
  - **Day Book:** every voucher by day with its lines, day totals and the total for the whole filter. Filters: voucher type (SJ ... SA, JV, OPEN), kind (posted, correction, late, reversal, manual, opening), account, customer or supplier, and text in the narration, reference or voucher number. 200 vouchers a page.
  - **General Ledger:** one account, with the opening balance, each line (date in BS and AD, voucher, the other side of the entry, narration, party, memo), the running balance with Dr/Cr, the period totals and the closing. 500 lines a page; the running balance is computed over the whole period, so a page never changes it.
    - 1300 and 2100 take a customer or supplier; without one, a list of every party's opening, debit, credit and closing.
    - A header account shows a summary of its children.
  - **Cash and Bank Books:** 1100, 1200 and 1210 in book form: receipts, payments, the balance, a closing line per day, and a reference column for the banks. The Cash Book shows the drawer's counted cash on closed days beside the closing.
  - **Trial Balance:** for the period (six columns: opening, period and closing, Dr and Cr, grouped by type with subtotals) or as at a date. Accounts with nothing in them are hidden by default.
- **Periods** in BS: a BS month, a fiscal year (Shrawan 1 to the end of Ashadh; 2083/84 starts at the ledger start), one day, or from-to. Every report shows its period in BS and AD, "Posted up to <day>", and "<n> day(s) in this period are not posted yet; their figures are not included." A period before the ledger start says so.
- **Amounts** are in lakh grouping (1,23,45,678.50), with negatives in brackets.
- **Drill-down:**
  - Any voucher number opens its entry: lines with names, what it reverses or what reversed it, and the other entries for the same document.
  - The entry shows its source document read-only (fields and items) with an "Open in <page>" button. Only the purchase bill opens the exact document on its page (/suppliers?bill=); the other pages have no deep links yet, so the button opens the page.
  - Consumption entries open the new Consumption view (every consumption entry of the day, with lines and memos). It is also reachable as /reports?consumption=<day>.
  - Every source_type is covered, stock_adjustment included.
- Chart of Accounts > Trial balance now points to the Reports page.

### Endpoints (all GET, admin and accountant; 403 for everyone else)
- /reports/meta;
- /reports/day-book;
- /reports/ledger/:code;
- /reports/book/:code (1100, 1200, 1210);
- /reports/trial-balance (?to= as at; ?month, ?fy, ?day or ?from&to for the period);
- /reports/entries/:id;
- /reports/source/:type/:id;
- /reports/consumption/:day;
- /reports/parties.

### Files
- New:
  - api-server: src/lib/reports/periods.ts, src/lib/reports/books.ts, src/lib/reports/drilldown.ts, src/routes/reports.ts; src/__tests__/reports4a.test.ts, src/__tests__/reportsPerf.test.ts;
  - lhc-cafe: src/pages/reports.tsx, src/components/reports/common.tsx;
  - db/migrations/017_report_indexes.sql.
- Changed: api-server src/routes/index.ts; lhc-cafe src/App.tsx, src/components/layout/Sidebar.tsx, src/pages/chart-of-accounts.tsx; CLAUDE.md, docs/HANDOFF.md, docs/specs/step4-reports.md (section 12).

### Tables and migration
- No table or column changes.
- db/migrations/017_report_indexes.sql, indexes only:
  - journal_lines(account_code, entry_id);
  - journal_lines(customer_id) and journal_lines(supplier_id), each where not null;
  - journal_entries(voucher_type, entry_date).
- Run on the server by the owner (recorded 2026-11-28). Idempotent (tested twice). The reports work without it, only slower on a large journal, but run it before deploying as usual.

### Decisions
- The Day Book's "correction" and "late" kinds are posted entries whose narration says "(corrected: ...)" or "(late: ...)", as glPosting writes them.
- The source document is shown inside Reports instead of adding deep links to eight pages. It reads that document's own table for its fields; every amount in the reports still comes from the journal.
- The Trial Balance "as at" on the Reports page takes the end date of a one-day or from-to period, otherwise today.

### Tests
- Run on the dev machine:
  - `pnpm test`: 45 files, 431 tests pass;
  - typecheck clean for api-server, lhc-cafe and the libs;
  - both artifacts build.
- New, reports4a (20), on the step 3c worked days plus a credit customer:
  - BS periods: Poush 2083, FY 2083/84 from the ledger start, FY 2084/85 from Shrawan 1 to the end of Ashadh, a day, a bad range;
  - "Posted up to" on every report, and the warning (3 unposted days of Poush to the 20th; none for a posted day; before the start);
  - Day Book totals equal the Trial Balance movement; each voucher-type filter returns only its type and they add up to all; the kind, account, customer and text filters;
  - General Ledger: opening + movement = closing for every account with entries, on both normal sides; the closing equals the Trial Balance; the other side; page 2 changes no total;
  - the 1300 and 2100 party lists add up to the account, and one party's ledger equals its line (Asha 500 - 300 = 200); a header summary; an unknown account gives 404;
  - Cash Book: the closing equals 1100, and the 16th and 17th equal the counts (1,730 and 1,765); Bank Books equal 1200 and 1210; 1300 is refused as a book;
  - Trial Balance: opening + movement = closing per account, and all six columns and the subtotals balance; the period closing equals the as-at balance; hide-zero;
  - drill-down: every source_type in the posting code has a link; every entry opens, and a source document opens for every source type in the journal; the purchase bill opens its own bill; the Consumption view;
  - staff and supervisor get 403 on every route;
  - reports never write: every table's row count is unchanged after calling every endpoint;
  - migration 017 runs twice.
- New, reportsPerf (13): a generated year (50,000 entries, 200,000 lines, 50 customers, 20 suppliers) on PGlite.
  - Every endpoint answered in under 0.5 seconds; the limit is 5 seconds.
  - The year's Day Book total equals the Trial Balance movement.
- Not run: the screens in a browser; anything against production.

## 2026-11-28 (b): Migration 017 recorded as run
- The owner ran db/migrations/017_report_indexes.sql on the server. Recorded in CLAUDE.md, docs/HANDOFF.md and the 4a entry above. Docs only; no code, no SQL, nothing to deploy.

## 2026-11-28 (c): Reports part 4b, the statements

### Summary
Four new tabs on the Reports page (admin and accountant). Each reads the journal only, is a GET, and shows "Posted up to" with the unposted-days warning.
- **Profit and Loss** (GET /reports/profit-loss?(day|month|fy|from&to)&compare=prev|none). The layout is the one in CLAUDE.md "Step 4 decisions":
  - Revenue (4000, 4010, 4020, 4100), Gross sales, Less: Discounts 4950, Less: Sales returns 4900, Net sales.
  - Cost of sales (5000, 5010, 5200, 5100, 5150, and 5300 as "Other direct costs"), Gross profit with GP %.
  - Operating expenses (6000 to 6800, 7000, 7050 net as "Cash short/(over)", 7100, and 7110 only while active), Operating profit.
  - Other income 4200, Net profit.
  - **Columns** (config in lib/reportLayout.ts): this period, % of net sales, previous period, %, change Rs, change %, fiscal year to date, %.
  - **Last year:** "same period last year" and "last year to date" appear only when that period has ledger data (from Poush 2084); until then the reason is shown.
  - **Key ratios:** gross profit %, food cost % (5000/4000), beverage cost % (5010/4010), salaries % (6000), prime cost % ((cost of sales + 6000) / net sales).
  - **Check:** the net profit is checked against the Trial Balance's income less expenses (a red line if they differ).
- **The highlight rule:** a change is coloured only when above 20% AND above Rs 1,000. Green when it helps profit (income up, costs down), red when it hurts.
  - Both numbers are settings in report_settings (migration 018). The admin changes them on the Compare tab (PATCH /gl/report-settings, admin only), so every /reports route stays a GET.
- **Balance Sheet** (GET /reports/balance-sheet?at&compare=prev|none). The layout is 4.6:
  - customers who owe under assets, suppliers with a debit balance on 2100 as "Advances to suppliers" under assets;
  - suppliers we owe under liabilities; 2360 plus customers with a credit balance on 1300 as "Customer advances" under liabilities;
  - 1600 at cost with "No depreciation charged";
  - equity: 3000, Less: Drawings 3100, 3050 on its own line, Retained earnings (3200 plus the profit of every earlier fiscal year), Profit for the current fiscal year to date. The profit is split at Shrawan 1.
  - **Columns:** at the date, at last month end, change, and the fiscal year start (the opening entry alone in the ledger's first year).
  - A red line appears if total assets differ from total liabilities and equity.
- **Unplaced accounts:** an active account the layout does not place shows under "Other (not yet placed)" in the P&L, or in its Balance Sheet section, so the totals still agree.
- **Compare** (GET /reports/compare?period=month&at=2083/09, or period=fy&at=2083/84): the P&L with the previous period beside the Balance Sheet at the period's end.
- **Statements:**
  - **Customer** (GET /reports/customers/:id/statement): 1300 for one customer. Opening, then each invoice, credit note, cancelled invoice, re-issue, receipt and correction with a running balance, the closing ("owes us" or "paid in advance"), and the phone and credit days.
  - **Supplier** (GET /reports/suppliers/:id/statement): 2100 for one supplier. Bills, opening bills, payments (advances included) and debit notes; the closing is "we owe" or "advance paid"; with the PAN.
  - **Agreement:** each says whether its closing agrees with the Receivables or Suppliers screen balance at the last posted day.
  - **Summaries:** GET /reports/customers and /reports/suppliers show each party's opening, debits, credits and closing, with a total that is checked against 1300 or 2100.

### Files
- New:
  - api-server: src/lib/reportLayout.ts, src/lib/reports/statements.ts; src/__tests__/reports4b.test.ts, src/__tests__/statements4b.test.ts;
  - lhc-cafe: src/components/reports/statements.tsx;
  - db/migrations/018_report_settings.sql.
- Changed:
  - lib/db: src/schema/ledger.ts (reportSettingsTable);
  - api-server: src/lib/reports/periods.ts (period kinds; previous, last-year and year-to-date periods; fyStartOf), src/lib/glPosting.ts (receivablesAsOf and payablesAsOf exported), src/routes/reports.ts, src/routes/gl.ts (PATCH /gl/report-settings);
  - lhc-cafe: src/pages/reports.tsx;
  - Docs: CLAUDE.md, docs/HANDOFF.md, docs/specs/step4-reports.md (section 13).

### Tables and migration
- New: report_settings (one row: highlight_pct 20, highlight_min 1000, updated_by, updated_at).
- db/migrations/018_report_settings.sql. Run on the server by the owner (recorded 2026-11-28). Idempotent (tested twice). Without it the reports use 20% and Rs 1,000, but saving the setting fails, so run it before deploy.sh as usual.

### Decisions
- **Previous period:** the month before, the fiscal year before, the day before, or the same number of days just before a custom range.
- **Same period last year:** the same BS month or fiscal year, or the same BS days one year earlier. It is shown only when it starts on or after the ledger start.
- **Fiscal year to date:** from Shrawan 1, or from the ledger start in 2083/84.
- **The Balance Sheet on the screen** is drawn at the end of the period chosen on the page (never after today). Its date can be changed.
- **Colours:** the P&L's changes are coloured good or bad; the Balance Sheet's change column is shown without colour.

### Tests
- Run on the dev machine:
  - `pnpm test`: 47 files, 464 tests pass;
  - typecheck clean for api-server, lhc-cafe and the libs;
  - both artifacts build.
- New, reports4b (24): a worked ledger from journal entries with known numbers.
  - **Poush 2083 P&L line by line:**
    - gross sales 83,000, net sales 80,000;
    - cost of sales 23,200, gross profit 56,800 (71%);
    - operating expenses 22,250, operating profit 34,550, other income 700, net profit 35,250;
    - 4000 at 56.25% of net sales;
    - food cost 33.33%, beverage 30%, salaries 15%, prime cost 44%;
    - 7110 hidden while inactive;
    - the last-year column empty with its reason.
  - **Net profit against the Trial Balance:** equal for a day, a month, FY 2083/84 and a custom range. FY 2083/84 is 39,350.
  - **Comparison, Magh against Poush:**
    - food -15,000 (-33.33%), electricity +1,500 (+100%) and course fees -10,000 are highlighted as bad;
    - cash short +200 (+200%) is not highlighted, being under Rs 1,000;
    - salaries +4.17% is not highlighted;
    - year to date 38,450;
    - the last-year columns appear for Poush 2084 with Poush 2083's 35,250;
    - compare=none drops the columns;
    - the accountant cannot change the rule; the admin's change takes effect.
  - **Balance Sheet:**
    - balances at the ledger start (150,000), mid-month line by line (cash 43,500, receivables 4,000, supplier advance 2,500, payables 40,000, customer advance 1,500, drawings 3,000 deducted, opening balance equity 1,000, profit 35,250, total 2,24,750), at the month end, and after the Falgun reversal and repost;
    - profit split at Shrawan 1 (retained 39,350 and current 9,000 in Shrawan 2084);
    - the compare columns, including the opening as the fiscal-year start;
    - unplaced 1700 and 6900 under "Other (not yet placed)", still balancing.
  - **Other:** the side-by-side view; migration 018 runs twice and keeps one row.
- New, statements4b (9): the step 3c worked days plus two customers, posted through the real routes.
  - Asha's statement: invoice 500, receipt 300, closing 200, agrees with Receivables; credit days 15.
  - Bikash's statement: -400 paid in advance, agrees.
  - The customer summary equals 1300 (-200).
  - Valley Traders: bill, payment and debit note, -600 advance paid, agrees with the supplier ledger. The supplier summary equals 2100.
  - The Balance Sheet on posted data: supplier advance 600, customer advance 400, drawings 100, balanced.
  - Staff and supervisor get 403 on every new route; no route writes (all row counts unchanged).
- Not run: the screens in a browser; anything against production.

## 2026-11-28 (d): Migration 018 recorded as run
- The owner ran db/migrations/018_report_settings.sql on the server. Recorded in CLAUDE.md, docs/HANDOFF.md and the 4b entry above. Docs only; no code, no SQL, nothing to deploy.

## 2026-11-28 (e): Reports part 4c, Excel and PDF exports, and three 4b fixes

### Summary
- **The plan first:** docs/specs/step4c-exports.md, approved by the owner with the answers in its section 10 (recorded in CLAUDE.md "Step 4 decisions").
- **Part A, the 4b fixes:**
  1. **changeOf:** from a previous figure of 0, changePct stays null and the row is highlighted when |change| is above highlight_min, toned by direction.
  2. **The key ratios table:** now has a header row with the P&L's column and period labels (available columns only).
  3. **PATCH /gl/report-settings:** takes highlightPct 0 to 1,000 and highlightMin 0 to 1,00,00,00,000 only. Anything else, a non-number included, gets 400 with "The highlight percentage must be between 0 and 1,000." or "The highlight amount must be between 0 and 1,00,00,00,000."
- **Part B, the exports:** every report downloads as Excel (.xlsx) and PDF:
  - Day Book, General Ledger, Cash Book, Bank Books, Trial Balance (period and as at);
  - Profit and Loss, Balance Sheet, Compare;
  - customer and supplier statements, and the all-customers and all-suppliers summaries.
- **The route:** GET /reports/export/:report?format=xlsx|pdf&<the same query as the screen>. It is GET only, for the admin and the accountant (403 for others); nothing is written and no audit row is made.
  - The adapters (lib/reports/exportDocs.ts) call the same lib/reports functions as the screen and only reshape their JSON.
  - The builders are in lib/reportExport.ts: Excel through exceljs's streaming writer, PDF through pdfmake. The formatting helpers are in lib/reportFormat.ts.
- **Every file:**
  - **Header block:** Legendary House Cafe & Barista Coffee School; Sulimha Durbar, Patan · PAN 194139113; the report name; the period in BS with the AD dates; "Posted up to <BS date (AD date)>"; the unposted-days warning as on the screen; any party details; "Generated <date time> (Nepal time) by <user>".
  - **PDF footer:** "<report> · Page x of y".
- **Excel:**
  - **Values:** money as real numbers rounded to the paisa, in `#,##0.00;(#,##0.00);"-"` (books show 0.00); percentages as real percentages (`0.0%`); a date column split into the BS date (text) and the AD date (a real date).
  - **Layout:** headings, subtotals and totals bold, with a border over totals; the column-heading row frozen; widths set per column; one sheet per report (Compare has "Profit and Loss" and "Balance Sheet").
  - **Highlights:** a highlighted change is filled light green or light red, with the rule text under the table.
  - **No formulas:** totals are the values the server computed and checked.
  - **Large files:** the Day Book, ledgers, books and statements are written page by page, row by row, so a full year never sits in memory.
- **PDF:**
  - **Orientation:** A4 landscape for the Day Book, General Ledger, books, the period Trial Balance, Compare, and a P&L with comparison columns; portrait for the rest.
  - **Layout:** the column headings repeat on every page; highlighted changes keep their fill; statements end with "Prepared by / Checked by".
  - **Names:** a name the standard font cannot draw shows as "(name in Excel) customer #<id>".
  - **Size limit:** above 5,000 vouchers (Day Book) or lines (ledgers, books, statements) the PDF is refused with "Too many lines for a PDF: use Excel, or narrow the period."
- **File names:** LHC_<Report>_<period>, safe characters only, e.g. LHC_ProfitLoss_2083-09.xlsx, LHC_BalanceSheet_2083-09-30.pdf, LHC_Statement-Asha_2083-09.pdf. A name with no safe letters falls back to Customer-<id> or Supplier-<id>.
- **Screen:** Excel and PDF buttons on every tab and on an open statement, using the tab's current period and filters. Both are disabled while a file is prepared, and the server's refusal shows beside them.

### Files
- New:
  - api-server: src/lib/reportFormat.ts, src/lib/reportExport.ts, src/lib/reports/exportDocs.ts; src/__tests__/reportFormat.test.ts, src/__tests__/exports4c.test.ts;
  - docs/specs/step4c-exports.md.
- Changed:
  - api-server: package.json (exceljs 4.4.0, pdfmake 0.2.20, @types/pdfmake 0.2.11), build.mjs (exceljs, pdfmake and pdfkit kept external, because pdfkit reads its font files from disk), src/lib/reportLayout.ts (fix A1), src/routes/gl.ts (fix A3), src/routes/reports.ts (the export route), src/__tests__/reports4b.test.ts (fix tests);
  - lhc-cafe: src/lib/expenseApi.ts (apiDownload), src/components/reports/common.tsx (DownloadButtons), src/components/reports/statements.tsx (fix A2, the buttons), src/pages/reports.tsx (the buttons);
  - pnpm-lock.yaml; CLAUDE.md; docs/HANDOFF.md; docs/specs/step4-reports.md (section 14).

### Tables and migration
None.

### Decisions
- **Where:** exports are built on the server, not in the browser as step4-reports.md sections 5 and 8 first said. The request needs export routes with 403 tests, built from the server's report functions. So no test runner was added to lhc-cafe.
- **Libraries:** exceljs instead of SheetJS (whose free edition cannot write styles, fills or frozen rows); pdfmake for the PDF.
- **Two formatters:** the screen keeps its own (Intl en-IN); the tests pin the same strings.

### Tests
- Run on the dev machine:
  - `pnpm test`: 49 files, 484 tests pass;
  - typecheck clean for api-server, lhc-cafe and the libs;
  - both artifacts build;
  - the built server loads exceljs and pdfmake from node_modules and renders a PDF.
- New and changed:
  - **reports4b (+2, part A):**
    - changeOf from 0: 1,500 highlighted good or bad by direction, a fall of 1,500 bad, 800 not highlighted, 0 to 0 not;
    - the settings: -1, 1,001, "abc", "" and nulls refused with the messages; 0, 1,000, 1,000,000,000 and "25" accepted.
  - **reportFormat (8):**
    - 12,34,567.00; 99,99,999.99; 12,34,56,789.50; (1,250.00); "-" and 0.00 for zero;
    - 0.005 to 0.01 and -0.005 to (0.01); 1.005 to 1.01; 99,999.995 to 1,00,000.00;
    - one-decimal percentages;
    - BS with AD at the Poush start and end and at the fiscal-year end;
    - Nepal time;
    - safe file names (spaces, "Ram & Sita", accents, Devanagari to Customer-12, path characters, quotes).
  - **exports4c (10):**
    - **Excel P&L (Magh against Poush):** every money cell equals the JSON and is numeric; % cells are the JSON / 100; totals bold; the heading row frozen; food's change filled red; the rule text below.
    - **Excel Balance Sheet:** every cell equals the JSON.
    - **Compare:** two sheets.
    - **A customer statement PDF:** %PDF to %%EOF, with the header block, "Generated", "Page 1 of N" and "Prepared by".
    - **A Devanagari name:** the file is LHC_Statement-Customer-<id>; Excel keeps the name; the PDF shows "(name in Excel) customer #<id>".
    - **Every other PDF:** the P&L, Balance Sheet, Trial Balance, ledger, bank book and Day Book are produced.
    - **Size limit:** 5,001 vouchers make the PDF refused with the exact message, and the ledger too; the Excel of the same month has all 5,001 vouchers and 10,002 lines.
    - **Access:** 403 for staff and supervisor on all 12 routes in both formats; bad requests get 400 or 404.
    - **No writes:** every table's row count is unchanged after all 24 downloads.
- Not run: opening the files in Excel and a PDF viewer (by hand, see HANDOFF item 35); anything against production.

## 2026-11-28 (f): Reports 4c-fix, the PDF limit in rows drawn, and a failed Excel stream

### Summary
1. **The PDF limit counts the rows a PDF draws, not vouchers.**
   - ReportDoc has pdfRows:
     - the Day Book: every journal line, a heading and a total per day, and the grand total;
     - the General Ledger and the books: their lines, the opening, the day rows and the total;
     - the others: the rows of their sections.
   - PDF_LIMIT is now 3,000. Above it the route answers 400 "Too many lines for a PDF: use Excel, or narrow the period." with count and limit in the JSON. Excel stays unlimited.
   - Why rows: pdfmake lays the PDF out on the server's main thread, so the cost of a PDF follows the rows it draws. Under the old rule a Day Book of 5,000 vouchers (15,000 or more rows) could hold up every other request while it was built.
2. **A failed Excel download no longer looks finished.** In GET /reports/export/:report the Excel write goes through a PassThrough inside try/catch.
   - An error after the download started is logged ("Excel export failed") and the connection is cut with res.destroy(err), so the browser reports a failed download.
   - An error before any byte was sent answers 500 with "The Excel file could not be built. Please try again.".

### Files
- api-server:
  - src/lib/reportExport.ts (PDF_LIMIT 3000);
  - src/lib/reports/exportDocs.ts (count becomes pdfRows);
  - src/lib/reports/books.ts (the Day Book's lineCount and dayCount, the ledger's and books' dayCount);
  - src/routes/reports.ts (the pdfRows check, the guarded Excel stream);
  - src/__tests__/exports4c.test.ts (the size tests), src/__tests__/exportAbort.test.ts (new).
- Docs: docs/specs/step4c-exports.md, CLAUDE.md (Step 4 decisions), docs/HANDOFF.md.

### Tables and migration
None.

### Tests
- Run on the dev machine:
  - `pnpm test`: 50 files, 488 tests pass;
  - typecheck clean for api-server, lhc-cafe and the libs;
  - both artifacts build.
- **exports4c, size tests** (the old 5,000-voucher test replaced):
  - a Day Book of 1,200 vouchers (3,600 lines over 12 days, 3,625 rows) is refused as a PDF with count 3,625 and limit 3,000; its Excel has all 1,200 vouchers and 3,600 lines; the 1,100 ledger of that month (1,202 rows) still builds as a PDF;
  - a Day Book of 900 vouchers (2,721 rows) builds as a PDF in under 15 seconds. The test logs the time: 1,306 ms on the dev machine.
- **exportAbort (3, new):**
  - the Cash Book of 600 lines (two pages) downloads complete;
  - with the books function made to throw on page 2, the response is aborted, not a complete 200 file (logged as {"kind":"aborted"});
  - the server keeps serving afterwards.
- Not run: the screens in a browser; anything against production.

## 2026-11-28 (g): Part 3f, hotel guests, the stay folio and the stay history

### Summary
- **The plan:** docs/specs/stays-guests-3f.md, approved by the owner with questions 1 to 6 as recommended and four added points (section 12).
- **Hotel guests apart from loyalty members** (one customer table; loyalty_customers.kind):
  - **Check-in** (POST /stays) needs only the name; phone and email are optional.
    - A phone that matches a customer uses that customer: a member stays a member, and an archived guest is brought back (history 'guest_unarchived'), with no duplicate.
    - No phone always makes a new hotel guest; never matched by name.
    - A guest's email is not checked against members.
  - **Lists:** GET /loyalty/customers (Loyalty, the POS, Order Log) lists members only, never archived and never Sulimha Durbar. The admin's ?scope=all lists everyone.
    - The public QR page looks up and signs up members only.
    - A QR sign-up with a guest's phone promotes the guest (promoted_by 'QR sign-up', promoted_at) and returns only id, name, phone, points and loop.
  - **Promotion:**
    - POST /stays/guests/:customerId/promote (admin, supervisor, reception) and POST /loyalty/customers/:id/promote (admin, supervisor).
    - It needs a phone and an email (the email unique among members). The stays, invoices and points stay.
  - **Archive instead of delete:** POST /loyalty/customers/:id/archive and /unarchive (admin, supervisor). DELETE /loyalty/customers/:id now archives under the same rule; nothing is physically deleted.
    - Refused for anyone billed (an order, a receipt, a credit note or a journal line) with the reason, and for Sulimha Durbar.
- **Points** (owner, 2026-11-28; replaces "no loyalty points on stay bills"):
  - **Who earns:** a guest earns on the extras they pay for (as the money is paid); nothing on an included breakfast; Sulimha Durbar never earns.
  - **What was found:** before this, no stay bill earned points, Sulimha included, but the payment step added to Sulimha's visit count (total_orders) for every breakfast bill. That has stopped too.
  - **Not retroactive.**
- **The Stays page:**
  - check-in with "Phone (optional)";
  - a new Guests tab: search by name, phone or room; one row per stay with the room, dates, adults and children and status; Folio; Make member; Archive (or "billed: cannot archive" with the reason); Bring back.
- **The folio is a page** (/stays/:id):
  - **The stay:** the guest (hotel guest or loyalty member), room, dates, adults and children, notes.
  - **The bills:** every bill with who added it and when and who settled it ("not recorded" for older bills), and the totals by money role.
  - **The history**, Take payment, and Print bill.
  - **Print bill** (POST /stays/:id/bill) prints the guest's extras bill for that stay only: the invoices charged to the guest, with the invoice numbers, items, total, credited, paid and still to pay. It never includes the breakfast billed to Sulimha. It uses the receipts' style under "Legendary House Cafe & Barista Coffee School, Sulimha Durbar, Patan, PAN/VAT No: 194139113".
  - **Reception** may print it for any stay (with amounts) and sees no other amounts.
- **The stay history** (stay_events, insert-only by a database trigger), with GET /stays/:id/history and in the folio:
  - **Who reads it:** the admin, accountant, reception and supervisors; others get 403.
  - **The events:** opened, edited (field, old value, new value), closed (reason, and any extras moved to Sulimha), cancelled, order_charged (charge, total, added by, settled by), order_moved_out and order_moved_in (Move to another room, Wrong customer, unpaid extras moved to Sulimha), order_cancelled (Cancel invoice, with the reason), order_credited (an item-wise credit note and its void), bill_printed, guest_unarchived.
  - **Same transaction:** every row is written in the same transaction as the change it records.
- **orders.paid_by:** who settled the bill, from now on.
- **"Hotel guest" labels:** on Receivables (list, receipt picker, customer) and on the Reports statements and the customer summary. No figure changes.
- **Fixed on the way:** Receivables' customer search would have failed on a guest with no phone; the Loyalty, Order Log and POS searches are guarded the same way.

### Files
- New:
  - db/migrations/019_hotel_guests.sql;
  - api-server: src/lib/stayEvents.ts, src/__tests__/guests3f.test.ts;
  - lhc-cafe: src/pages/stay-folio.tsx, src/lib/guestBill.ts;
  - docs/specs/stays-guests-3f.md.
- Changed:
  - lib/db: src/schema/loyalty.ts (kind, archived and promoted columns, phone optional, the member-email index), src/schema/orders.ts (paid_by), src/schema/stays.ts (stayEventsTable);
  - api-server lib: src/lib/stayRules.ts (phone optional), src/lib/receivables.ts (the points rule; kind on balances), src/lib/reports/statements.ts (kind on statements);
  - api-server routes: src/routes/stays.ts, src/routes/loyalty.ts, src/routes/public.ts, src/routes/orders.ts (paid_by, order_charged, no visits for Sulimha or a breakfast), src/routes/receivables.ts (the history in Cancel invoice, credit notes, their void and re-issue);
  - api-server tests: src/__tests__/stays.test.ts (a guest now earns 50 points on Rs 500 of extras);
  - lhc-cafe: src/App.tsx, src/pages/stays.tsx, src/pages/receivables.tsx, src/components/reports/statements.tsx, src/pages/loyalty.tsx, src/pages/order-log.tsx, src/pages/pos.tsx;
  - CLAUDE.md, docs/HANDOFF.md.

### Tables
- loyalty_customers:
  - + kind ('member' / 'hotel_guest'), + archived, archived_by, archived_at, promoted_by, promoted_at;
  - phone now optional (still unique when present);
  - the table-wide email unique rule is replaced by loyalty_customers_member_email_idx (members only).
- orders: + paid_by.
- New: stay_events, with an insert-only trigger.
- **Existing data:**
  - customers who only ever stayed (a stay, no points or point or redemption logs, no orders outside stays, not Sulimha, never promoted) become 'hotel_guest';
  - every stay gets a backfilled 'opened' row, and 'closed' or 'cancelled' where it ended.
  - No journal, receivable or posted row changes.

### Migration
- db/migrations/019_hotel_guests.sql. Run on the server by the owner (recorded 2026-11-28). Idempotent (run twice in the tests).
- The owner's read-only check output did not reach me with the approval. The migration does not need the email constraint's name (it finds the unique rule on email by its definition), but please run the read-only check of plan section 4.2 before it, to see who becomes a hotel guest.

### Tests
- Run on the dev machine:
  - `pnpm test`: 51 files, 515 tests pass;
  - typecheck clean for api-server, lhc-cafe and the libs;
  - both artifacts build.
- New, guests3f (27):
  - **Check-in:** a name only (a hotel guest, no phone, an 'opened' row with room, adults and children); a member's phone (that member, still a member); two phone-less "Sita Rai" are two guests; a guest may share a member's email; a short phone is refused.
  - **Lists:** Loyalty lists no guests and not Sulimha; the admin's scope=all lists them.
  - **Points:**
    - an extra paid by receipt earns 50 on Rs 500, and paid_by is recorded;
    - a breakfast earns nothing, and Sulimha's points, visits and point logs stay unchanged;
    - an unpaid extra moved to Sulimha at check-out earns nothing;
    - the points stay on promotion.
  - **Promotion:**
    - refused without a phone, without an email, or with a member's email;
    - staff refused; reception refused on the loyalty route (its login is kept to /stays);
    - then a member with the stay kept, in the Loyalty list;
    - a QR sign-up promotes with promoted_by 'QR sign-up' and returns no stay.
  - **Archive:**
    - an unbilled guest is archived and hidden (reception refused; the customer count unchanged);
    - a billed guest is refused, through DELETE too, and the Guests view gives the reason;
    - checking in with an archived guest's phone brings them back with no duplicate and a 'guest_unarchived' row.
  - **History:**
    - an edit writes adults 2 to 3, check-out 2026-11-28 to 2026-11-29 and notes empty to "late arrival", and nothing for the unchanged children;
    - Cancel invoice writes order_cancelled; the credit note and its void write order_credited twice;
    - a move writes order_moved_out and order_moved_in;
    - UPDATE and DELETE on stay_events are refused;
    - the history is readable by the admin, accountant, reception and supervisor; staff gets 403 (and no history on the folio); reception gets the history but no amounts;
    - the folio shows "added by waiter1, settled by staff", and "not recorded" for an old order.
  - **The bill:** reception prints it with amounts and the business header; the extra is on it, the breakfast is not; 'bill_printed' is recorded; staff gets 403.
  - **Same transaction:**
    - a payment whose payment row fails leaves the bill pending and no history row;
    - an edit and a cancel whose history row fails are undone;
    - a refused close writes no 'closed' row.
  - **Nothing posted changes:** promotion, archive and running 019 twice change no order, receipt or journal figure, and a promoted guest stays a member.
  - **Migration 019 on existing data:** stayed-only becomes a guest; points, orders outside stays, Sulimha, promoted and never-stayed customers stay members; opened 5, closed 3, cancelled 1, all backfilled once.
- Not run: the screens in a browser; the public QR page on the cafe Wi-Fi; anything against production.

## 2026-11-28 (h): Migration 019 recorded as run
- The owner ran db/migrations/019_hotel_guests.sql on the server. Recorded in CLAUDE.md, docs/HANDOFF.md and the 3f entry above. Docs only; no code, no SQL, nothing to deploy.

## 2026-11-28 (i): Part 3f-fix

### Summary
1. **A QR sign-up never renames a hotel guest.** routes/public.ts now calls promoteGuest with no name: the name staff entered stays, because it is on the guest's invoices and statements. Only the email is taken (and the phone, which matched).
2. **The Guests view counts bills in one grouped query.** GET /stays/guests used billedCounts once per guest (four queries each). It now uses billedCountsMany (lib/stayEvents.ts): one UNION ALL query grouped by customer over orders, receipts, credit notes and journal lines. The output is the same.
3. **An archived customer's phone on the Loyalty page.** POST /loyalty/customers with the phone of an archived customer answers "This customer is archived. Ask the admin or a supervisor to bring them back."
   - **New list:** GET /loyalty/customers?archived=1 lists archived members, for the admin and supervisors only; anyone else gets the normal list.
   - **Loyalty page:** an "Archived" filter (admin, supervisor) shows them, with "Bring back" (POST /loyalty/customers/:id/unarchive).
   - **The trash button now says what it does:** "Archive customer ... nothing is deleted". A billed customer's refusal shows its reason (since 3f it archives; it never deleted).
4. **Checked: the Receivables pickers.** Record receipt (pages/receivables.tsx) and Wrong customer (components/InvoiceActions.tsx) search GET /accounts/customers, not the loyalty list. That search covers every customer: members, hotel guests, Sulimha Durbar and archived ones. So both still find Sulimha and a hotel guest who owes money, and nothing was broken. The search now also returns each customer's kind and archived flag. Note: that search route is open to any logged-in role (unchanged; it returns names and phones only).

### Files
- api-server:
  - src/routes/public.ts, src/lib/stayEvents.ts (billedCountsMany), src/routes/stays.ts, src/routes/loyalty.ts, src/routes/accounts.ts;
  - src/__tests__/guests3f.test.ts (+4).
- lhc-cafe: src/pages/loyalty.tsx.
- Docs: docs/CHANGELOG.md, docs/HANDOFF.md.

### Tables and migration
None.

### Tests
- Run on the dev machine:
  - `pnpm test`: 51 files, 519 tests pass;
  - typecheck clean for api-server, lhc-cafe and the libs;
  - both artifacts build.
- New in guests3f:
  - **QR sign-up:** typed as "Typed On The Phone", the guest stays "Krishna (desk)", now a member with the email; their invoice and the Receivables customer show the old name.
  - **30 guests:** billedCountsMany equals billedCounts for every one; the route's billed flags match; and the route runs the same number of database queries for 30 guests as for 3 (counted on the PGlite client).
  - **Archived phone:** the refusal message; ?archived=1 for a supervisor but not staff; unarchive refused for staff and allowed for a supervisor; then back in the list.
  - **The pickers' search:** finds Sulimha (with its kind) and a hotel guest.
- Not run: the screens in a browser; the public QR page on the cafe Wi-Fi; anything against production.

## 2026-11-28 (j): Step 5a, VAT and TDS settings and fields (no change while VAT is off)

### Summary
- **The plan:** docs/specs/step5-vat-tds.md. The owner answered its 16 questions (section 11; CLAUDE.md "Step 5 decisions"). Part 5a prepares everything; nothing posts differently.
- **Settings** (Chart of Accounts > settings, admin): "VAT registered from" (today or later only) and the VAT number (LHC's 9-digit PAN).
  - VAT cannot be switched on yet: PATCH /gl/settings answers "VAT cannot be switched on yet: output VAT on sales is built in step 5e...".
  - VAT bills stay refused as before.
- **A latent bug, fixed:** ledger_settings.vat_enabled was added by migration 014 but never put in the Drizzle schema. ledgerSettings() could not read it, and the old "Switch on" link could not save it. It is in the schema now. VAT was off throughout, so nothing was affected.
- **Editable rates** (new Chart of Accounts > Taxes tab, admin and accountant):
  - **VAT:** one row, 13%. Rates can carry effective dates, and the rate in force follows a document's date (lib/taxes.ts vatRateOn).
  - **TDS types**, seeded with the researched (UNVERIFIED) values:
    - service fee, VAT bill 1.5%;
    - service fee, PAN bill 15%;
    - contract 1.5% above NPR 50,000;
    - salary 1%;
    - rent 10%, inactive until the accountant decides (answer 14).
  - New types can be added; every row has a rate, a threshold, the Act section, who it is for, effective dates and an in-use switch.
- **Suppliers:** "VAT registered (issues VAT bills)" and "TDS when paid" (a TDS type in use).
- **Purchase bills:** a bill with VAT is stored as a VAT bill, one without as a PAN bill. A PAN bill with VAT, or a VAT bill without VAT, is refused. The form shows which it is.
- **Expenses:** bill type (none, PAN bill, VAT bill), the VAT inside the amount, and the supplier's PAN. VAT needs a VAT bill; a VAT bill needs its VAT and the PAN; the VAT must be less than the amount. Edits are logged in the expense history.
- **Customers:** an optional PAN (Receivables > customer > PAN > Change; admin and accountant), for Sulimha Durbar's tax invoices once VAT is on.
- **New tables** (used by later parts): tax_payments (5b and 5f); TDS columns on supplier payments and customer receipts (5b, 5c).
- **New accounts:** 1460 TDS receivable (advance tax), active; 2270 Income tax payable, inactive.

### Files
- New:
  - db/migrations/020_vat_tds_ready.sql;
  - api-server: src/lib/taxes.ts, src/__tests__/vatTds5a.test.ts;
  - lhc-cafe: src/components/TaxesTab.tsx;
  - docs/specs/step5-vat-tds.md.
- Changed:
  - lib/db schema: ledger.ts, purchases.ts, expenses.ts, payments.ts, loyalty.ts;
  - api-server: src/lib/ledger.ts, src/lib/purchaseRules.ts, src/lib/purchasePosting.ts, src/routes/gl.ts, src/routes/purchases.ts, src/routes/expenses.ts, src/routes/receivables.ts;
  - lhc-cafe: src/pages/chart-of-accounts.tsx, src/pages/suppliers.tsx, src/pages/purchase-bill.tsx, src/pages/expenses.tsx, src/pages/receivables.tsx;
  - CLAUDE.md, docs/HANDOFF.md.

### Tables
- ledger_settings: + vat_start_date, vat_number (vat_enabled from 014, now in the schema).
- New: tax_rates, tds_types, tax_payments.
- suppliers: + vat_registered, default_tds_type.
- purchase_bills: + bill_type (default 'pan', with a check).
- expenses: + bill_type, vat_amount, supplier_pan, tds_type, tds_rate, tds_amount.
- supplier_payments: + tds_type, tds_rate, tds_amount.
- customer_receipts: + tds_amount, tds_reference.
- loyalty_customers: + pan.
- accounts: + 1460, 2270 (inactive).
- No existing row's values change.

### Migration
- db/migrations/020_vat_tds_ready.sql. Run on the server by the owner (recorded 2026-11-28). Idempotent (run twice in the tests).

### Tests
- Run on the dev machine:
  - `pnpm test`: 52 files, 529 tests pass;
  - typecheck clean for api-server, lhc-cafe and the libs;
  - both artifacts build.
- **No change while VAT is off:** every one of the 519 existing tests passes unchanged, including the 3b and 3c posting tests line by line.
- New, vatTds5a (10):
  - **Migration 020:** the seeds (VAT 13; the five TDS types with rent inactive; 1460 active and 2270 inactive), run twice.
  - **VAT settings:**
    - the accountant is refused (403);
    - a past date and a short VAT number are refused;
    - "194 139 113" is saved as 194139113;
    - switching on is refused;
    - vat-status is still off.
  - **VAT rate:** edited with dates; a bad rate or bad dates refused; a second rate from 2027-07-01; the rate in force on 2027-03-01 is 13 and on 2027-08-01 is 12; staff gets 403.
  - **TDS types:** the PAN-bill rate edited and noted; rent switched on; a new type; duplicate (409) and bad code refused; staff gets 403. Plus the validators alone.
  - **Suppliers:** VAT registered with a TDS type in use; an unknown type refused.
  - **Purchase bills:** a bill with VAT stored as a VAT bill, one without as a PAN bill; a PAN bill with VAT and a VAT bill without VAT refused.
  - **Expenses:**
    - VAT without a VAT bill, a VAT bill without a PAN, and VAT not less than the amount are refused;
    - a VAT bill is saved, and its VAT edit is logged;
    - a plain expense has no type and no VAT.
  - **Customer PAN:** staff refused, a bad PAN refused, saved for Sulimha.
- Not run: the screens in a browser; anything against production.

## 2026-11-28 (k): Migration 020 recorded as run
- The owner ran db/migrations/020_vat_tds_ready.sql on the server. Recorded in CLAUDE.md, docs/HANDOFF.md and the 5a entry above. Docs only; no code, no SQL, nothing to deploy.

## 2026-11-28 (l): Step 5b, TDS payable
Plan: docs/specs/step5-vat-tds.md sections 4a, 5, 6 and 8, the owner's answers in section 11; as built in section 13.

### Delivered
- **TDS base, a setting the accountant must confirm:** ledger_settings.tds_base, 'excl_vat' (default) or 'incl_vat' (Chart of Accounts > Taxes).
  - With excl_vat, TDS = rate x the amount before VAT when the bill is a VAT bill; otherwise rate x the amount.
  - Rounded to the paisa, half away from zero. Net paid = gross - TDS.
- **Confirmed rates:**
  - tax_rates and tds_types get confirmed_by and confirmed_at (empty at first). The admin or accountant presses Confirm on the Taxes tab.
  - Changing a rate, a threshold or a date clears the confirmation.
  - A document using an unconfirmed type is allowed, with the warning "This rate has not been confirmed by the accountant yet." The same warning appears on the save, on the form and on the TDS payable report.
- **TDS on expenses** (routes/expenses.ts, lib/tds.ts): the admin and accountant choose a TDS type; tds_type, tds_rate and tds_amount are stored. Refused without the payee's PAN, and refused for petty cash from the drawer.
  - **Contract type:** applies only when the payment plus the same PAN's payments under the same type in the 10 days before (expenses and supplier payments, active only) is above the threshold. The aggregated figure is returned and shown on saving. Earlier payments below the threshold are not caught up.
  - **Entry:** Dr expense (gross), Cr cash or bank (net), Cr 2250 (TDS, carrying the supplier found by the PAN, memo "type · PAN").
  - **Edits:** a change of the type, amount, VAT, PAN or bill type recomputes the TDS and logs a "TDS" change. After posting, it goes through the usual reverse and repost.
- **TDS on supplier payments** (lib/payables.ts, routes/purchases.ts): only for service suppliers, and the type starts from the supplier's default. Refused for goods suppliers and for cash from the drawer (CV).
  - **The base** leaves out the VAT share of the VAT bills the payment settles, pro rata. An unallocated part (an advance) counts in full.
  - **Entry:** Dr 2100 gross (supplier), Cr bank net, Cr 2250 TDS (supplier). The supplier's balance falls by the gross. Voiding reverses it.
- **Tax payment voucher TX** (routes/taxes.ts): source type tax_payment, with its drill-down link. Admin and accountant only.
  - **Fields:** the BS month, the date, the bank (Nabil or HBL), the e-TDS reference, the amount and notes. The amount defaults to what is still to deposit for that month, is never below zero, and 0 is refused.
  - **Entry:** Dr 2250, Cr bank.
  - **Refused** in a locked day or a closed month. Void with a reason (reverses once posted). The VAT payment kind waits for 5f.
- **Reports > TDS payable** (lib/reports/tdsReport.ts; GET /reports/tds-payable?month=YYYY-MM; Excel and PDF via /reports/export/tds-payable):
  - each payee with PAN, type, gross, rate, TDS, voucher and the unconfirmed marker;
  - totals by type; deposits; what is still to deposit;
  - "due by the 25th of <next BS month>";
  - the check that the posted documents' TDS equals the 2250 credits for the month (tax payments left out);
  - the "Posted up to" line and the unposted warning.
- **Balance Sheet:** 1460 TDS receivable is a current-asset line and 2270 Income tax payable a liability line. A placed account shows only when active or non-zero, so 2270 stays hidden while inactive.
- **Ledger rule widened** (lib/glRules.ts): a supplier may be on 2250 as well as 2100, and a customer on 1460 as well as 1300, so each TDS line carries its payee.
- **Screens:**
  - Expenses: TDS type with gross, TDS and net preview, and TDS and net under the amount in the list;
  - Suppliers > Record payment: the TDS line for service suppliers;
  - Chart of Accounts > Taxes: Confirm buttons and the TDS base;
  - Chart of Accounts > Tax payments: record and void a TDS deposit;
  - Reports > TDS payable, with Excel and PDF.

### Files
- **New:**
  - db/migrations/021_tds_payable.sql;
  - api-server: lib/tds.ts, lib/reports/tdsReport.ts, routes/taxes.ts, __tests__/tds5b.test.ts;
  - lhc-cafe: components/TaxPayments.tsx, components/reports/TdsPayable.tsx.
- **Changed:**
  - lib/db schema/ledger.ts;
  - api-server: lib/postingRules.ts, lib/glPosting.ts, lib/glRules.ts, lib/payableRules.ts, lib/payables.ts, lib/reportLayout.ts, lib/reports/drilldown.ts, lib/reports/exportDocs.ts, routes/expenses.ts, routes/purchases.ts, routes/gl.ts, routes/reports.ts, routes/index.ts;
  - lhc-cafe: pages/expenses.tsx, pages/chart-of-accounts.tsx, pages/reports.tsx, components/SupplierPayables.tsx, components/TaxesTab.tsx.

### Tables
- ledger_settings: + tds_base (default 'excl_vat', check).
- tax_rates and tds_types: + confirmed_by, confirmed_at.
- Indexes: expenses_tds_idx, supplier_payments_tds_idx, tax_payments_month_idx.
- No existing row's values change.

### Migration
- db/migrations/021_tds_payable.sql. Run on the server by the owner (recorded 2026-11-28). Idempotent (run twice in the tests).

### Tests
- Run on the dev machine:
  - `pnpm test`: 53 files, 545 tests pass;
  - typecheck clean for api-server, lhc-cafe and the libs;
  - both artifacts build.
- **No existing test changed.**
- New, tds5b (16):
  - **Rent:** Rs 50,000 at 10% (Dr 6100 50,000, Cr bank 45,000, Cr 2250 5,000, landlord on the line).
  - **Bill types:** a VAT bill uses 1.5% on the amount before VAT (150 on 10,000), and a PAN bill uses 15% (1,500).
  - **Refused:** no PAN; drawer-paid; a goods supplier; a drawer supplier payment.
  - **Contract:** 30,000 gets none, then 25,000 gets 375 (10-day total 55,000).
  - **Confirming:** an unconfirmed warning, and confirming removes it. Changing the rate clears the confirmation.
  - **Supplier payment:** 20,000 with 300 withheld; the balance falls by 20,000; the Payables check agrees.
  - **Late changes:** reverse and repost after posting; a void reverses.
  - **The deposit:** it defaults to the amount still to deposit, clears 2250, and the report totals equal 2250's movement; the export file names.
  - **Refused deposits:** a locked day and a closed month. A void needs a reason.
  - **Statements:** the TB balances, the P&L agrees, and the BS balances.
  - **Access:** staff and supervisor get 403 on every new route.
  - **Rules:** tds_base incl_vat (169.50); the pure rule (rounding, threshold).
  - **Migration:** 021 runs twice.
- Not run: the screens in a browser; anything against production.

### Decisions and open questions
- The TDS base (amount before VAT) is Claude's reading and **must be confirmed by the accountant**. It is a setting.
- Claude's interpretations, to confirm:
  - TDS is refused on drawer-paid supplier payments (as for petty cash);
  - the supplier-payment base pro-rates the VAT of the bills it settles;
  - the 10-day contract total spans expenses and supplier payments;
  - earlier below-threshold payments are not caught up.
- Service suppliers seldom have purchase bills, so supplier-payment TDS mostly concerns opening balances and advances. Most service TDS is entered on Expenses.

## 2026-11-28 (m): Migration 021 recorded as run; the app update notice; the QR page sign-in

### Migration 021 recorded
- The owner ran db/migrations/021_tds_payable.sql on the server. Recorded in CLAUDE.md, docs/HANDOFF.md and the 5b entry above.

### The app update notice (owner: people using the app did not know a new version had been deployed)
- **How it works:**
  - each frontend build gets an id (the Vercel commit, or the build time), baked into the page and written to /version.json (vite.config.ts);
  - components/UpdateNotice.tsx (mounted in App.tsx, so on every page, the QR page too) fetches /version.json, uncached, when the tab is shown again or focused, and every 5 minutes while it is open;
  - when the id differs, it shows "A new version of the app is ready" with Refresh and Later.
- **Never reloads by itself,** so a bill or form being typed is never lost.
- **vercel.json:** /version.json is never cached; /assets are cached for a year (their names change every build).
- **The first time:** pages opened before this deploy do not have the notice yet. They need one manual refresh (or closing the tab) after this deploy.

### The QR page sign-in and session
- **What was wrong:**
  - the loyalty sign-in lived only in the page's memory, so a phone that reloaded the page (common when the customer switches apps, or when the camera's QR browser closes) lost it;
  - any failed check (no network for a second, off the cafe Wi-Fi, a busy server) was treated as "Your session has ended";
  - asking for a new code was blocked until the old one expired (up to 10 minutes), and each sign-in in the same hour added 10 more minutes of wait;
  - redeeming points trusted the customer number the page sent.
- **The session length was not the problem.** The table session already lasts 30 minutes without activity, the page checks every 5 seconds while open, and it ends when staff close the table. Kept as it is.
- **Now:**
  - the session check says "idle" (the table is still open under the same opening) or "ended" (closed or reopened for new guests). On "idle" the page starts again by itself, as a new scan would. On "ended" it stays closed.
  - **Errors:** a network error, a Wi-Fi refusal, a 429 or a 5xx shows "Reconnecting…" (with Try again). It retries every 5 seconds and when the customer comes back to the browser.
  - **The sign-in:** verify-otp returns a loyalty token: signed, valid 4 hours, bound to the table and its opening, with its own key so it is never a staff login. The phone keeps it, and GET /api/public/loyalty/me restores the member after a reload. "Not you? Sign out" clears it.
  - **The cart** is kept on the phone for 3 hours and cleared when the order is placed.
  - **Redeeming** (POST /api/public/loyalty/redeem) needs the loyalty token of the same member, table and opening; otherwise it answers 401 "Please verify your loyalty account again".
  - **Email codes:** a new code 1 minute after the last (it replaces the old one). The first 3 codes in an hour need only that minute, then 10, 20, 30... minutes. A successful sign-in resets the count.

### Files
- **api-server:** lib/auth.ts (signQrLoyalty, verifyQrLoyalty), routes/public.ts, __tests__/qrSession.test.ts (new).
- **lhc-cafe:** vite.config.ts, vercel.json, src/App.tsx, src/components/UpdateNotice.tsx (new), src/pages/public-order.tsx.
- **Docs:** CLAUDE.md (the QR and update rules; 021 recorded), docs/HANDOFF.md (item 39), this entry.

### Tables and migration
- None. No SQL.

### Tests
- `pnpm test`: 54 files, 549 tests pass; typecheck clean; both artifacts build; dist/public/version.json and the bundle carry the same build id.
- New, qrSession (4):
  - **Codes:** a resend refused within the minute, 3 codes, the 4th waits 10 minutes; a sign-in resets the count.
  - **Staying signed in:** the sign-in comes back after a reload. After 30 idle minutes the check says "idle", a new session starts and the sign-in still works. After the table is reopened the check says "ended" and the sign-in is refused; a forged token is refused.
  - **Staff login:** the loyalty token is refused as a staff login.
  - **Redeeming:** another member's id is refused, with or without a sign-in. The member's own sign-in gets to the points rule.
- Not run: a real phone (switching apps, leaving the Wi-Fi), the notice on Vercel.

### Open
- The email code has no limit on wrong guesses, only the general public rate limit (30 requests a minute per address). Unchanged; a limit of 5 wrong tries per code is a small follow-up if wanted.
