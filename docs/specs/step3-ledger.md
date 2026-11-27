# Step 3: chart of accounts, vouchers, double-entry posting, next-day posting and period lock (plan)

Written 2026-11-27 for the owner and the accountant to review. **Approved with the answers in section 13 (CLAUDE.md, "Step 3 answers").** Part 3a is being built; parts 3b to 3d are not. Account numbers are the chart the accountant approved on 2026-11-24 (CLAUDE.md, "Chart of accounts").

## 1. What step 3 adds, in one paragraph
Every day's business already exists as source documents: bills, credit notes, receipts (RV), settlements, purchase bills (PJ), supplier payments (CV/PV), debit notes (DN), petty cash (CV), drawer movements and closings. Step 3 turns them into **journal entries** in a double-entry ledger, the next day.
- The accountant opens a **review screen** for a day, sees what will post and any problems, and presses **Post**.
- A posted day **locks** after 2 to 3 days (a setting), and each Nepali month is **closed** at its end.
- Nothing in the ledger is ever edited or deleted. A mistake is put right by a **reversing entry**.
- The ledger must agree with the screens people use today (Collections, Cash Drawer, Receivables, Payables, Settlements). A **reconciliation check** proves it every day.

## 2. Principles
1. **The ledger is built from source documents. Nobody types sales or purchases into it by hand.** The only hand-made entries are journal vouchers (JV) by the accountant (corrections, depreciation later, opening balances), with a reason.
2. **One source, one entry in force:**
   - each invoice, credit note, receipt, settlement, purchase bill, payment, debit note, petty cash voucher, drawer movement and drawer close posts once;
   - consumption posts once per day;
   - a unique key (source type + source id + **revision**) makes double posting impossible. A source posts as revision 1. After a late change (principle 5) the entry in force is reversed and the corrected entry is posted as revision 2, then 3, and so on. A new revision is refused while the previous one is not reversed.
3. **Immutable:** the database refuses UPDATE or DELETE on journal entries and lines (a trigger). Every entry is balanced (total debit = total credit), checked by a deferred constraint at commit.
4. **Dates:** an entry is dated on the Nepal day of its source, the same day the operational screens use (a bill on the day it was paid, a credit note on its note date, a receipt on its receipt date, a purchase bill on its bill date).
5. **Late changes:** when a source changes after its day was posted (a bill cancelled, a receipt voided, a settlement voided), the original entry stays.
   - A reversing entry, plus the corrected entry if there is one, is posted on the day of the change, which is still open.
   - The review screen of that day lists these "late changes".
6. **No double cost:** purchase bills post to inventory (1400/1410), and only consumption posts to cost of sales (5000/5010). The expense rows that purchase bills, Record purchase, debit notes and settlement bank charges create are **skipped** (step 2 spec, section 13).

## 3. Tables (part 3a, migration 013; idempotent, run by the owner)
- **`accounts`:**
  - **Fields:** code (e.g. "1100", the key), name, type (asset, liability, equity, income, expense), normal side (debit or credit), parent code, `is_header`, `is_postable`, `active`, sort order.
  - **Seeded rows:** the approved chart; the headers 1000 Assets and 2000 Liabilities are not postable.
  - **Also seeded (2026-11-27):** 1280 Receivable - Sulimha Durbar (card collections), 3050 Opening balance equity, 4020 Hotel breakfast income, 5150 Stock adjustment, and 7110 Petty cash, no bill (inactive until the accountant confirms it).
  - **Adding accounts:** new accounts are added by the admin or accountant on a Chart of Accounts screen (they are never deleted, only made inactive). A used account cannot change its type.
- **`expense_account_map`:** each expense category (the Expenses page categories) maps to an account (6000 to 7100, 5300). Defaults are seeded, and the accountant confirms them on a screen. An expense in an unmapped category is a problem on the review screen, not a guess.
- **`journal_entries`:**
  - **Number and type:** entry number and voucher type: RV, CV, PV, JV, plus SJ (sales journal) and PJ (purchase journal) for documents that already have their own series.
  - **Dates and text:** entry date (Nepal day), fiscal year (BS), narration.
  - **Source:** source type, source id and source reference (the bill or voucher number people know).
  - **Kind:** `post`, `reverse`, `opening` or `manual`; `reverses_entry_id`; the posting day it belongs to; created by and at.
  - **revision:** 1, 2, 3 ... per source; a reversal carries the revision it reverses.
  - **Unique** (source type, source id, revision) for `post` and `opening`. A corrected entry takes the next revision, and only after the previous revision has been reversed (checked by the engine, backed by the index).
