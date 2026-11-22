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

# Known limits (fix in the payment work)
- Cash drawer and ledgers read orders.payment_method only, so a split payment would be counted wrongly. Must move to order_payments.
- Credit is only a mapped mode; there is no credit invoice flow or receivable ledger yet.
- No Nepal-day-boundary tests exist.

# Next work
Steps 2 to 9 in the CLAUDE.md roadmap. Each task must end with a docs/CHANGELOG.md entry.