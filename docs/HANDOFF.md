# Delivered features (verify each in the repo)
1. Fiscal-year invoice numbers, credit corrections on cancelling a paid bill, NC bills, VAT/PAN bills.
2. Kitchen/Drink inventory split with approval requests, negative stock, waste log with restore, recipes with prep waste, composite ingredients, stock log, usage report, equipment log, ingredient categories, ingredient export.
3. Menu clone, change log; unlinked-ingredient and no-ingredient-dish banners.
4. Printing: lib/kot.ts (KOT and receipt builder), table on bills, compact zoom setting.
5. QR page redesign (category tiles, notes confirmation, help button).
6. One bill per table with KOT numbers, per-KOT cancel, change table with merge, idempotent order placement (order_requests).
7. Costing: cost_per_unit, order_items.unit_cost snapshot, hideCosts, profit in Order Log, dish cost sheet.
8. Expenses (expenses, attachments, change history), Record purchase, accountant role.
9. Operating costs, overhead allocation, P&L, break-even, waste in P&L.
10. Monthly accounts: RETIRED 2026-11-24. Every open monthly bill was converted (item 16). Removed: "Make monthly account", the Add-customer merge into an account bill, lib/mergeOrders.ts, the QR "charge to my account" option, the QR "My monthly account" panel and its OTP session binding, and the Monthly Accounts page (/accounts now opens Receivables). The API refuses with 410 and a clear message: PATCH /accounts/:id {paysMonthly: true}, GET /accounts, POST /public/order with chargeToAccount. The pays_monthly flag is ignored everywhere (left in the data). Still readable: old account bills (accountBill, per-KOT tables) in Order Log and in the per-KOT P&L reporting, converted bills (payment_status converted), account_conversions history (Receivables > Converted monthly bills), qr_session_customers rows. No rows deleted.
11. Connection speed card, slow-endpoint log, optional LAN route.
12. Cash drawer (routes/cash.ts, pages/cash-drawer.tsx), payment-mode ledgers (routes/ledgers.ts, pages/ledgers.tsx), orders.paid_at, expenses.paid_from_drawer, and the "QR Payment" label (stored value stays nabil_qr). Committed 2026-11-22 (066e7ee). The owner has run the SQL on the server; confirm the pages work live before relying on them.
13. Split payment and credit sales (roadmap step 2, parts A and B), 2026-11-22. Five payment modes (cash, nabil_qr, card_nabil, card_hbl, credit); order_payments table, written by the Pay dialog in Active Orders; cash drawer, collections and mode ledgers read order_payments with a fallback to orders.payment_method; paid_at on settlement; credit sales with their own invoice, the customer's receivable, credit limit (warning) and credit days; Receivables page (balances, overdue, customer ledger); receipt vouchers (RV) with allocation to invoices; Order Log shows the payment breakdown and what is still owed. Tests: `pnpm test` (vitest). See docs/TEST_PLAN_payments.md. Needs migration 001 (below).

14. Accountant's credit rules (2026-11-23): default credit terms in credit_settings (15 days; one default limit, blank until the owner sets it; a customer's own terms override; the limit only warns); item-wise customer credit notes (CN) that lower the receivable; loyalty points earned as the customer pays (none at a credit sale); receipts and credit notes only for loyalty customers; a required bill number on petty cash payouts (expenses.bill_number). Migration 002 applied 2026-11-24; verified live the same day (see CHANGELOG).

15. Card and QR settlements (roadmap step 3), 2026-11-24: Settlements page (/settlements). Per machine (Nabil POS, HBL POS, QR) and Nepal sales day: unsettled sales from order_payments (fallback payment_method) plus QR receipt vouchers; the user enters what reached the bank; the difference is a "Bank and card charges" expense (no VAT). Fee warning outside the machine's range (Nabil 2.75%, HBL 3.00-3.25%, QR none), configurable in settlement_machines. Settled days are read-only; the admin can void (also voids the expense). Card/QR ledgers show settlements going out; the Bank ledger shows them coming in. Migration 003 applied 2026-11-24; checked live the same day (see CHANGELOG).

16. Monthly-account conversion (2026-11-24). Monthly Accounts > Conversion dry run: read-only report of every open bill; the admin previews one customer's bill (exactly the invoices that will be created, the balance before and after) and confirms. Each visit (same Nepal day and table) becomes a normal credit invoice dated at the visit, numbered in the visit's fiscal-year series, with an order_payments credit row, items copied with their KOT numbers, the bill's discount shared to the paisa and no loyalty points. The old bill becomes payment_status 'converted' (kept, with its items, linked through account_conversions and orders.converted_from_order_id). One transaction per bill; refused if the dry run blocks it, a visit is in another fiscal year, the bill has VAT, the bill changed since the preview, or it was already converted. Order routes refuse to pay, discount, cancel, correct, re-note or reopen a converted bill. Migration 004 applied 2026-11-24; all 3 open bills converted the same day (see CHANGELOG).

