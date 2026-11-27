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
   Four card machines (2026-11-25): LHC Nabil POS and LHC HBL POS (stored values card_nabil / card_hbl, relabelled), and Sulimha Nabil POS / Sulimha HBL POS (card_sulimha_nabil / card_sulimha_hbl, machines sulimha_nabil_pos / sulimha_hbl_pos, collected_by 'sulimha'). Sulimha's machines are settled when Sulimha transfers the money; the settlement records which LHC account received it, and the fee is booked as a bank charge with vendor Sulimha Durbar. Migration 009 applied 2026-11-26 (see CHANGELOG).

16. Monthly-account conversion (2026-11-24). Monthly Accounts > Conversion dry run: read-only report of every open bill; the admin previews one customer's bill (exactly the invoices that will be created, the balance before and after) and confirms. Each visit (same Nepal day and table) becomes a normal credit invoice dated at the visit, numbered in the visit's fiscal-year series, with an order_payments credit row, items copied with their KOT numbers, the bill's discount shared to the paisa and no loyalty points. The old bill becomes payment_status 'converted' (kept, with its items, linked through account_conversions and orders.converted_from_order_id). One transaction per bill; refused if the dry run blocks it, a visit is in another fiscal year, the bill has VAT, the bill changed since the preview, or it was already converted. Order routes refuse to pay, discount, cancel, correct, re-note or reopen a converted bill. Migration 004 applied 2026-11-24; all 3 open bills converted the same day (see CHANGELOG).

17. Suppliers and purchase bills (roadmap step 2, part A), 2026-11-24. Suppliers page (/suppliers): supplier master (PAN mandatory and unique, credit days, type goods/service, active), ingredient-supplier links with a preferred supplier and a "no supplier linked" banner (also on Inventory), purchase bills (/purchases/new) with the PAN and bill number required and duplicates refused per PAN, supplier ledger (billed, paid, balance, due, overdue, unpaid items), price history. Saving a bill, in one transaction: stock up in the ingredient's own inventory, cost per unit and last purchase (same formula as before), Stock Log, one direct expense per line (read-only on Expenses), price history, payable. Void reverses all of it. The old one-ingredient Record purchase is closed (410); Inventory's cart button opens the bill form. Migration 005 applied 2026-11-24; checked live the same day (see CHANGELOG). Plan: docs/specs/step2-suppliers.md.

18. Supplier payments, opening balances and aging (roadmap step 2, part B), 2026-11-24. Suppliers page, tabs Payments, Aging, Opening balances, and "Pay <supplier>" on each ledger:
   - Payments: cash from the drawer (CV number) or cheque/online from Nabil or HBL (PV number), dated on the real payment day. Partial or full, allocated across the supplier's open bills; the rest is an advance, allocatable later. No expense is ever created. A CV reduces that day's expected drawer cash (refused on a closed drawer day). Immutable; void with a reason (admin or accountant) restores bill balances (refused on a closed drawer day). Voucher on screen and printed.
   - Opening bills: purchase_bills kind 'opening' (OB numbers), dated on or before the opening-balance date (a setting), with their own due date; no stock, expense or drawer effect; same duplicate rule; paid, aged and voided like bills.
   - Aging by supplier on the Nepal day (not yet due, 1-15, 16-30, 31-60, over 60), bills due this week, overdue list, Excel export. Supplier ledger with payments and a running balance, Excel export.
   - Cash ledger shows CV payments; Bank ledger shows PV payments and bills paid by cheque/online when bought. A purchase bill with payments allocated cannot be voided.
   Migration 007 applied 2026-11-24; checked live the same day (see CHANGELOG).
19. Purchase returns with item-wise debit notes (roadmap step 2, part C), 2026-11-24. Bill detail > "Return items"; Suppliers > Returns tab (list, print, allocate, void, Excel); debit notes in the supplier ledger (running balance, totals, Excel sheet), bill detail and price history. Admin and accountant only.
   - A debit note (DN-<FY>-00001, voucher series DN, prefix editable) is raised against an active purchase bill, never an opening bill. Lines come from that bill: quantity up to bought minus already returned, value = the same share of the line's amount and VAT (the last units take the exact remainder). Dated on the real return day: backdating to the bill date, no future, current fiscal year (Nepal day).
   - One transaction: stock down in the ingredient's own inventory with a Stock Log line; set against its own bill up to what the bill still owes, the rest is a credit (advance) with the supplier, allocatable to other bills; a linked negative direct expense per line (the original expense is untouched; read-only on Expenses); price history records the returned quantity (void when the whole line is returned). Cost per unit is not recalculated (spec section 14). No cash or drawer effect.
   - Immutable; void with a reason (admin or accountant) puts the stock, payable, price history and expenses back. A purchase bill with an active debit note cannot be voided until the note is voided.
   Migration 008 applied 2026-11-25 (see CHANGELOG).

