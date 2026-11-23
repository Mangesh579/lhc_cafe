# Cafe Nexus: project guide (read first)

Cafe management system for LHC Cafe & Barista School (Sulimha Durbar, Patan, Nepal). Owner/developer: Mangesh.

## Stack and layout
- TypeScript pnpm monorepo. Frontend: artifacts/lhc-cafe (React, Wouter, shadcn/ui, React Query), deployed to Vercel from GitHub main.
- Backend: artifacts/api-server (Express, built with esbuild to dist/index.mjs). Database: PostgreSQL through Drizzle (lib/db/src/schema/*.ts). Generated API client: lib/api-client-react.
- Many frontend files define their own API_BASE = import.meta.env.VITE_API_BASE and call fetch with the Bearer token from localStorage "lhc_token".
- Roles: admin, supervisor, staff, head_chef, head_barista, accountant. The auth context's role type is narrow, so compare with `(user?.role as string | undefined)`.

## Production
- Server PC (Windows + WSL2 Ubuntu) at /mnt/e/lhc_cafe. API runs under PM2 (cafe-nexus-api), env in artifacts/api-server/.env. PostgreSQL is local, database `cafenexus` (server timezone Etc/UTC). Cloudflare Tunnel exposes https://api.sulimhadurbar.com. Nightly backups go to Google Drive.
- Deploy: push to GitHub, then on the server run /mnt/e/lhc_cafe/deploy.sh (git pull, pnpm install, build api-server, pm2 restart). Pushing to main also auto-deploys the frontend on Vercel, so the API and its SQL must be ready first.
- Migrations are NOT automatic. Write each as db/migrations/NNN_name.sql (idempotent, IF NOT EXISTS). The owner runs it on the server after a backup. Never run SQL against production yourself.
- Migrations run on the server so far: 001_payments_credit.sql (2026-11-22, by the owner).
- The dev machine is remote and has no direct DB access.

## Working agreement
- After every task, append an entry to docs/CHANGELOG.md: date, summary, files and tables touched, migration file name and whether it has been run on the server, decisions made, open questions.
- Keep docs/HANDOFF.md accurate: move items from "not yet applied" to delivered, and mark retired features.
- Record any new business decision in the "Accountant's decisions" section below.
- Never mark a migration as run; only the owner does that.
- Never push to GitHub unless asked. Say which tests were run and which were not.

## Rules
- Money is NUMERIC (strings in Drizzle). Times are stored in UTC; the cafe runs on Nepal time (UTC+5:45). The fiscal year is Nepali (BS), invoice numbers look like 2082/83-00001.
- IRD compliance: paid invoices are immutable. No DELETE routes for orders or invoices. Cancelling a paid bill creates a credit note. Void with a reason instead of deleting, and keep audit trails.
- Costs and profit are visible to admin and accountant only (hideCosts middleware strips cost fields).
- Secrets only in .env, never in code.
- After every change: typecheck and build both artifacts, and run `pnpm test` (vitest, artifacts/api-server/src/__tests__, no database needed).
- Tax rates, thresholds and limits are configurable settings or tables, never hard-coded.

## Payments and cash rules
- Payment modes: Cash, QR Payment, Card-Nabil POS, Card-HBL POS, Credit. The stored value for QR Payment stays `nabil_qr`; only the label changed. Legacy values `card` and `esewa` count as card.
- Cash drawer and ledger totals are computed from order_payments rows, falling back to orders.payment_method only for orders that have no rows. A split bill (e.g. half cash, half QR) counts each part in its own mode.
- Credit and NC are never cash and never go into the drawer. Credit sales are receivables, not receipts.
- Day boundaries use Nepal time (UTC+5:45), never UTC. An order paid at 11:50 pm Nepal time belongs to that Nepal day. Use lib/ledgerData.ts (nepalDay, dayRangeUtc) for all day calculations.
- Tests are required for: the split-payment drawer total, credit and NC exclusion from cash, and the Nepal day boundary (11:50 pm and 12:10 am cases).

## Accountant's decisions
General
- One invoice per sale and per purchase. No merged monthly bills. Credit sales get their own invoice at the visit and post to the customer's receivable.
- No service charge. No customer surcharge on cards. One cash drawer.
- Sales posting and purchase posting happen the next day (review screens that post a day's data to the ledger, then lock it).
- Staff: 5 people, no SSF, TDS only. Barista school course fees must be in the system.

Receivables (answers of 2026-11-23)
- Receivables and payables are individual bills. One receipt can settle several invoices, for loyalty customers only.
- Credit days: 15 by default. Credit limit only warns, never blocks. One default limit amount applies to all customers, with an optional per-customer override. The amount is still to be given by the owner; until it is set there is no limit warning.
- Credit notes and debit notes are item-wise (customer and vendor). A credit note reduces the customer's balance; a debit note reduces what we owe the supplier.
- Refunds: avoid them; refund only when necessary (guest satisfaction), and always record a void with a reason.
- Loyalty points on credit sales are earned only when the customer pays (in proportion to what each receipt covers), not at the sale.
- Open monthly-account bills: convert each into individual credit invoices, one per visit (working reading, owner to confirm). Do a dry run and list the result before changing anything.

Settlements
- Card and QR settlement is per day. QR settles to the same bank account as Nabil POS. The bank charge is booked as an expense per settlement; no VAT on it.
- QR has no fee. Card machines deduct fees: Nabil POS 2.75%, HBL POS 3.00-3.25% (the actual deduction is entered at settlement; warn if outside the range).

Purchases and expenses
- Purchase bills: supplier PAN mandatory, bill number mandatory, no purchase without a bill. Duplicate check is per supplier: the same bill number from the same PAN is refused. Record supplier credit days when a purchase is on credit.
- Purchase returns are item-wise and vendor-wise, with a debit note.
- Every expense and purchase needs a bill, including small cash expenses paid from the drawer. No bill, no payout. Cash expenses are recorded on a CV (cash voucher) with the bill number and, where the supplier has one, the PAN.

Vouchers and period lock
- Vouchers: RV (receipt voucher, money received from customers), CV (cash voucher, for cash and petty-cash expenses), JV (journal voucher), PV (payment voucher). Purchases and payments have separate series (purchase journal PJ and PV). Prefixes are editable.
- Period lock: a posted day locks 2 to 3 days later (configurable). Each Nepali month is closed at its end.

VAT, TDS and CBMS
- VAT: 13% added on top of menu prices. The cafe is NOT VAT registered yet, so build VAT behind a switch that is OFF until registration (with a start date). Course fees will carry VAT once registered; they are paid in advance; refunds are rare.
- TDS: 1% on salary; 15% on payments to individual service providers with a PAN bill; 1.5% on VAT bills from service providers.
- Salary TDS: 1% is applied to every staff member's whole salary (annual income is under NPR 10,00,000). Rate and threshold live in a configurable table so they can change if a staff member's income ever crosses the limit.
- CBMS: keep IRD-ready fields and an outbox only (toggle off by default). The owner will apply to IRD first and supply test credentials later; do not sync until then.

Chart of accounts
- Base it on the owner's template (docs/specs/coa-template.png, to be added), adapted for Nepal: add bank accounts (Nabil, HBL), card and QR settlement receivables, customer receivables, kitchen and drink inventory, input and output VAT, TDS payable, salary payable, advance course fees, customer advances, food, beverage and course income, ingredient consumption, waste, NC cost, and card bank charges. The accountant must approve it before posting is built.

## Roadmap, in order
1. DONE: Cash drawer, payment-mode ledgers, rename "Nabil QR" to "QR Payment".
2. DONE 2026-11-22 (migration 001 run on the server): payment modes and split payment (order_payments); credit sales, receipt vouchers with allocation, credit limit and overdue. STILL TO DO: credit rules from the 2026-11-23 answers (15 days, default limit setting, item-wise credit and debit notes, points on payment), then retire the monthly-account merge (dry run first).
3. Settlements of QR and card to the bank, per day, with the bank charge.
4. Suppliers, purchase bills (supplier invoice no., PAN, VAT), supplier ledgers, payments, returns with debit notes, supplier on each ingredient, price history.
5. Chart of accounts, vouchers (RV, CV, JV, PV), next-day Sales/Purchase/Consumption posting, trial balance, balance sheet, day book, period lock.
6. VAT (off until registration; output/input, registers, monthly summary, credit-note register) and TDS.
7. Barista school course fees. 8. Payroll. 9. CBMS-ready fields and outbox.