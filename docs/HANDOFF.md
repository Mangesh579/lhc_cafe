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

# Not yet applied on the server
- db/migrations/001_payments_credit.sql (order_payments, customer_receipts, receipt_allocations, voucher_sequences, loyalty_customers.credit_limit/credit_days). Run after a backup, BEFORE deploy.sh and before pushing to main (Vercel deploys the frontend on push).

# Known limits
- Fixed in item 13: the drawer and ledgers read order_payments; there is a credit invoice flow and receivable ledger; there are Nepal-day-boundary tests.
- Monthly accounts (item 10) are still live alongside credit. Retire them only after the accountant answers the open questions in CLAUDE.md.
- Partial credit/debit notes do not change a credit invoice's outstanding amount (full cancellation does). Refunds of receipts are not modelled.
- Overdue uses 30 days when a customer has no credit days (placeholder).
- QR and card money is shown as received; settlement to the bank with the card-machine charge is roadmap step 3.
- The OpenAPI spec and generated client still list only cash/nabil_qr for payment methods.
- scripts/src/seed.ts fails typecheck (bcryptjs and pg missing from scripts/package.json), unrelated.
- On Windows, tests and builds need ESBUILD_BINARY_PATH (pnpm-workspace.yaml strips esbuild's Windows binary).
- Check the server's PostgreSQL timezone (`SHOW timezone;`); the ledger code is now safe either way.

# Next work
Rest of step 2 (retire the monthly-account merge, after the accountant's answers), then steps 3 to 9 in the CLAUDE.md roadmap. Each task must end with a docs/CHANGELOG.md entry.