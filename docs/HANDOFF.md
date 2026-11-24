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
10. Monthly accounts (account_bill, pays_monthly, mergeOrders, QR OTP session binding) and per-KOT reporting for account bills. TO BE RETIRED (see roadmap step 2); do not extend them. Keep existing data readable.
11. Connection speed card, slow-endpoint log, optional LAN route.
12. Cash drawer (routes/cash.ts, pages/cash-drawer.tsx), payment-mode ledgers (routes/ledgers.ts, pages/ledgers.tsx), orders.paid_at, expenses.paid_from_drawer, and the "QR Payment" label (stored value stays nabil_qr). Committed 2026-11-22 (066e7ee). The owner has run the SQL on the server; confirm the pages work live before relying on them.
13. Split payment and credit sales (roadmap step 2, parts A and B), 2026-11-22. Five payment modes (cash, nabil_qr, card_nabil, card_hbl, credit); order_payments table, written by the Pay dialog in Active Orders; cash drawer, collections and mode ledgers read order_payments with a fallback to orders.payment_method; paid_at on settlement; credit sales with their own invoice, the customer's receivable, credit limit (warning) and credit days; Receivables page (balances, overdue, customer ledger); receipt vouchers (RV) with allocation to invoices; Order Log shows the payment breakdown and what is still owed. Tests: `pnpm test` (vitest). See docs/TEST_PLAN_payments.md. Needs migration 001 (below).

14. Accountant's credit rules (2026-11-23): default credit terms in credit_settings (15 days; one default limit, blank until the owner sets it; a customer's own terms override; the limit only warns); item-wise customer credit notes (CN) that lower the receivable; loyalty points earned as the customer pays (none at a credit sale); receipts and credit notes only for loyalty customers; a required bill number on petty cash payouts (expenses.bill_number). Migration 002 applied 2026-11-24; verified live the same day (see CHANGELOG).

15. Card and QR settlements (roadmap step 3), 2026-11-24: Settlements page (/settlements). Per machine (Nabil POS, HBL POS, QR) and Nepal sales day: unsettled sales from order_payments (fallback payment_method) plus QR receipt vouchers; the user enters what reached the bank; the difference is a "Bank and card charges" expense (no VAT). Fee warning outside the machine's range (Nabil 2.75%, HBL 3.00-3.25%, QR none), configurable in settlement_machines. Settled days are read-only; the admin can void (also voids the expense). Card/QR ledgers show settlements going out; the Bank ledger shows them coming in. Migration 003 applied 2026-11-24; checked live the same day (see CHANGELOG).

# Applied on the server
- 001_payments_credit.sql (2026-11-22, by the owner).
- 002_credit_rules_billno.sql (2026-11-24, by the owner): credit_settings, credit_notes, credit_note_items, orders.loyalty_paid_basis, expenses.bill_number.
- 003_settlements.sql (2026-11-24, by the owner): settlement_machines, settlement_settings, settlements.

# Not yet applied on the server
- None.

# Known limits
- Fixed in item 13: the drawer and ledgers read order_payments; there is a credit invoice flow and receivable ledger; there are Nepal-day-boundary tests.
- Monthly accounts (item 10) are still live alongside credit. Retire them only after the accountant answers the open questions in CLAUDE.md.
- Customer credit notes exist only for credit invoices and cannot exceed what is still owed. Refunds of money already received are not modelled (accountant: avoid refunds; when needed, void with a reason). Supplier debit notes come with purchases (roadmap step 4).
- Credit notes do not yet change sales, profit or VAT reports (VAT credit-note register is roadmap step 6).
- The default credit limit is blank until the owner sets it (Receivables > Change defaults).
- Cash vouchers (CV) with supplier PAN for cash expenses are not built yet; drawer payouts only require a bill number for now (roadmap step 5).
- Settlements: one per machine and sales day, only for days that have ended. Older "Card" payments with no machine recorded are listed but cannot be settled. A day's sales that change after settling (late or cancelled bill) are flagged on the Settlements page; the settled figures are not changed.
- The OpenAPI spec and generated client still list only cash/nabil_qr for payment methods.
- scripts/src/seed.ts fails typecheck (bcryptjs and pg missing from scripts/package.json), unrelated.
- On Windows, tests and builds need ESBUILD_BINARY_PATH (pnpm-workspace.yaml strips esbuild's Windows binary).
- Server PostgreSQL timezone is Etc/UTC (confirmed in CLAUDE.md); the ledger code is safe either way.

# Next work
Rest of step 2: retire the monthly-account merge (convert open monthly-account bills into one credit invoice per visit, dry run first), then steps 3 to 9 in the CLAUDE.md roadmap. Each task must end with a docs/CHANGELOG.md entry.