20. Cancel invoice and Wrong customer (Receivables), 2026-11-26. On each credit invoice in a customer's ledger (admin and accountant): Cancel = a full credit note (kind 'cancel') for what is still owed, with a reason and an optional "Not served: put the stock back" (Stock Log lines; voiding the note takes the stock out again). Wrong customer = a full credit note (kind 'reissue') plus a new credit invoice for the right customer: same items, KOTs and cost snapshot, dated on the visit day with a new number in that fiscal year, no stock change, points when paid. A reissue note cannot be voided (move it back with Wrong customer). Both refuse split bills and invoices with receipts allocated; Wrong customer also refuses an invoice with credit notes. Migration 010 run 2026-11-26.

21. Petty cash CV numbers, 2026-11-26. Every cash payout from the drawer (Cash Drawer > Petty cash payout, or an expense on the Expenses page ticked "Paid from the cash drawer") gets its own CV number in the same CV series as suppliers paid from the drawer (CV-2083/84-00001...), numbered in the fiscal year of the payout day. The bill number is optional; without one, who was paid or what it was for is required. The CV prints after saving (cash voucher with Paid by, Received by and Approved by lines) and can be reprinted from the Cash Drawer and Expenses lists; Excel export has a CV no. column. Older payouts keep their bill number and have no CV. Migration 011 run 2026-11-26.

22. Complimentary and Rs 0 bills, 2026-11-26. The payment dialog (Orders) has "Complimentary (NC): not charged": needs who it is for, optional reason; the open bill becomes NC at ingredient cost (order item cost snapshot), discount and VAT cleared, no payment rows, invoice number kept or given. A bill that comes to Rs 0 (100% discount) now settles: "Nothing to pay", button "Settle Rs 0 bill", payment_method 'none', no payment rows, invoice number given. Before, every mode was refused with "Enter an amount above 0". No migration. HBL POS fee set to 3% by the owner in Settlements > Settings (data, not code).

23. Reward item (loyalty reward), 2026-11-26. The payment dialog (Orders) has "Reward item (loyalty)": pick an item on the bill; one unit's price comes off first, then any staff %; never below Rs 0 (then the bill settles as Rs 0). Shown on screen, on the printed bill and the receipt preview as "Loyalty reward"; the order notes say "Loyalty reward: 1 x <item> (Rs. <price>)" with the reason. The discount route now adds to any discount already on the bill instead of replacing it. No migration.

24. Hotel room stays, 2026-11-26 (docs/specs/room-stays.md).
  - **Room Stays page:** check-in, change, check-out and cancel by reception, a supervisor or the admin; a folio with the check-out payment for LHC's money roles; history with Excel; settings for the breakfast price and the Sulimha Durbar customer (admin).
  - **Payment screen (Orders):** a "Hotel room" box. Charge to room makes a credit invoice on the guest. Included breakfast makes a credit invoice to Sulimha at Rs 800 x breakfasts, breakfast items only, with a warning listing items with no recipe cost.
  - **Reception role:** only /api/stays and auth/me and change-password; the app shows only Room Stays.
  - **Receipts** take the four card modes. Card receipts count in machine settlements, the card ledger, and the Receipts - Card column in the collections Excel.
  - **Menu items** have a Breakfast tick box.
  - **No points** on stay bills.
  - **Closing with unpaid extras** is admin only with a reason; the extras are re-issued to Sulimha (the Wrong customer logic, now the shared reissueInvoice).
  - Migration 012 run by the owner (recorded 2026-11-27).

25. Credit-note aware reports, 2026-11-27.
  - **Credit notes reduce sales:** Collections, the dashboard, profit (today and by day), the P&L and the Order Log subtract active customer credit notes on their own Nepal date, each in a separate Credit notes column or line, with the VAT following the note. A Wrong-customer move counts the sale once.
  - **Sulimha POS:** Sulimha's machines have their own Collections column and reach Money received only on the date their settlement is recorded.
  - **Hotel breakfast lines:** new breakfast invoices spread the Rs 800 x breakfasts total over their item lines.
  - **"Not served" cancel:** reverses the sale's own Stock Log movements, with today's recipe only for older orders. Voiding the note reverses exactly what it put back.
  - No migration.