- **`journal_lines`:**
  - entry id, line number, account code, debit, credit (exactly one above 0), memo;
  - **customer id** on 1300 lines and **supplier id** on 2100 lines. That is the sub-ledger: a customer's or supplier's balance is the sum of their lines, and must equal Receivables / Payables (section 7).
- **`posting_days`:**
  - one row per Nepal day;
  - status `open`, `posted` or `locked`; posted at/by, locked at/by;
  - a snapshot of the day's totals and of the problems acknowledged at posting.
- **`ledger_settings`** (one row):
  - **ledger start date:** Poush 1, 2083 BS = 16 December 2026. Nothing before it posts; opening balances are at this date. The admin can change it, and it is shown clearly in BS and AD.
  - **lock after N days:** default 3 (the accountant may set 2);
  - who may post (admin, accountant) and who may reopen (admin).
- **`month_closes`:** BS year and month, AD from/to dates, closed at/by, reopened at/by with a reason.
- **Opening balances:** a draft first, an entry last (owner, 2026-11-27).
  - `opening_balance_lines` (account, customer or supplier, debit or credit, filled from the system or typed, memo) and `opening_balance_log` (every add, change, removal and fill, with who and when). These can be edited until the owner confirms them, and are marked **dummy** until then.
  - On confirmation (admin), one `opening` journal entry is posted on the start date, with 3050 Opening balance equity balancing it. After that the lines are read-only; corrections are JVs.

**Vouchers:** documents that already have numbers keep them, and the entry shows that number as its reference:
- RV (receipts);
- CV (petty cash and drawer-paid suppliers);
- PV (cheque and online supplier payments);
- PJ (purchase bills);
- DN (debit notes);
- CN (credit notes);
- invoice numbers for sales.

Accountant JVs get their own JV series (the prefix is editable, like the others).

## 4. How every event posts
Amounts are pre-VAT unless stated. "Sales" means **4000 Food sales** or **4010 Beverage sales**, split by the item's category (see question 4). A day's entries are made by small pure functions, one per source type, each unit tested.

