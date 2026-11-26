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
- Migrations run on the server so far: 001_payments_credit.sql (2026-11-22, by the owner); 002_credit_rules_billno.sql (2026-11-24, by the owner); 003_settlements.sql (2026-11-24, by the owner); 004_account_conversion.sql (2026-11-24, by the owner); 005_suppliers_purchases.sql (2026-11-24, by the owner); 006_purchase_bank_account.sql (2026-11-24, by the owner); 007_supplier_payments.sql (2026-11-24, by the owner); 008_debit_notes.sql (2026-11-25, by the owner); 009_sulimha_card_machines.sql (2026-11-26, by the owner); 010_credit_note_kinds.sql (2026-11-26, by the owner); 011_petty_cash_cv.sql (2026-11-26, by the owner).
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
- Payment modes: Cash, QR Payment, Card - LHC Nabil POS (`card_nabil`), Card - LHC HBL POS (`card_hbl`), Card - Sulimha Nabil POS (`card_sulimha_nabil`), Card - Sulimha HBL POS (`card_sulimha_hbl`), Credit. The stored value for QR Payment stays `nabil_qr`; only the label changed. Legacy values `card` and `esewa` count as card.
- Cash drawer and ledger totals are computed from order_payments rows, falling back to orders.payment_method only for orders that have no rows. A split bill (e.g. half cash, half QR) counts each part in its own mode.
- Credit and NC are never cash and never go into the drawer. Credit sales are receivables, not receipts.
- Owner, 2026-11-26: a guest the cafe treats (owner's guest, staff meal, hotel guest until room stays exist) is Complimentary (NC): booked at ingredient cost to Complimentary cost, with the person's name, no payment method. It can be chosen at the POS or at the payment step. A loyalty reward is a discount on the sale, not NC: the payment step has "Reward item (loyalty)", which takes one unit of a chosen item off the bill before any staff % (note "Loyalty reward: 1 x <item>"). A bill that comes to Rs 0 (100% discount) settles with no payment method (stored as payment_method 'none', no order_payments rows); card fees are a percentage of money the machine takes, so Rs 0 has no fee.
- Day boundaries use Nepal time (UTC+5:45), never UTC. An order paid at 11:50 pm Nepal time belongs to that Nepal day. Use lib/ledgerData.ts (nepalDay, dayRangeUtc) for all day calculations.
- Tests are required for: the split-payment drawer total, credit and NC exclusion from cash, and the Nepal day boundary (11:50 pm and 12:10 am cases).

## Accountant's decisions
General
- One invoice per sale and per purchase. No merged monthly bills. Credit sales get their own invoice at the visit and post to the customer's receivable.
- No service charge. No customer surcharge on cards. One cash drawer.
- Sales posting and purchase posting happen the next day (review screens that post a day's data to the ledger, then lock it).
- Staff: 5 people, no SSF, TDS only. Barista school course fees must be in the system.
- Hotel guests (owner, 2026-11-25; not built yet): Sulimha Durbar is a separate business that pays LHC for its guests' included breakfasts at cost price. A guest's extras (snacks, dinner) are normal sales, paid at the end of the stay. Plan: room stays, with breakfast orders at cost billed to Sulimha Durbar and extras on the guest's stay, kept apart (plan to be written first).

Receivables (answers of 2026-11-23)
- Receivables and payables are individual bills. One receipt can settle several invoices, for loyalty customers only.
- Credit days: 15 by default. Credit limit only warns, never blocks. One default limit amount applies to all customers, with an optional per-customer override. The amount is still to be given by the owner; until it is set there is no limit warning.
- Credit notes and debit notes are item-wise (customer and vendor). A credit note reduces the customer's balance; a debit note reduces what we owe the supplier.
- Refunds: avoid them; refund only when necessary (guest satisfaction), and always record a void with a reason.
- Owner, 2026-11-26: a credit invoice can be cancelled or moved to the right customer from Receivables (admin and accountant). Both are a full credit note; the invoice is never edited or deleted. Cancel asks each time whether the order was not served (then the stock goes back). Wrong customer re-issues the same items as a new credit invoice, dated on the visit day, for the right customer. Only for invoices fully on credit with no receipts allocated.
- Loyalty points on credit sales are earned only when the customer pays (in proportion to what each receipt covers), not at the sale.
- Receipts (receive payment, allocate) can be recorded by the admin, the accountant, supervisors and the head barista, who also takes payments at the counter (owner, 2026-11-24). Voiding receipts, credit notes and credit terms stay with the admin and the accountant.
- Open monthly-account bills (accountant confirmed 2026-11-24): convert each into individual credit invoices, one per visit, where a visit is the same Nepal day and the same table. Invoices are always dated on the visit day, for sales and purchase bills alike. The old monthly bill is closed as "converted" and linked to the new invoices, never deleted. A dry-run report exists (/accounts/conversion-preview); the conversion itself must be previewed and confirmed per customer.

Settlements
- Card and QR settlement is per day. QR settles to the same bank account as Nabil POS. The bank charge is booked as an expense per settlement; no VAT on it.
- QR has no fee. Card machines deduct fees: Nabil POS 2.75%, HBL POS 3% (owner, 2026-11-26: 3% for both LHC and Sulimha HBL POS; was 3.00-3.25%). The fee is a setting (Settlements > Settings), the actual deduction is entered at settlement, warn if outside it.
- Owner, 2026-11-25: there are four card machines. LHC Nabil POS and LHC HBL POS are LHC's own (the old Nabil POS and HBL POS). Sulimha Nabil POS and Sulimha HBL POS belong to Sulimha Durbar, a separate business: their money lands in Sulimha's bank, and Sulimha transfers it to LHC later by bank transfer (into LHC's Nabil or HBL account), less the same fees (Nabil 2.75%, HBL 3.00-3.25%). Until that transfer, Sulimha owes LHC that money. A Sulimha settlement records the date, the amount received and which LHC account received it.

Purchases and expenses
- Purchase bills: supplier PAN mandatory, bill number mandatory, no purchase without a bill. Duplicate check is per supplier: the same bill number from the same PAN is refused. Record supplier credit days when a purchase is on credit.
- Purchase returns are item-wise and vendor-wise, with a debit note.
- Every expense and purchase needs a bill, including small cash expenses paid from the drawer. No bill, no payout. Cash expenses are recorded on a CV (cash voucher) with the bill number and, where the supplier has one, the PAN.
- Owner, 2026-11-25 (replaces "no bill, no payout" for petty cash; built 2026-11-26, migration 011 run 2026-11-26): petty cash often has no bill. Every petty cash payout gets its own CV number (cash voucher, printed and signed); the bill number is optional and recorded when there is one. The CV series is shared with suppliers paid in cash from the drawer. Without a bill, the payout must say who was paid or what it was for (Claude's rule, to confirm).
- Owner, 2026-11-24 (docs/specs/step2-suppliers.md): purchases of stock are entered only as purchase bills (the quick one-ingredient "Record purchase" is closed). One supplier record per PAN. A bill paid when bought is paid from the cash drawer (refused if that drawer day is closed), by cheque or by online transfer; cheque and online bills record which bank account paid (Nabil or HBL). Items not kept in stock stay on Expenses, with a bill number, until vouchers. The bill form's supplier dropdown fills in the PAN/VAT number and credit days, which can be edited on the bill.

Vouchers and period lock
- Vouchers: RV (receipt voucher, money received from customers), CV (cash voucher, for cash and petty-cash expenses), JV (journal voucher), PV (payment voucher). Purchases and payments have separate series (purchase journal PJ and PV). Prefixes are editable.
- Period lock: a posted day locks 2 to 3 days later (configurable). Each Nepali month is closed at its end.

VAT, TDS and CBMS
- VAT: 13% added on top of menu prices. The cafe is NOT VAT registered yet, so build VAT behind a switch that is OFF until registration (with a start date). Course fees will carry VAT once registered; they are paid in advance; refunds are rare.
- TDS: 1% on salary; 15% on payments to individual service providers with a PAN bill; 1.5% on VAT bills from service providers.
- Salary TDS: 1% is applied to every staff member's whole salary (annual income is under NPR 10,00,000). Rate and threshold live in a configurable table so they can change if a staff member's income ever crosses the limit.
- CBMS: keep IRD-ready fields and an outbox only (toggle off by default). The owner will apply to IRD first and supply test credentials later; do not sync until then.

Chart of accounts
- Chart of accounts (accountant approved 2026-11-24; he will tell the owner if more accounts are needed). Based on the owner's template (the COA picture in docs/specs/), adapted for Nepal. Postable accounts: 1100 Cash on Hand; 1200 Bank - Nabil (QR and Nabil POS settle here); 1210 Bank - HBL (HBL POS settles here); 1250 Card receivable - Nabil POS; 1260 Card receivable - HBL POS; 1270 QR receivable; 1300 Accounts Receivable (control, customers are the sub-ledger); 1350 Advances (supplier and staff); 1400 Inventory - Kitchen; 1410 Inventory - Drinks; 1450 Input VAT; 1600 Equipment and furniture; 2100 Accounts Payable (control, suppliers are the sub-ledger); 2200 Output VAT payable; 2250 TDS payable; 2300 Salary payable; 2350 Advance course fees; 2360 Customer advances; 3000 Owner's capital; 3100 Drawings; 3200 Retained earnings; 4000 Food sales; 4010 Beverage sales; 4100 Course fees; 4200 Other income; 4900 Sales returns (credit notes); 4950 Discounts allowed; 5000 Ingredient consumption - Food; 5010 Ingredient consumption - Beverage; 5100 Waste and spoilage; 5200 Complimentary (NC) cost; 5300 Operating consumables; 6000 Salaries, 6100 Rent, 6200 Electricity and water, 6300 Telephone and internet, 6400 Stationery, 6500 Fuel and gas, 6600 Insurance, 6700 Repairs and maintenance, 6800 Advertising; 7000 Bank and card charges; 7050 Cash short/over; 7100 Other expenses. Header accounts (Assets, Liabilities) are totals and not postable. Vehicles and Bank Loan are left out. Food and beverage income are separate. Input and output VAT accounts exist from day one but stay unused until VAT registration. Depreciation is postponed by the accountant (2026-11-24): equipment is carried at cost for now, with no depreciation accounts or entries. Add accounts 1650 Accumulated depreciation and 6850 Depreciation expense when he asks.
- Posting rule (owner, 2026-11-24; docs/specs/step2-suppliers.md section 13): purchases post to 1400 Inventory - Kitchen / 1410 Inventory - Drinks (credit 2100, 1100, or 1200/1210 by how they were paid), and only consumption posts to 5000/5010. Expense rows booked by purchase bills (expenses.purchase_bill_id) or by the old Record purchase (expenses.inventory_item_id) must never be posted as costs again.

## Roadmap, in order
Done so far: cash drawer and payment-mode ledgers; payment modes, split payment, credit sales, receipt vouchers, credit rules and credit notes (migrations 001, 002); card and QR settlements (003); monthly-account conversion (004). See docs/CHANGELOG.md.
1. Monthly accounts retired (2026-11-24): all open monthly bills converted into credit invoices; "Make monthly account", the Add-customer merge into an account bill and the QR "charge to my account" option removed (the API answers with a clear error); the Monthly Accounts page replaced by Receivables (conversion history under Receivables > Converted monthly bills). No migration. Old data stays readable.
2. Suppliers, purchases, payables, supplier ledger, payments (PV), returns with debit notes, supplier on each ingredient, price history. Plan: docs/specs/step2-suppliers.md. Part A (suppliers, ingredient links, purchase bills, supplier ledger, price history) built 2026-11-24, migration 005 run on the server 2026-11-24. Bank account on cheque/online bills built 2026-11-24 (migration 006 run on the server 2026-11-24). Part B (supplier payments CV/PV with allocation and advances, opening supplier balances, aging) built 2026-11-24, migration 007 run on the server 2026-11-24. Part C (purchase returns with item-wise debit notes, DN) built 2026-11-24, migration 008 run on the server 2026-11-25. Step 2 is complete.
3. Chart of accounts, vouchers RV/CV/JV/PV, double-entry posting, next-day posting, period lock.
4. Day Book, Trial Balance, Balance Sheet, ledger P&L, aging.
5. VAT (off until registration) and TDS.
6. Course fees.
7. Payroll (check whether staff clock-in exists). Checked 2026-11-24: it does; attendance punches and shifts in routes/staff.ts (POST /staff/punch, attendance_punches, staff_shifts).
8. Owner's live view.
9. CBMS-ready fields and outbox.