26. Hotel stay bills name the stay, 2026-11-27.
  - **Where it shows:** a bill charged to a stay ("Hotel breakfast x 2 · Room 103 · Ram Thapa", or "Room 201 · Sita Rai (charged to room)") is named in the Order Log (badge, and the reprinted bill: Billed To Sulimha Durbar, the breakfasts x the price, the room and the guest), in Receivables (the invoices list and the ledger, i.e. Sulimha Durbar's statement), and in the API (orders and credit invoices carry `stay` and `stayText`).
  - **Old invoices:** the text is worked out from room_stay_id when read, so no invoice row is changed, and older stay bills show it too.
  - **Payment screen:** on a room with an open stay that includes breakfast, a bill of breakfast items only preselects "Included breakfast", with the count from the stay's adults.
  - **Warning:** it warns (never blocks), on screen and after saving, when that stay's breakfasts today would be more than its guests.
  - No migration.

27. Ledger part 3a, 2026-11-27 (docs/specs/step3-ledger.md).
  - **Chart of Accounts page** (admin and accountant):
    - the start date shown in BS and AD (Poush 1, 2083 = 2026-12-16; only the admin changes it, and only before any entry); lock 3 or 2 days;
    - the accounts (seeded chart plus 1280, 3050, 4020, 5150, and 7110 inactive): add, make inactive, an account's ledger;
    - the expense categories mapped to accounts, with the defaults to confirm; an unmapped category is listed as a problem;
    - journals: the list, an accountant JV with a narration, and reverse;
    - the trial balance (Excel);
    - opening balances: a draft (dummy) filled from the app (cash, customers, suppliers, stock) plus typed lines, with an audit trail, confirmed by the admin into one OP entry balanced by 3050.
  - **Database rules (013 triggers):** entries cannot be edited or deleted, must balance, and lines only go on postable, active accounts.
  - **Revisions:** a source posts as revision 1, and after a late change is reversed and re-posted as revision 2, 3 ... (unique per source and revision; a new revision only after the previous one is reversed).
  - **Not yet:** no source document posts yet (3b, 3c); no posting days or locks yet (3b, 3d). Migration 013 run (recorded 2026-11-27).

28. Ledger part 3b, 2026-11-27 (docs/specs/step3-ledger.md section 15).
  - **Chart of Accounts > Post a day:**
    - the days from the start date;
    - a day's review: what will post (one entry per bill, credit note, receipt, settlement), problems (must fix / to acknowledge), late changes (reverse, reverse and re-post as the next revision, post late) and the reconciliation (sales, VAT, receivables, machines);
    - Post, in one transaction; days in date order, only after the day ends, nothing before the start date.
  - **Chart of Accounts > Menu categories:** Food or Beverage.
  - **VAT:** VAT bills are refused (payment API and screen; the reprint too) until the admin switches VAT on (Chart of Accounts settings).
  - **Bank field:** Nabil or HBL is now required on receipts by bank (Receivables), drawer deposits (Cash Drawer), and expenses by bank transfer or cheque.
  - **Other cash in/out:** needs its account (4200, 7100, 3000, 3100).
  - Migration 014 run (recorded 2026-11-27).

29. Ledger part 3c, 2026-11-27 (docs/specs/step3-ledger.md section 16). The Post a day review now also posts:
  - purchase bills to stock (1400/1410) against 2100, the drawer or the bank;
  - supplier payments (advances included) and debit notes against 2100 with the supplier;
  - expenses through the expense map (petty cash flagged "no bill" when it has none; purchase, debit-note, Record-purchase and settlement-charge rows never posted);
  - deposits, owner draws, other cash in/out, the short or over at the drawer close;
  - one consumption entry a day (sold items' cost snapshots to 5000/5010, NC to 5200, waste to 5100, the not-served stock put back, against 1400/1410 by ingredient department).

  New checks: cash (the day's movement against the drawer's expected change, and the balance at the close against the count) and payables (each supplier). Stock is shown for information only. No migration.

30. Fixing room-charged bills where staff work, 2026-11-27 (docs/specs/room-stays.md).
  - **Where:** Order Log (opened order), the Orders page (a paid credit bill still on screen) and the Stays folio (each extra and breakfast).
  - **Admin and accountant see:**
    - **Cancel invoice:** reason, plus "Food was not served, put the stock back"; the existing cancel route.
    - **Credit note:** the item-wise dialog, now one shared component, also used by Receivables.
    - **Move to another room**, for a room-charged bill: a chosen open stay; the existing re-issue, now with a target stay that sets room_stay_id. Extras go to that stay's guest; an included breakfast stays on Sulimha Durbar and needs breakfast included.
  - **Everyone else sees:** "To fix a mistake on this bill ask the admin or accountant (Cancel invoice)".
  - **Receipts in the way:** a refusal because of allocated receipts now says "The guest has already paid for this bill" and names the receipt voucher(s) to void.
  - **Folio:** a bill moved away no longer shows on its old folio.
  - **Expenses (ledger 3c fix):**
    - cash only from the drawer; card and QR refused for new expenses or a changed method; existing rows untouched;
    - the posting rule makes cash-not-from-drawer a must-fix;
    - the expense form ticks "Paid from the cash drawer" by default and offers no card or QR for new expenses.
  - **Ledger 3c fixes:** a drawer reopened and closed again posts its new difference (the close counts as unposted when it has no entry in force); waste is credited by the ingredient's own department.
  - No migration.

31. Ledger part 3d, the period lock and the Nepali month close, 2026-11-27 (docs/specs/step3-ledger.md section 17). Needs migration 015 (not yet applied).
  - **Lock:** a posted day locks after lock_after_days (3) days: open on D+3, locked from D+4. One guard (lib/periodLock.ts) on every write route that dates a document; see the CHANGELOG for the list. A locked day's paid bill is fixed with Cancel invoice or a credit note, which are dated today.
  - **Reopen a day:** admin only, with a reason, logged in day_reopens. The day locks again 3 days after the reopen. Refused inside a closed month.
  - **Month close:** Chart of Accounts > Month close, by the accountant or the admin, once every day is posted and locked and the month-end checks agree or are noted. A closed month locks all its days. Only the admin reopens it, with a reason. The tab has the month's summary, its trial balance and an Excel export.

# Applied on the server
- 001_payments_credit.sql (2026-11-22, by the owner).
- 002_credit_rules_billno.sql (2026-11-24, by the owner): credit_settings, credit_notes, credit_note_items, orders.loyalty_paid_basis, expenses.bill_number.
- 003_settlements.sql (2026-11-24, by the owner): settlement_machines, settlement_settings, settlements.
- 004_account_conversion.sql (2026-11-24, by the owner): account_conversions, account_conversion_invoices, orders.converted_from_order_id.
- 005_suppliers_purchases.sql (2026-11-24, by the owner): suppliers, ingredient_suppliers, purchase_bills, purchase_bill_items, ingredient_price_history; expenses.purchase_bill_id and purchase_bill_item_id.
- 006_purchase_bank_account.sql (2026-11-24, by the owner): purchase_bills.paid_from_account (Nabil or HBL, required for cheque and online bills).
- 007_supplier_payments.sql (2026-11-24, by the owner): purchase_bills.kind, payables_settings, supplier_payments, supplier_payment_allocations.
- 008_debit_notes.sql (2026-11-25, by the owner): debit_notes, debit_note_items, debit_note_allocations; expenses.debit_note_id; ingredient_price_history.returned_quantity.
- 009_sulimha_card_machines.sql (2026-11-26, by the owner): order_payments mode check with card_sulimha_nabil / card_sulimha_hbl; settlement_machines.collected_by; LHC machines relabelled; Sulimha machines added.
- 010_credit_note_kinds.sql (2026-11-26, by the owner): credit_notes.kind, stock_restored, reissued_order_id.
- 011_petty_cash_cv.sql (2026-11-26, by the owner): expenses.voucher_no with a unique index.
- 012_room_stays.sql (recorded 2026-11-27, by the owner): cafe_tables.is_room, room_stays, hotel_settings, orders.room_stay_id, stay_charge and breakfast_count, menu_items.is_breakfast, loyalty_customers.email optional, card modes on customer_receipts.
- 013_ledger_accounts_journal.sql (recorded 2026-11-27, by the owner; the edited version with journal_entries.revision): accounts, expense_account_map, journal_entries (with revision) and journal_lines (with triggers), ledger_settings (start 2026-12-16, lock 3), opening_balance_lines, opening_balance_log.

- 014_ledger_posting.sql (recorded 2026-11-27, by the owner): menu_categories.revenue_kind, ledger_settings.vat_enabled, bank_account on customer_receipts / cash_movements / expenses, cash_movements.account_code, posting_days.

# Not yet applied on the server
- 015_period_lock.sql (2026-11-27): posting_days.reopened_on; day_reopens; period_closes. Run after a backup, before deploy.sh.

# Known limits
- **Tests:** the database tests run on PGlite (in-memory PostgreSQL), so `pnpm test` needs no server. On Windows, tests and builds need ESBUILD_BINARY_PATH (pnpm-workspace.yaml strips esbuild's Windows binary). scripts/src/seed.ts fails typecheck (bcryptjs and pg missing from scripts/package.json), unrelated.
- **Credit notes:**
  - Customer credit notes exist only for credit invoices and cannot exceed what is still owed. Refunds of money already received are not modelled (accountant: avoid refunds; void with a reason).
  - Reports subtract credit notes (item 25), but the category totals on the Order Log page are from the order lines and do not subtract item-wise notes. The VAT credit-note register comes with VAT (roadmap step 5).
  - The dashboard's "today" and "last 7 days" use the server's calendar day (UTC), not the Nepal day (older behaviour; Collections and the drawer use the Nepal day).
- **Credit limit:** the default credit limit is blank until the owner sets it (Receivables > Change defaults).
- **Settlements:** one per machine and sales day, only for days that have ended. Older "Card" payments with no machine recorded are listed but cannot be settled. A day's sales that change after settling are flagged; the settled figures are not changed.
- **Sulimha's machines:** the money is owed by Sulimha Durbar until its settlement. The chart of accounts has no "Receivable - Sulimha Durbar" account yet (ask the accountant before step 3 posting).
- **Purchases (step 3 posting):** posting must go to inventory and only consumption to cost of sales, never the purchase expenses again (docs/specs/step2-suppliers.md section 13).
  - Bill line units must be the ingredient's own unit (no conversion).
  - Bills dated in an earlier fiscal year are refused.
  - Old "Record purchase" entries are not bills and not payables.
- **Debit notes:**
  - The cost per unit is not changed by a return.
  - A return of stock already used is allowed within the bill line, and stock can go negative.
  - A debit note's credit goes to its own bill first; other allocation is manual.
  - Debit notes in an earlier fiscal year are refused.
- **Petty cash:** a voided payout keeps its CV number (numbers are never reused). Payouts recorded before migration 011 have no CV number.
- **Complimentary and rewards:**
  - Complimentary at the payment step takes cost from each item's cost snapshot; items with no recipe cost count as 0.
  - A reward item is one unit at its sold price, and is not linked to the customer's redemption record.
- **"Not served" cancel:** orders whose Stock Log lines carry no menu item (older orders) are put back by today's recipe; the response and Stock Log say which.
- **Room stays:**
  - VAT on the breakfast price is not added yet (the VAT switch, step 5).
  - Breakfast invoices made before 2026-11-27 keep menu prices on their lines (not changed).
  - The bill printed from the payment screen before a room charge shows menu prices and no stay details; reprint from the Order Log after saving (that bill names the guest, the room and the breakfasts).
  - Sulimha Durbar must be on the Loyalty page and chosen in Room Stays > Settings before the first breakfast.
- **API docs:** the OpenAPI spec and generated client still list only cash and nabil_qr as payment methods.

# Next work
Roadmap step 3: plan approved (docs/specs/step3-ledger.md, answers in its section 13). Parts 3a, 3b and 3c are built (items 27, 28, 29). Next is part 3d: the automatic lock of a posted day after N days, refusing new or backdated documents in a locked day, admin reopen with a reason, the Nepali month close and its trial balance. For the posting:
- ask the accountant for the Sulimha Durbar receivable account;
- follow the posting rules in docs/specs/step2-suppliers.md section 13 and docs/specs/room-stays.md section 5;
- credit notes post to 4900 Sales returns.

Then steps 4 to 9. Each task ends with a docs/CHANGELOG.md entry.
- Ledger (3a):
  - The opening balances filled "from the app" are today's figures; fill again on the start date before the owner confirms.
  - The start date cannot change once any journal entry exists.
  - Accountant JVs cannot be dated before the start date (16 Dec 2026), so none can be posted until then (except after the admin moves the start date).
- Ledger (3b):
  - The receivables check compares every customer as at the day; the machine check counts unsettled sales from the settlement start date. Both differ until the opening balances include them, so the accountant should type the unsettled machine amounts at the start date.
  - Consumption (3c) credits stock by today's recipe split between kitchen and drink (the cost amount itself is the sale's snapshot). A late NC bill on a day already posted with no consumption entry is not picked up (only late sales add a consumption entry).
  - The stock check compares with stock x cost per unit now, not as at the day; it is information only.
