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