17. Suppliers and purchase bills (roadmap step 2, part A), 2026-11-24. Suppliers page (/suppliers): supplier master (PAN mandatory and unique, credit days, type goods/service, active), ingredient-supplier links with a preferred supplier and a "no supplier linked" banner (also on Inventory), purchase bills (/purchases/new) with the PAN and bill number required and duplicates refused per PAN, supplier ledger (billed, paid, balance, due, overdue, unpaid items), price history. Saving a bill, in one transaction: stock up in the ingredient's own inventory, cost per unit and last purchase (same formula as before), Stock Log, one direct expense per line (read-only on Expenses), price history, payable. Void reverses all of it. The old one-ingredient Record purchase is closed (410); Inventory's cart button opens the bill form. Migration 005 applied 2026-11-24; checked live the same day (see CHANGELOG). Plan: docs/specs/step2-suppliers.md.

18. Supplier payments, opening balances and aging (roadmap step 2, part B), 2026-11-24. Suppliers page, tabs Payments, Aging, Opening balances, and "Pay <supplier>" on each ledger:
   - Payments: cash from the drawer (CV number) or cheque/online from Nabil or HBL (PV number), dated on the real payment day. Partial or full, allocated across the supplier's open bills; the rest is an advance, allocatable later. No expense is ever created. A CV reduces that day's expected drawer cash (refused on a closed drawer day). Immutable; void with a reason (admin or accountant) restores bill balances (refused on a closed drawer day). Voucher on screen and printed.
   - Opening bills: purchase_bills kind 'opening' (OB numbers), dated on or before the opening-balance date (a setting), with their own due date; no stock, expense or drawer effect; same duplicate rule; paid, aged and voided like bills.
   - Aging by supplier on the Nepal day (not yet due, 1-15, 16-30, 31-60, over 60), bills due this week, overdue list, Excel export. Supplier ledger with payments and a running balance, Excel export.
   - Cash ledger shows CV payments; Bank ledger shows PV payments and bills paid by cheque/online when bought. A purchase bill with payments allocated cannot be voided.
   Needs migration 007 (below).

# Applied on the server
- 001_payments_credit.sql (2026-11-22, by the owner).
- 002_credit_rules_billno.sql (2026-11-24, by the owner): credit_settings, credit_notes, credit_note_items, orders.loyalty_paid_basis, expenses.bill_number.
- 003_settlements.sql (2026-11-24, by the owner): settlement_machines, settlement_settings, settlements.
- 004_account_conversion.sql (2026-11-24, by the owner): account_conversions, account_conversion_invoices, orders.converted_from_order_id.
- 005_suppliers_purchases.sql (2026-11-24, by the owner): suppliers, ingredient_suppliers, purchase_bills, purchase_bill_items, ingredient_price_history; expenses.purchase_bill_id and purchase_bill_item_id.
- 006_purchase_bank_account.sql (2026-11-24, by the owner): purchase_bills.paid_from_account (Nabil or HBL, required for cheque and online bills).

# Not yet applied on the server
- db/migrations/007_supplier_payments.sql (purchase_bills.kind, payables_settings, supplier_payments, supplier_payment_allocations). Run after a backup, BEFORE deploy.sh and before pushing to main.

# Known limits
- Fixed in item 13: the drawer and ledgers read order_payments; there is a credit invoice flow and receivable ledger; there are Nepal-day-boundary tests.
- Monthly accounts are retired in code (item 10). Until that code is deployed, the old code can still open a monthly bill; after deploying, Receivables > Converted monthly bills shows a live "no monthly bill is open" check (and a link to convert one if any appears).
- Tests: the database tests (accountConversionRun, migration004) run on PGlite, an in-memory PostgreSQL, so `pnpm test` still needs no server. PGlite and drizzle-kit are dev dependencies of api-server.
- Customer credit notes exist only for credit invoices and cannot exceed what is still owed. Refunds of money already received are not modelled (accountant: avoid refunds; when needed, void with a reason). Supplier debit notes come with purchases (roadmap step 4).
- Credit notes do not yet change sales, profit or VAT reports (VAT credit-note register is roadmap step 6).
- The default credit limit is blank until the owner sets it (Receivables > Change defaults).
- Cash vouchers (CV) with supplier PAN for cash expenses are not built yet; drawer payouts only require a bill number for now (roadmap step 3).
- Purchase bills (item 17): payments, allocation, advances and aging are built (item 18); returns and debit notes are part C. The opening-balance date must be set before opening bills can be entered. Opening supplier balances (unpaid bills from before the start date, no stock change) are specified for part B (spec section 12). Step 3 must post purchases to inventory and only consumption to cost of sales, never the purchase expenses again (spec section 13). Line units must be the ingredient's own unit (no unit conversion). Bills dated in an earlier fiscal year are refused. Existing purchases (from the old Record purchase) are not bills and are not payables.
- Settlements: one per machine and sales day, only for days that have ended. Older "Card" payments with no machine recorded are listed but cannot be settled. A day's sales that change after settling (late or cancelled bill) are flagged on the Settlements page; the settled figures are not changed.
- The OpenAPI spec and generated client still list only cash/nabil_qr for payment methods.
- scripts/src/seed.ts fails typecheck (bcryptjs and pg missing from scripts/package.json), unrelated.
- On Windows, tests and builds need ESBUILD_BINARY_PATH (pnpm-workspace.yaml strips esbuild's Windows binary).
- Server PostgreSQL timezone is Etc/UTC (confirmed in CLAUDE.md); the ledger code is safe either way.

# Next work
Roadmap step 2 in CLAUDE.md: suppliers, purchases, payables, supplier ledger, payments (PV), returns with debit notes, supplier on each ingredient, price history. Then steps 3 to 9. Each task must end with a docs/CHANGELOG.md entry.