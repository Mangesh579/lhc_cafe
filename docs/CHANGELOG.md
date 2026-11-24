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
