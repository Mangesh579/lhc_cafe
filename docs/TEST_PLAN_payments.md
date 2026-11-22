# Test plan: split payment, credit sales, receipt vouchers (roadmap step 2, A and B)

Migration: `db/migrations/001_payments_credit.sql`. Run it on the server after a backup and before deploying.

## 1. Automated (run on the dev machine or the server)

```
pnpm test
```

Runs vitest in `artifacts/api-server` (34 tests, pure functions, no database needed). On the Windows dev PC, esbuild's Windows binary is stripped by `pnpm-workspace.yaml`, so set `ESBUILD_BINARY_PATH` to an `esbuild.exe` 0.27.3 first, or run the tests on the server.

| File | What it proves |
|---|---|
| `src/__tests__/cashDrawer.test.ts` | Split bill (half cash, half QR) puts only the cash half in the drawer; several bills add up per mode; older orders without `order_payments` rows fall back to `payment_method`; rows win over `payment_method`; **credit and NC never count as cash** (incl. cash+credit split, NC with "cash" stored, pending/cancelled); a mixed day gives the right drawer total; collections keep credit out of "money received". |
| `src/__tests__/nepalDay.test.ts` | **11:50 pm Nepal falls on that day, 12:10 am on the next** (`nepalDay`, `dayRangeUtc` from `lib/ledgerData.ts`); exact 00:00 / 23:59:59.999 edges; each day's drawer gets the right bill. |
| `src/__tests__/payments.test.ts` | Mode mapping (`nabil_qr` = QR, `card`/`esewa` = card); split validation (must equal the bill to the paisa, merges duplicate modes, rejects unknown/zero/negative, credit needs a customer). |
| `src/__tests__/receivables.test.ts` | Receipt allocation (full, partial, over-invoice refused, over-receipt refused, other customer's invoice refused), oldest-first auto allocation, credit-limit warning, due dates. |

## 2. Already done (local throwaway Postgres 16, not production)

- Migration applied to a copy of the schema, then re-run: idempotent, no errors.
- 44 end-to-end API checks through the real Express server: split payment, wrong split refused, invoice sequence, double press and two simultaneous presses (one invoice, one set of rows), credit without customer refused, credit sale (own invoice, leaves Active Orders), cash+credit split with limit warning, legacy `paymentMethod: "card"` still works, receivables balances and overdue, receipt voucher with partial allocation, over-allocation refused, allocate leftover later, QR receipt, cancel blocked while receipts are allocated, cash drawer (cash parts only, cash receipts added), 11:50 pm / 12:10 am days, collections, credit/QR/cash ledgers, void receipt, cancel after void, cash receipt refused on a closed drawer day, role checks.
- The day boundary re-checked with the database timezone set to Asia/Kathmandu.
- Browser run (desktop and phone width): Pay dialog with five modes, split entry, credit with customer search and balance, Order Log summary and "Credit, still owed" filter, Receivables page, new receipt with "Oldest first", customer ledger, cash drawer receipt line, Ledgers, POS modes.

## 3. On the server after deploying (owner, with real data)

Do these in a quiet hour. Use a test customer from the loyalty list, and cancel the test bills afterwards (cancelling a paid bill makes a credit note, as usual).

1. **Before anything**: `SHOW timezone;` in psql. Note the answer in the CHANGELOG.
2. **Old orders still read right**: open Ledgers and Cash Drawer for yesterday. Totals must match what you saw before the deploy. Note: Collections "Money received" now leaves credit out; "Total sales" includes it.
3. **Single payment**: POS, one coffee, pay in Active Orders with Cash. Cash Drawer: the bill is in Cash sales. `SELECT * FROM order_payments ORDER BY id DESC LIMIT 1;` shows one cash row.
4. **Split**: a Rs. 500 bill, Split payment, Cash 200 + QR 300. Drawer adds 200 only. Ledgers > QR ledger shows 300 "part of a split bill". Order Log shows "Cash Rs. 200 + QR Payment Rs. 300".
5. **Split that doesn't add up**: Cash 200 + QR 200 on a Rs. 500 bill. The dialog shows "Rs. 100 still to enter" and Mark Paid is refused.
6. **Card machines**: pay one bill with Nabil POS and one with HBL POS. Ledgers > Collections shows them under Card with N / H.
7. **Credit**: a bill, choose Credit. Record Credit Sale stays disabled until a customer is chosen. Choose the test customer: balance and limit show. Record it: it gets an invoice number now and leaves Active Orders. Order Log shows "Owes Rs. …". It is NOT in the cash drawer.
8. **Credit limit**: Receivables > customer > Credit terms, set a limit below the balance. Next credit sale shows the red warning and asks to confirm; it is not blocked.
9. **Receipt voucher**: Receivables > New receipt, the test customer, Cash, an amount smaller than the balance, "Oldest first", Record. Voucher number `RV-<year>-00001`. Print it. Cash Drawer shows "Customer receipt" and the expected cash goes up. Order Log shows the smaller amount owed.
10. **Advance and later allocation**: record a receipt larger than what is allocated; the rest shows "not allocated"; use Allocate on the Receipts tab later.
11. **Void**: void the receipt (admin/accountant). The invoice is owed again; the drawer drops the receipt.
12. **Cancel guard**: try to cancel a credit invoice that has a receipt allocated. It is refused until the receipt is voided.
13. **Closed drawer**: close today's drawer, then try a cash receipt dated today: refused. A bank receipt is still allowed.
14. **Roles**: staff can take credit at the till but cannot open Receivables, record receipts or change credit terms. Supervisor can record receipts but not void or change terms.
15. **Overdue**: set the test customer's credit days to 0; the next day their open credit bill appears in Receivables > Overdue.
16. Clean up: void test receipts, cancel test bills.

## Not tested

- Against the production database.
- Printing on the real thermal printer (receipt voucher and the bill's payment line).
- The QR order page (public-order) was not changed; QR orders are still paid in Active Orders.