| Event (source document) | Debit | Credit | Notes |
|---|---|---|---|
| **Cash part of a bill** (invoice) | 1100 Cash on Hand | Sales (item lines, gross); 2200 Output VAT if the bill has VAT | One entry per invoice, dated on the Nepal day it was paid. |
| **QR part** | 1270 QR receivable | as above | |
| **Card part, LHC Nabil / HBL POS** | 1250 / 1260 Card receivable | as above | Older "Card" with no machine recorded: 1250 by default, flagged as a problem. |
| **Card part, Sulimha Nabil / HBL POS** | **1280 Receivable - Sulimha card collections** (new, question 1) | as above | Owed by Sulimha until its transfer. |
| **Credit part** (credit invoice) | 1300 Accounts Receivable, with the customer | as above | |
| **Split bill** | each part to its own account above | as above | One entry; the debits add up to the bill total. |
| **Discount** (bill discount, reward item) | 4950 Discounts allowed | (in the same entry: sales are credited at the gross item value) | Gross item lines less discount = bill total. |
| **Hotel breakfast to Sulimha** | 1300 with Sulimha Durbar | **4020 Hotel breakfast income** (Rs 800 x breakfasts) | A credit invoice like any other (decision 2026-11-27). |
| **Guest extras charged to room** | 1300 with the guest | Sales | A credit invoice. |
| **NC (complimentary)** | 5200 Complimentary (NC) cost | 1400 / 1410 Inventory | At ingredient cost (the NC bill's total). No sales and no money. Posted with consumption, below. |
| **Credit note, item-wise or cancel** (CN) | 4900 Sales returns (pre-VAT); 2200 VAT if any | 1300 with the customer | On its note date. |
| **Credit note "not served" cancel**, also | 1400 / 1410 Inventory | 5000 / 5010 Consumption | The ingredient cost put back. |
| **Wrong customer** (reissue note + re-issued invoice) | 1300 with the new customer | 1300 with the old customer | A transfer between customers, not a sale or a return. |
| **Customer receipt** (RV) | 1100 cash, 1270 QR, 1250/1260/1280 card, or 1200/1210 bank (question 6) | 1300 with the customer | An unallocated receipt (an advance) still credits 1300; the customer's balance goes below zero. |
| **Settlement, LHC machine or QR** | 1200/1210 bank: amount received; 7000 Bank and card charges: the fee | 1250/1260/1270: the gross | The settlement's bank-charge expense row is skipped (posted here). |
| **Settlement, Sulimha machine** (Sulimha's transfer) | 1200/1210 (the account chosen); 7000: the fee | 1280: the gross | |
| **Petty cash payout** (CV; expense from the drawer) | the expense's account (expense_account_map) | 1100 | A payout with no bill number posts the same way and is flagged "no bill" on the review screen (7110 stays inactive unless the accountant chooses to use it). |
| **Other expense** (Expenses page, not from the drawer) | its account | 1100 cash; 1200/1210 bank or cheque (question 6) | Card or QR paid expenses are a problem until the accountant says which account. |
| **Purchase bill** (PJ) | 1400 for kitchen lines, 1410 for drink lines (by ingredient department); VAT stays in cost until registration | 2100 with the supplier (credit), 1100 (drawer), 1200/1210 (cheque/online, from paid_from_account) | The bill's expense rows are skipped. |
| **Supplier payment** (CV drawer / PV cheque or online) | 2100 with the supplier | 1100 / 1200 / 1210 | An advance (unallocated) also debits 2100 (question 7). |
| **Debit note** (DN, purchase return) | 2100 with the supplier | 1400 / 1410 | Its negative expense rows are skipped. |
| **Opening supplier bills** | — | — | In the opening balances (2100 per supplier), not posted again. |
| **Consumption** (per day) | 5000 Food / 5010 Beverage | 1400 / 1410 | From order_items.unit_cost of the day's sold items (not NC, not re-issued invoices), which already includes prep waste. One entry per day. |
| **Waste** (manual Waste Log, per day) | 5100 Waste and spoilage | 1400 / 1410 | At the logged value, or the cost as on the P&L. Prep waste is already in consumption and is not posted again. |
| **Drawer deposit to bank** | 1200 / 1210 (the deposit's bank field) | 1100 | |
| **Owner withdrawal** | 3100 Drawings | 1100 | |
| **Other cash in / out** | 1100 / the account chosen | the account chosen / 1100 | The account is chosen when the movement is recorded: 4200, 7100, 3000 or 3100. |
| **Drawer close: cash short** | 7050 Cash short/over | 1100 | From the day's counted difference. |
| **Drawer close: cash over** | 1100 | 7050 | |
| **Cancelled or voided after posting** | reverse of the original | | On the day of the change (principle 5). |

**Not posted in step 3:** salaries and TDS (step 7 payroll, step 5 TDS), course fees (step 6), depreciation (postponed by the accountant), VAT returns (step 5). VAT bills are stopped until VAT is switched on (3b); an older VAT bill is flagged on the review screen.

**Stock count differences** post to **5150 Stock adjustment** (accountant JV), not to 5100.

## 5. Next-day posting: the review screen
- **Who:** admin and accountant. The page **Ledger > Post a day** lists days from the start date: not posted, posted, locked.
- **A day's review shows:**
  1. **What will post:**
     - totals per account (debit, credit);
     - the list of entries by type (sales invoices, credit notes, receipts, settlements, purchases, payments, petty cash, drawer, consumption);
     - each entry can be opened to see its lines and its source document.
  2. **Problems, which block posting until fixed or acknowledged:**
     - **Must be fixed:**
       - a source with no account (an unmapped expense category, other cash in/out without an account);
       - an entry that does not balance;
       - a bill with no items.
     - **Can be acknowledged with a note:**
       - the drawer not closed for the day;
       - items with no recipe cost (consumption is short);
       - a card payment with no machine;
       - a VAT bill while VAT is off.
  3. **Late changes:** sources from earlier, posted days that changed since; they post as reversals on this day.
  4. **Reconciliation** (section 7): every check, with a ✔ or the difference.
- **Post:** writes all the day's entries in one transaction, marks the day `posted`, and records who did it and the totals. Days are posted in date order: a day cannot be posted while an earlier one is not.
- **Locking:**
  - **Automatic:** a posted day locks automatically N days later (default 2; the accountant can set 2 or 3). The admin or accountant can also lock it at once.
  - **What a lock stops:** creating or backdating any source document into that day (bills, receipts, expenses, purchase bills, payments, settlements, drawer entries) is refused with a clear message. Changes to its documents post on today's date.
  - **Reopening:** a locked day can be reopened by the admin only, with a reason, and only if its month is not closed.
- **Month close (Nepali month):**
  - When every day of a BS month is posted, the accountant closes the month, which also locks all its days.
  - The close shows the month's trial balance and the reconciliation summary.
  - A closed month is reopened by the admin only, with a reason.

## 6. Opening balances
- **Start date:** at a date the accountant chooses (best at the start of a Nepali month), one opening entry records:
  - 1100 the counted drawer;
  - 1200/1210 the bank statement balances;
  - 1250/1260/1270/1280 unsettled machine sales;
  - 1300 every open credit invoice by customer;
  - 1400/1410 the stock value (stock x cost per unit, by department);
  - 1600 equipment at cost;
  - 2100 every unpaid bill by supplier (opening bills and purchase bills before the date);
  - customer advances and supplier advances;
  - the difference to equity (question 2).
- **How it is prepared:** the Opening Balances screen fills every line it can from today's data as at the start date and shows each one with its source. The accountant types the bank and equipment figures, checks everything, and posts it once.
- **After the start date:** nothing before the start date ever posts. From the start date, the daily posting takes over.

## 7. Reconciliation: the ledger agrees with today's screens
Run on every review screen and at month close. Each check shows the two figures and the difference. Any difference blocks posting unless the accountant acknowledges it with a note.

| Check | Ledger | Operational screen |
|---|---|---|
| Cash | 1100 movement for the day; 1100 balance at close | Cash Drawer: expected cash change; the counted closing |
| Sales | 4000 + 4010 - 4950 - 4900 for the day, pre-VAT | Collections: net sales for the day, pre-VAT |
| VAT | 2200 movement | Collections: VAT after credit notes |
| Receivables | 1300 balance, and per customer | Receivables: total and each customer's balance |
| Payables | 2100 balance, and per supplier | Suppliers: total and each supplier's balance (aging total) |
| Machines | 1250, 1260, 1270, 1280 balances | Settlements: unsettled sales per machine |
| Stock (information only) | 1400 / 1410 balances | Stock x cost per unit now (differences come from stock counts and cost changes; the accountant decides an adjusting JV, question 12) |

## 8. Build parts and tests
Each part ends with typecheck, build, `pnpm test`, a CHANGELOG entry and the full server steps. A migration is written only where needed and run by the owner.

**3a. Accounts and the journal engine** (migration 013)
- **Build:**
  - the tables in section 3, with the chart seeded, the immutability trigger and the balance constraint;
  - the posting engine (post an entry, reverse an entry, both in a transaction);
  - numbering; account balance and trial balance readers;
  - Chart of Accounts and expense-map screens;
  - accountant JV with a reason;
  - the Opening Balances screen and its entry.
- **Tests:**
  - an unbalanced entry is refused by the database;
  - UPDATE or DELETE of an entry or line is refused;
  - a reversal mirrors the original;
  - a header account cannot be posted;
  - an inactive account cannot be posted;
  - the trial balance sums to zero;
  - the opening entry builds from sample data and balances;
  - the migration runs twice.

**3b. Sales, credit notes, receipts and settlements posting, plus the review screen** (migration 014 if the bank-account fields are added)
- **Build:**
  - **VAT bills stopped:** the payment screen and the payment API refuse a VAT bill unless VAT is switched on (a setting, off until registration).
  - **Bank fields:** a Nabil or HBL field on receipts "by bank", on drawer deposits, and on expenses paid by bank transfer or cheque (migration 014).
  - **Other cash in/out:** an account field limited to 4200, 7100, 3000 and 3100.
  - **Food or Beverage on each menu category.**
  - the builders for bills (all modes, split, discount, Sulimha machines, breakfast to 4020, room extras), credit notes (including the not-served cost back and the Wrong-customer transfer), receipts and settlements;
  - the review screen, Post, and late-change reversals for these sources;
  - the reconciliation checks for sales, VAT, receivables and machines.
- **Tests (one per builder):**
  - a split bill of cash + QR + credit;
  - a discounted bill;
  - a Sulimha card bill;
  - a breakfast bill;
  - a credit note with VAT;
  - a not-served cancel;
  - a Wrong-customer move;
  - receipts in each mode and an advance;
  - LHC, QR and Sulimha settlements with the fee;
  - a day posted twice is refused;
  - a bill cancelled after posting reverses on the cancel day;
  - the reconciliation equals Collections and Receivables on sample days.

**3c. Purchases, payments, expenses, the drawer and consumption** (migration 015 for new fields if needed)
- **Build:**
  - purchase bills by department and how they were paid;
  - supplier payments CV/PV and advances;
  - debit notes;
  - petty cash and other expenses through the map, skipping purchase, debit note and settlement expense rows;
  - drawer deposits, owner draws, other cash in/out, short/over;
  - daily consumption, NC and waste;
  - the reconciliation for cash, payables and stock.
- **Tests:**
  - a credit bill with kitchen and drink lines;
  - a drawer-paid bill;
  - a cheque bill on HBL;
  - a payment with an advance;
  - a debit note;
  - a petty cash CV with and without a bill number;
  - purchase expense rows are never posted;
  - a deposit, an owner draw, a short and an over;
  - a day's consumption equals the unit-cost snapshots;
  - an NC bill;
  - a Waste Log entry;
  - the cash check equals the drawer's expected cash;
  - the payables check equals the Suppliers total.

**3d. Period lock and month close** (migration 016)
- **Build:**
  - the automatic lock after N days;
  - refusing new or backdated documents in locked days (every write route);
  - admin reopen with a reason;
  - Nepali month close and reopen;
  - the month's trial balance.
- **Tests:**
  - a day locks after N days;
  - a backdated receipt, expense, bill and settlement into a locked day are refused;
  - a void of a document in a locked day posts its reversal today;
  - the month cannot close with an unposted day;
  - a closed month locks its days;
  - reopen needs the admin and a reason.

**After step 3** (roadmap step 4): the Day Book, Trial Balance, Balance Sheet and ledger P&L read from these journals.

## 9. What stays as it is
- **Operational screens:** they keep working exactly as now, and are not changed to read the ledger. The ledger is checked against them (section 7).
- **The existing P&L:** remains a management report. The ledger P&L comes in step 4.
- **No source document is edited by posting.** Posting only reads them and writes journals.

## 10. Risks
- **Unit-cost snapshots:** consumption depends on them, and items with no recipe cost post short. They are listed as problems every day, so the accountant sees the size.
- **Late changes:** cancellations and voids after posting will be common at first. The reversal-on-today rule keeps closed days stable but makes "today" carry old corrections; the review screen shows them clearly.
- **Locking:** it adds refusals to many existing routes (3d). Each is tested.

## 11. Changes needed in today's screens (small, in 3b/3c)
- **Which bank:** a "bank" field (Nabil or HBL) on receipts "by bank", on drawer deposits, and on expenses paid by bank transfer or cheque (3b, migration 014).
- **Other cash in/out:** an account field, one of 4200, 7100, 3000, 3100 (3b).
- **Menu categories:** "Food" or "Beverage" on each category (3b).
- **VAT bills:** refused on the payment screen and API until VAT is switched on (3b).

## 12. Questions for the owner and the accountant
1. **Sulimha's card machines:** the money is owed by Sulimha until it transfers. Is a new account **1280 Receivable - Sulimha card collections** right? Or should it go into 1300 under Sulimha Durbar's customer account, where its breakfast bills already are?
2. **Opening balances:** should the difference at the start date go to **3200 Retained earnings**, or to a new **3050 Opening balance equity** that the accountant clears later?
3. **Ledger start date:** which date? It is recommended to use the first day of a Nepali month (e.g. Poush 1, 2083), after the stock count and the bank balances are known.
4. **Food or beverage:** the plan is to mark each **menu category** "Food" or "Beverage". Sales go to 4000 or 4010 by the item's category, and consumption to 5000 or 5010 the same way. Inventory is credited 1400 or 1410 by the ingredient's department. Is that right? (A latte is beverage even though it uses kitchen sugar; the small cross-over is accepted.)
5. **Expense categories:** the accountant confirms the default account for each Expenses-page category (the screen in 3a).
6. **Which bank:** receipts "by bank", drawer deposits and expenses paid by bank or cheque do not record the bank today. Should a Nabil / HBL choice be added to each (recommended)?
7. **Supplier advances:** keep them on 2100 as a negative supplier balance, or use **1350 Advances (supplier and staff)**?
8. **VAT bills while not registered:** the payment screen can still print a VAT bill (13%). Post that VAT to 2200 and flag it? Or should VAT bills be stopped until registration?
9. **Lock:** after 2 days or 3? And should the month close be done by the accountant only?
10. **One entry per invoice** (recommended: each sale traceable, the customer sub-ledger exact), or one summary entry per day for cash, QR and card sales, with credit sales still per invoice?
11. **Other cash in / out:** which accounts can be chosen? (Suggestion: 4200 Other income, 7100 Other expenses, 3000 Owner's capital, 3100 Drawings.)
12. **Stock differences:** when the ledger's 1400/1410 differ from stock x cost (after a stock count), should the adjusting JV go to 5100 Waste and spoilage, or to a new account?
13. **Changes after posting:** reverse and re-post on the day of the change (recommended)? Or refuse any change to a document whose day is posted?

## 13. Answers (owner and accountant, 2026-11-27; CLAUDE.md "Step 3 answers")
1. **New accounts:** 1280 Receivable - Sulimha Durbar (card collections), 4020 Hotel breakfast income (breakfast invoices post here), and 7110 Petty cash, no bill (inactive until confirmed). Petty cash without a bill posts to its category and is flagged "no bill".
2. **Opening balance difference:** goes to 3050 Opening balance equity, cleared into 3200 by the accountant later. Opening balances are editable with an audit trail and marked dummy until the owner confirms them. Receivables, payables, inventory and cash are filled from the system; banks, equipment and equity are typed.
3. **Start date:** Poush 1, 2083 BS (16 December 2026).
4. **Food or beverage:** menu categories are marked Food or Beverage, for sales and consumption; inventory is credited by the ingredient's department.
5. **Expense map:** the accountant reviews the defaults on the Chart of Accounts screen. An unmapped category blocks posting.
   - **Ingredient categories:** to 1400 or 1410 (milk and dairy to 1400).
   - **5300:** packaging, other consumables, cooking gas, cooking oil, cleaning supplies.
   - **Other accounts:** electricity and water to 6200; salaries to 6000; rent to 6100; internet and telephone to 6300; equipment repairs to 6700; laundry, pest control and other administrative to 7100; bank and card charges to 7000.
6. **Which bank:** receipts by bank, drawer deposits, and expenses by bank transfer or cheque record the bank.
7. **Supplier advances:** stay on 2100 as a negative balance.
8. **VAT bills:** stopped while not VAT registered.
9. **Lock:** 3 days after posting (the accountant may set 2). The accountant closes each Nepali month; only the admin reopens a day or a month, with a reason.
10. **Entries:** one journal entry per invoice.
11. **Other cash in/out:** 4200, 7100, 3000, 3100.
12. **Stock count differences:** to 5150 Stock adjustment.
13. **Changes after posting:** reverse and re-post on the day of the change.

## 14. Part 3a as built (see docs/CHANGELOG.md)
- **Migration 013:**
  - **Accounts and map:** `accounts` (seeded) and `expense_account_map` (seeded with the defaults, unconfirmed).
  - **Journals:** `journal_entries` (with `revision`) and `journal_lines`. The database refuses edits and deletes, unbalanced entries, and lines on header or inactive accounts, and allows one `post` per source and revision.
  - **Settings:** `ledger_settings` (start date 2026-12-16, lock 3 days).
  - **Opening draft:** `opening_balance_lines` and `opening_balance_log`.
  - `posting_days` and `month_closes` come with 3b and 3d.
- **Journal engine (lib/ledger.ts):** post, reverse, trial balance, account ledger.
- **Accounts page (admin and accountant):**
  - the chart, with add and deactivate, and the expense map with problems;
  - journals: list, accountant JV with a reason, reverse;
  - the trial balance;
  - opening balances: fill from the system, type, the log, and confirm by the admin;
  - settings: the start date shown in BS and AD.

## 15. Part 3b as built (2026-11-27; see docs/CHANGELOG.md)
- **Migration 014:**
  - `menu_categories.revenue_kind` (food | beverage);
  - `ledger_settings.vat_enabled` (false);
  - `bank_account` on `customer_receipts`, `cash_movements` and `expenses`;
  - `cash_movements.account_code`;
  - `posting_days`.
- **Required from now on:**
  - the bank on receipts by bank, deposits, and expenses by bank transfer or cheque;
  - the account (4200, 7100, 3000 or 3100) on other cash in/out.
  - VAT bills are refused by the payment API and screen until the admin switches VAT on.
- **Posting rules** (lib/postingRules.ts), one entry per document:
  - bills (SJ): debits by payment mode; sales by category kind; 4950 for the discount; 4020 for hotel breakfasts; 2200 for VAT;
  - credit notes (SJ): 4900, 2200, 1300; a Wrong-customer move is a 1300 to 1300 transfer;
  - receipts (RJ);
  - settlements (ST): the bank, 7000, the machine.
  - Journal numbers have their own series (SJ, RJ, ST), so the RV, CV and PV document numbers are untouched.
- **Review (lib/glPosting.ts, Chart of Accounts > Post a day):**
  - **Blockers:** before the start date; not yet ended; out of date order.
  - **Must fix:** opening balances not confirmed; a category not marked Food or Beverage; a credit part with no customer; an unknown mode; a bank receipt with no bank; a bill with no items.
  - **To acknowledge (with a note):** the drawer not closed; a VAT bill; a card with no machine; items not adding up to the bill; any reconciliation difference.
  - **Late changes on the day posted:**
    - a cancelled or voided document is reversed;
    - a changed one is reversed and re-posted at the next revision;
    - a document dated on an already-posted day is posted late.
  - **Reconciliation:**
    - **sales before VAT and VAT:** the day's own entries against Collections;
    - **receivables at the end of the day:** total and per customer, against Receivables' own figures as at that day (a re-issued invoice counts from its move);
    - **unsettled machines 1250/1260/1270/1280:** against Settlements from the settlement start date.
- **Posting:** one transaction; the posting_days row is written first, so the same day cannot post twice.
- **Deferred to 3c (with consumption):** the ingredient cost put back by a "not served" cancel (Dr 1400/1410, Cr 5000/5010), and NC bills (5200). 3b posts no inventory or cost lines.

## 16. Part 3c as built (2026-11-27; see docs/CHANGELOG.md)
- **No migration:** every field 3c needs already exists (014 added the banks and accounts).
- **Posting rules** (lib/postingRules.ts), journal series of their own:
  - **purchase bills (PB):** 1400 kitchen / 1410 drink lines at line total, VAT in cost while VAT is off; against 2100 with the supplier (credit), 1100 (drawer) or 1200/1210 (cheque or online, from paid_from_account). Opening bills are not posted;
  - **supplier payments (SP):** 2100 with the supplier against 1100 or the bank. An advance is the same, so the supplier goes negative;
  - **debit notes (DJ):** 2100 against 1400/1410 by line department;
  - **expenses (EX):** through expense_account_map, against 1100 (drawer or cash) or 1200/1210 by expenses.bank_account. Card or QR, a missing bank or an unmapped category is a must-fix. Petty cash with no bill posts the same way and is flagged "no bill". Rows of purchase bills, debit notes, Record purchase and settlement bank charges are never posted;
  - **cash movements (CM):** a deposit to 1200/1210 by its bank, an owner draw to 3100, other in/out to its account;
  - **drawer close (CC, one per day):** a short Dr 7050, an over Cr 7050;
  - **consumption (CO, one per day):**
    - sold items' unit_cost x quantity, Dr 5000/5010 by category kind;
    - NC bills Dr 5200; Waste Log entries (not prep waste, not equipment) Dr 5100;
    - all against 1400/1410, split by each menu item's recipe cost by ingredient department (by category kind when the recipe has no cost);
    - "not served" cancels put the stock back (Dr 1400/1410, Cr 5000/5010);
    - items with no recipe cost are flagged with the sales they carry.
- **Late changes:** every 3c type is reversed or re-posted at the next revision when it changes after posting, and posted late when entered after its day.
  - A day's consumption is rebuilt when its sales change. A late sale on a day with no consumption entry adds one.
  - Problems of a posted document are raised again only if its entry changes.
- **Reconciliation:**
  - **Cash:** the day's 1100 movement (without the short/over) against the Cash Drawer's expected change; the 1100 balance at the close against the counted cash.
  - **Payables:** total and each supplier against credit bills less payments and debit notes as at the day.
  - **Stock (information only, never a problem):** 1400/1410 against stock x cost per unit now.
