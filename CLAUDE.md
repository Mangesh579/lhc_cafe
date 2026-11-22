# Cafe Nexus: project guide (read first)

Cafe management system for LHC Cafe & Barista School (Sulimha Durbar, Patan, Nepal). Owner/developer: Mangesh.

## Stack and layout
- TypeScript pnpm monorepo. Frontend: artifacts/lhc-cafe (React, Wouter, shadcn/ui, React Query), deployed to Vercel from GitHub main.
- Backend: artifacts/api-server (Express, built with esbuild to dist/index.mjs). Database: PostgreSQL through Drizzle (lib/db/src/schema/*.ts). Generated API client: lib/api-client-react.
- Many frontend files define their own API_BASE = import.meta.env.VITE_API_BASE and call fetch with the Bearer token from localStorage "lhc_token".
- Roles: admin, supervisor, staff, head_chef, head_barista, accountant. The auth context's role type is narrow, so compare with `(user?.role as string | undefined)`.

## Production
- Server PC (Windows + WSL2 Ubuntu) at /mnt/e/lhc_cafe. API runs under PM2 (cafe-nexus-api), env in artifacts/api-server/.env. PostgreSQL is local, database `cafenexus`. Cloudflare Tunnel exposes https://api.sulimhadurbar.com. Nightly backups go to Google Drive.
- Deploy: push to GitHub, then on the server run /mnt/e/lhc_cafe/deploy.sh (git pull, pnpm install, build api-server, pm2 restart). Pushing to main also auto-deploys the frontend on Vercel, so the API and its SQL must be ready first.
- Migrations are NOT automatic. Write each as db/migrations/NNN_name.sql (idempotent, IF NOT EXISTS). The owner runs it on the server after a backup. Never run SQL against production yourself.
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

## Payments and cash rules
- Payment modes: Cash, QR Payment, Card-Nabil POS, Card-HBL POS, Credit. The stored value for QR Payment stays `nabil_qr`; only the label changed. Legacy values `card` and `esewa` count as card.
- When order_payments is introduced, cash drawer and ledger totals must be computed from order_payments rows, falling back to orders.payment_method only for orders that have no rows. A split bill (e.g. half cash, half QR) counts each part in its own mode.
- Credit and NC are never cash and never go into the drawer. Credit sales are receivables, not receipts.
- Day boundaries use Nepal time (UTC+5:45), never UTC. An order paid at 11:50 pm Nepal time belongs to that Nepal day. Use lib/ledgerData.ts (nepalDay, dayRangeUtc) for all day calculations.
- Tests are required for: the split-payment drawer total, credit and NC exclusion from cash, and the Nepal day boundary (11:50 pm and 12:10 am cases).

## Accountant's decisions
- One invoice per sale and per purchase. No merged monthly bills. Credit sales get their own invoice at the visit and post to the customer's receivable.
- No service charge. No customer surcharge on cards. One cash drawer.
- Sales posting and purchase posting happen the next day (review screens that post a day's data to the ledger, then lock it).
- QR has no fee. Card machines deduct fees: Nabil POS 2.75%, HBL POS 3.00-3.25% (range; the actual deduction is entered at settlement, warn if outside the range).
- Staff: 5 people, no SSF, TDS only. Barista school course fees must be in the system.
- Voucher types: JV (journal), PJ (purchase journal and payment voucher, one shared sequence), RV (receipt), CV (contra); prefixes editable.
- TDS: configurable table, rates left for the accountant. CBMS: build CBMS-ready fields and an outbox now (toggle off by default); do not sync until IRD approval.
- OPEN, ask the accountant before retiring monthly accounts: what happens to open monthly-account bills; credit limit and credit days for credit customers; whether one receipt can settle several invoices.

## Roadmap, in order
1. DONE: Cash drawer, payment-mode ledgers, rename "Nabil QR" to "QR Payment".
2. PARTLY DONE 2026-11-22 (migration 001 not yet run): payment modes and split payment (order_payments); credit sales and customer receipts (receipt vouchers with allocation, credit limit/overdue). STILL TO DO: retire the monthly-account merge (after the open questions above).
3. Settlements of QR and card to the bank, with the bank charge.
4. Suppliers, purchase bills (supplier invoice no., PAN, VAT), supplier ledgers, payments, returns, supplier on each ingredient, price history.
5. Chart of accounts, vouchers, next-day Sales/Purchase/Consumption posting, trial balance, balance sheet, day book, period lock.
6. VAT (output/input, registers, monthly summary, credit-note register) and TDS.
7. Barista school course fees. 8. Payroll. 9. CBMS-ready fields and outbox.