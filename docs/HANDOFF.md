# Delivered features (verify each in the repo; some may not be applied yet)
1. Fiscal-year invoice numbers, credit corrections on cancelling a paid bill, NC bills, VAT/PAN bills.
2. Kitchen/Drink inventory split with approval requests, negative stock, waste log with restore, recipes with prep waste, composite ingredients, stock log, usage report, equipment log, ingredient categories, ingredient export.
3. Menu clone, change log; unlinked-ingredient and no-ingredient-dish banners.
4. Printing: lib/kot.ts (KOT and receipt builder), table on bills, compact zoom setting.
5. QR page redesign (category tiles, notes confirmation, help button).
6. One bill per table with KOT numbers, per-KOT cancel, change table with merge, idempotent order placement (order_requests).
7. Costing: cost_per_unit, order_items.unit_cost snapshot, hideCosts, profit in Order Log, dish cost sheet.
8. Expenses (expenses, attachments, change history), Record purchase, accountant role.
9. Operating costs, overhead allocation, P&L, break-even, waste in P&L.
10. Monthly accounts (account_bill, pays_monthly, mergeOrders, QR OTP session binding) and per-KOT reporting for account bills. These are TO BE RETIRED.
11. Connection speed card, slow-endpoint log, optional LAN route.
12. NOT YET APPLIED: cash drawer, ledgers, QR rename, orders.paid_at, expenses.paid_from_drawer.