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
