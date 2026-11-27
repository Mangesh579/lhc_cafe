# Step 4: reports from the ledger (plan, not built)

Written for: the owner and the accountant, to review and answer section 9 before anything is built, and for whoever builds it.
Status: approved 2026-11-27 (the owner accepted all 15 answers of section 9 as recommended; question 8 answered with the recommended comparison layout). Builds on step 3 (docs/specs/step3-ledger.md: the journal, next-day posting, the lock and month close).

## 1. What step 4 adds, in one paragraph
The ledger now holds every posted voucher (sales, credit notes, receipts, settlements, purchases, supplier payments, debit notes, expenses, drawer movements, the drawer close, daily consumption, journal vouchers and the opening entry). Step 4 reads it and nothing else. It adds:
- the books: Day Book, General Ledger per account, Cash Book and the two Bank Books;
- the statements: Trial Balance, Profit and Loss, Balance Sheet;
- a statement per customer and per supplier;
- a this-month-against-last-month comparison.

Each report has an Excel and a PDF export, with BS dates and Nepali number grouping. Reports never write.

## 2. Principles
1. **One source:** reports read journal_entries and journal_lines only. They never read orders, expenses or bills for their figures. The figures therefore agree with the Trial Balance by construction. The step 3 reconciliation checks already tie the ledger to the operational screens.
2. **Read-only:** every report is a GET. No report posts, reverses, locks or saves anything; a test proves it (section 8).
3. **Posted data only:**
   - The journal holds posted days only (plus JVs and the opening entry). A day not posted yet is simply not in the reports.
   - Every report shows "Posted up to <last posted day> (<BS>)". When the period reaches past that day it also shows "<n> day(s) in this period are not posted yet; their figures are not included."
4. **Admin and accountant only:**
   - every /reports route answers 403 to other roles;
   - the Reports page and its sidebar entry show only for these two roles;
   - cost of sales lines are costs, so nobody else ever sees them. hideCosts is not involved, because no other role reaches these routes at all.
5. **No new money logic:** the account balances already exist. Step 4 groups, orders and formats them; every total is checked against the Trial Balance.
6. **Dates:**
   - shown in BS first with the AD date beside it, e.g. "15 Poush 2083 (30 Dec 2026)";
   - periods are chosen in BS (a day, a BS month, a BS fiscal year from Shrawan 1, or a custom range);
   - the Nepal day rules of step 3 apply unchanged.

## 3. Common to every report

### Periods
- **Period reports** (Day Book, General Ledger, Cash and Bank Books, Trial Balance by period, P&L, statements) take one of:
  - a day;
  - a BS month (lib/fiscal.ts bsMonthRange);
  - a BS fiscal year (Shrawan 1 to the end of Ashadh; 2083/84 starts at the ledger start, Poush 1 2083, so it is a part year);
  - a custom range.
- **As-at reports** (Trial Balance as at, Balance Sheet) take one date. Its quick picks are today, the end of a BS month and the end of a fiscal year.
- A period before the ledger start shows nothing and says so.

### Numbers
- **Nepali (lakh) grouping:** 1,23,45,678.50. Two decimals. Negatives in brackets: (1,250.00). Zero shows as a dash in statements and as 0.00 in books.
- **Latin digits** by default (question 9.12).
- **Excel cells keep real numbers.** The grouping is a cell number format (`#,##,##0.00;(#,##,##0.00);-`), not text, so the accountant can add them up.

### Drill-down
- **Each journal line links to its entry:** the voucher, the narration, all its lines, and its reversal or correction if any.
- **Each entry links to its source document by source_type:**

| source_type | Opens |
|---|---|
| order | Order Log, that bill |
| credit_note | Receivables, that note (print) |
| receipt | Receivables, that receipt voucher (print) |
| settlement | Settlements, that day and machine |
| purchase_bill | the purchase bill page |
| supplier_payment | Suppliers > Payments, that voucher |
| debit_note | Suppliers > Returns, that note |
| expense | Expenses, that row (with its CV) |
| cash_movement, cash_close | Cash Drawer, that day |
| consumption | a new read-only "Consumption of <day>" view, built from the entry's lines and memos |
| stock_adjustment | Inventory > Stock Log, that row (step 3e, voucher SA) |
| opening | Chart of Accounts > Opening balances |
| (none: manual JV) | Chart of Accounts > Journals, that JV |

- A test checks that every source_type the posting rules use has a link, so a new type cannot be left without one.

### Layout comes from the server
- Each statement endpoint returns ready rows: section, line, account codes, amounts, subtotal or total.
- The screen, the Excel file and the PDF all render the same rows, so the three cannot disagree.
- The P&L and Balance Sheet layout (which account goes in which line) lives in one file, lib/reportLayout.ts, and is tested.
- Any active account the layout does not place shows under "Other (not yet placed)". Nothing is ever silently left out, and the totals still agree with the Trial Balance.

## 4. The reports

### 4.1 Day Book
- **What:** every voucher in date order, grouped by day. Each voucher shows:
  - its number, type and narration;
  - the source reference (invoice no., RV, PJ, CV...);
  - its lines (account, customer or supplier, memo, debit, credit).
- **Day totals and period totals** (debit = credit).
- **Filters:**
  - voucher type: SJ sales, RJ receipts, ST settlements, PB purchases, SP supplier payments, CV, DJ debit notes, EX expenses, CM cash movements, CC drawer close, CO consumption, SA stock adjustments, JV, OPEN;
  - kind: posted, reversal, correction, late, manual;
  - an account;
  - a customer or supplier;
  - text in the narration or reference.
- **Paging:** 200 vouchers a page. The totals are for the whole filter, not the page.
- **Endpoint:** GET /reports/day-book?from&to&types&kinds&account&customerId&supplierId&q&page

### 4.2 General Ledger (one account)
- **What:** the opening balance at the start of the period, then each line with date, voucher, narration, the other side of the entry, memo, debit, credit and running balance.
  - "The other side" means the names of the entry's other accounts, e.g. "Food sales, Beverage sales".
  - The running balance is in the account's normal direction, with Dr/Cr shown.
- **Totals:** period debit and credit, then the closing balance.
- **For 1300 and 2100:** an optional customer or supplier filter. Without it, a sub-ledger summary lists each party's opening, movement and closing.
- **Account picker:** all postable accounts, grouped by type. Header accounts give a summary of their children.
- **Built on** the existing lib/ledger.ts accountLedger, extended with paging, the other side, and the party filter.
- **Endpoint:** GET /reports/ledger/:code?from&to&customerId&supplierId&page

### 4.3 Cash Book (1100) and Bank Books (1200 Nabil, 1210 HBL)
- **What:** the General Ledger of that account in book form.
  - Columns: date, voucher, particulars (the other side), Receipts (Dr), Payments (Cr), balance.
  - A daily closing balance line.
- **Cash Book:** each day also shows the drawer's counted cash from cash_days. Shown for reference; it should equal the closing, because the short/over is posted at the close.
- **Bank Books:** the cheque, transfer or settlement reference in its own column.
- **Not in step 4:** reconciling against the bank statement (question 9.11).
- **Endpoint:** GET /reports/book/:code?from&to (the code must be 1100, 1200 or 1210).

### 4.4 Trial Balance
- **As at a date:** what exists today (GET /gl/trial-balance), moved onto the Reports page.
- **For a period:** six columns. For each account: opening Dr/Cr, period Dr/Cr, closing Dr/Cr, and totals that balance.
- **Options:**
  - hide zero-balance accounts (on by default);
  - group by account type with subtotals.
- **Endpoints:** GET /reports/trial-balance?to, and ?from&to for the period form.

### 4.5 Profit and Loss
Vertical layout (question 9.1). Amounts for the chosen period, with an optional comparison column (section 4.8).

```
Revenue
  Food sales                        4000
  Beverage sales                    4010
  Hotel breakfast income            4020
  Course fees                       4100
Gross sales                         (sum)
  Less: Discounts allowed           4950
  Less: Sales returns (credit notes) 4900
Net sales                           (sum)
Cost of sales
  Ingredient consumption - Food     5000
  Ingredient consumption - Beverage 5010
  Complimentary (NC) cost           5200
  Waste and spoilage                5100
  Stock adjustment                  5150   (question 9.5)
  Operating consumables             5300   (question 9.6)
Gross profit                        (net sales - cost of sales), with GP % of net sales
Operating expenses
  Salaries 6000, Rent 6100, Electricity and water 6200, Telephone and internet 6300, Stationery 6400,
  Fuel and gas 6500, Insurance 6600, Repairs and maintenance 6700, Advertising 6800,
  Bank and card charges 7000, Cash short/(over) 7050 (question 9.4), Other expenses 7100,
  Petty cash, no bill 7110 (when active)
Total operating expenses
Operating profit
Other income                        4200
Net profit / (loss)
```

- **Periods:** a day, a BS month, a BS fiscal year, a custom range.
- **Check:** net profit equals income less expenses from the Trial Balance for the same period. A test proves it, and a red line appears on screen if they ever differ.
- **Percentages:** a "% of net sales" column (on by default).
- **Endpoint:** GET /reports/profit-loss?from&to&compare=prev|none

### 4.6 Balance Sheet (as at a date)
Vertical layout.

```
Assets
  Current assets
    Cash on hand 1100; Bank - Nabil 1200; Bank - HBL 1210
    Card and QR receivables 1250, 1260, 1270; Receivable - Sulimha Durbar 1280
    Accounts receivable 1300 (customers who owe)
    Advances to suppliers (suppliers with a debit balance on 2100)   (question 9.7)
    Advances (supplier and staff) 1350
    Inventory - Kitchen 1400; Inventory - Drinks 1410
    Input VAT 1450 (zero until VAT registration)
  Non-current assets
    Equipment and furniture 1600, at cost (question 9.2)
Total assets
Liabilities
  Accounts payable 2100 (suppliers we owe)
  Customer advances: 2360 plus customers with a credit balance on 1300   (question 9.7)
  Output VAT payable 2200; TDS payable 2250; Salary payable 2300; Advance course fees 2350
Total liabilities
Equity
  Owner's capital 3000
  Less: Drawings 3100                                   (question 9.3)
  Opening balance equity 3050 (until the accountant clears it to 3200)
  Retained earnings 3200, plus the profit of earlier fiscal years
  Profit for the current fiscal year to date
Total equity
Total liabilities and equity       = Total assets (checked; a red line if not)
```

- **Profit inside equity:** there are no year-end closing entries yet, so income and expense accounts still hold every year's figures. The Balance Sheet computes:
  - this fiscal year's profit to the date;
  - the profit of every earlier fiscal year, added to retained earnings.
- A fiscal-year closing JV (income and expense into 3200) is a later decision (question 9.13). Until then nothing is posted for it.
- **Endpoint:** GET /reports/balance-sheet?at&compare=prev|none

### 4.7 Customer and supplier statements (from the journal)
- **Customer:** the lines of 1300 for one customer.
  - Opening balance, then each invoice (SJ), credit note, receipt, re-issue and correction, with a running balance and the closing.
  - Party details (name, phone, PAN if any), the period in BS, and the credit days.
  - Printable to hand or send to the customer.
- **Supplier:** the same from 2100, for one supplier.
  - Shows bills, payments (with advances), debit notes and opening bills.
  - The balance is shown as "we owe" or "advance paid".
- **All customers or all suppliers:** a summary with each party's opening, debits, credits and closing for the period, and a total that equals 1300 or 2100.
- **Agreement:** the closing balance should equal the Receivables or Suppliers screen balance for posted days. The step 3 checks already compare these daily. The statement shows "agrees with Receivables" or the difference.
- **Aging stays on the Receivables and Suppliers screens.** It works by due date, which the operational data holds.
- **Endpoints:** GET /reports/customers/:id/statement?from&to, GET /reports/suppliers/:id/statement?from&to, GET /reports/customers?from&to, GET /reports/suppliers?from&to.

### 4.8 Comparison (this month against last month)
- **What:** the P&L and the Balance Sheet side by side for two periods (owner, 2026-11-27: the recommended layout).
  - **P&L columns:** this month, % of net sales, last month, % of net sales, change in rupees, change in %, fiscal year to date, % of net sales. From the second fiscal year (Poush 2084) add the same month last year and the same fiscal year to date last year.
  - **Variance colour:** by good or bad, not up or down (income up is good, expense up is bad). A line is highlighted only when its change is above the percentage threshold (20%) AND above the minimum amount (Rs 1,000). Both are settings.
  - **Key ratios block under the P&L:** gross profit %, food cost % (5000 / 4000), beverage cost % (5010 / 4010), salaries as % of net sales (6000), prime cost % ((cost of sales + 6000) / net sales).
  - **Balance Sheet columns:** at this month end, at last month end, change in rupees, and at the start of the fiscal year.
  - **Config-driven:** the columns come from one config in lib/reportLayout.ts, so a different layout (for example an Aegis sample) is a config change.
  - **Not built now:** a budget and "variance to budget" (a later feature).
- **Default:** this BS month against last BS month; for the Balance Sheet, the end of each month.
- **Other choices:** this fiscal year to date against the same days of the previous fiscal year. Before FY 2084/85 there is no earlier year, so that column is empty and says why.
- **The format:** the brief asks for the "4-year-old Aegis-style comparison". That format is not documented anywhere, so the owner approved the layout above as the answer to question 9.8 (2026-11-27), based on how restaurant accounting systems compare periods (prior period, same period last year, variance, % of sales). If the accountant ever sends an Aegis sample, only the config changes.
- **Endpoint:** the compare parameter of 4.5 and 4.6, plus GET /reports/compare?period=month&at=<y>/<m>.

## 5. Exports (every report)
- **Excel:** xlsx, already used by the app.
  - The Excel sheet uses the same rows as the screen.
  - A header block: "Legendary House Cafe & Barista Coffee School", PAN 194139113, the report name, the period in BS (and AD), "Posted up to …", printed by and when.
  - Numbers stay numeric with the lakh format. Statements keep their section and total rows, in bold.
  - Books put one row per line, so the accountant can filter.
- **PDF:** jspdf and jspdf-autotable, already used by the app.
  - A4, portrait for statements and landscape for books.
  - The same header, page numbers "Page 1 of 3", totals repeated at the foot of each page for books, and a signature line ("Prepared by", "Checked by") on statements.
  - Month names are in English letters (Poush, Magh). A Devanagari PDF would need an embedded font (question 9.12).
- **File names:** `<report>-<period in BS, e.g. 2083-09>.xlsx|pdf`.
- **Size:** a full-year Day Book can be large. Above 5,000 vouchers, Excel exports all of it; the PDF asks to narrow the period, or to export it month by month.

## 6. Performance (a year of data)
- **Expected size:** about 100 bills a day plus receipts, expenses and the daily entries. That is roughly 50,000 entries and 200,000 lines in a year.
- **How it stays fast:**
  - Every total is a SQL SUM grouped by account (and by party or day where needed), never a loop in JavaScript over all lines.
  - Running balances: the opening comes from one SUM before the period, then one ordered read of the page's lines.
- **Indexes:**
  - These exist (migration 013): journal_entries(entry_date), journal_lines(entry_id) and journal_lines(account_code).
  - Part 4a adds migration 017_report_indexes.sql (idempotent, indexes only, no data change):
    - journal_lines(account_code, entry_id);
    - partial indexes on journal_lines(customer_id) and journal_lines(supplier_id) where they are not null;
    - journal_entries(voucher_type, entry_date).
  - Run by the owner, as always.
- **Targets on the server, for a year of data:** each statement under 1 second; a Day Book page and a General Ledger page under 1 second; a full-year Excel under 10 seconds.
- **Paging:** books page by 200 vouchers or 500 lines. Totals always cover the whole filter.
- **No caching:** reports are computed on demand. Closed months (period_closes) are final, so a cache of closed-month totals is possible later if needed, but it is not built now.

## 7. Screens
- **New Reports page** (/reports, admin and accountant), with tabs: Day Book, General Ledger, Cash and Bank Books, Trial Balance, Profit and Loss, Balance Sheet, Statements, Compare.
- **Each tab has:**
  - a period picker in BS: day, month, fiscal year, custom;
  - "Posted up to …";
  - the report;
  - Excel and PDF buttons;
  - drill-down links (section 3).
- **Moves:** the Trial Balance tab on Chart of Accounts links to the Reports page. Chart of Accounts keeps posting, accounts, journals, opening balances and month close.
- **Unchanged:** the existing operational reports (Ledgers page, Collections, Order Log P&L, opcosting) stay as they are. They answer "what happened at the counter". Step 4 answers "what the books say".

## 8. Build parts and tests

### 4a: books (Day Book, General Ledger, Cash and Bank Books, Trial Balance by period)
- **Server:**
  - lib/reports/books.ts (dayBook, generalLedger with the other side and party filter, book);
  - lib/reports/periods.ts (BS day, month, fiscal year and custom range to AD from and to, "posted up to");
  - routes/reports.ts (GET only, admin and accountant).
- **Migration:** 017_report_indexes.sql.
- **Screen:** Reports page with these four tabs, plus the drill-down and the Consumption view.
- **Tests (PGlite, the step 3 worked days as data):**
  - the Day Book totals for a period equal the Trial Balance movement for that period, and each voucher-type filter returns only its type;
  - the General Ledger: opening + debits - credits = closing, for each normal side, and the closing equals the Trial Balance balance; paging does not change the totals;
  - 1300 and 2100 party filters, where each party's closing equals the sub-ledger summary and the summary total equals the account;
  - the Cash Book closing equals 1100 and the drawer's count on a closed day; the Bank Books equal 1200 and 1210;
  - the period Trial Balance: opening + movement = closing per account, and all six columns balance;
  - BS periods: Poush 2083 from and to; FY 2083/84 starts at the ledger start; FY 2084/85 runs Shrawan 1 to the end of Ashadh;
  - every source_type used by the posting rules has a drill-down link;
  - staff and supervisor get 403 on every /reports route;
  - read-only: every /reports endpoint is called and the row counts of all tables, and the journal, are unchanged;
  - performance: a generated year (about 50,000 entries) on PGlite, each endpoint timed. A loose limit (5 seconds on PGlite) catches an accidental loop, not a precise target.
  - migration 017 runs twice.

### 4b: statements (P&L, Balance Sheet, customer and supplier statements, comparison)
- **Server:**
  - lib/reportLayout.ts (P&L and Balance Sheet lines by account, with the answers of section 9);
  - lib/reports/statements.ts;
  - endpoints 4.5 to 4.8.
- **Screen:** the four tabs.
- **Tests:**
  - a worked month with known numbers, giving the P&L line by line (gross sales, discounts, returns, net sales, each cost line, gross profit and GP %, expenses, net profit);
  - the P&L net profit equals Trial Balance income less expense for day, month, fiscal year and custom periods;
  - the Balance Sheet balances at the ledger start, mid-month, at a month end, and after a reversal and repost;
  - this year's profit and earlier years' profit split at Shrawan 1, using generated data across a fiscal-year boundary;
  - a supplier with an advance shows under assets and a customer with a credit balance under liabilities (if 9.7 is accepted); the totals still balance;
  - drawings reduce equity; opening balance equity is shown apart;
  - a customer statement's closing equals the Receivables balance for posted days; a supplier statement's equals the supplier ledger;
  - all-customer and all-supplier summary totals equal 1300 and 2100;
  - comparison: this month against last month, the change and %, and the empty earlier-year column before 2084/85 with its message;
  - an account placed nowhere in the layout shows under "Other (not yet placed)" and the totals still agree.

### 4c: exports (Excel and PDF for every report)
- **Frontend:**
  - lib/reportFormat.ts (lakh grouping, brackets, BS dates, header block, file names);
  - lib/reportExport.ts (rows to xlsx; rows to PDF with autotable).
  - The buttons on every tab.
- **Tests:**
  - lhc-cafe has no test runner today; 4c adds vitest to it for these pure helpers only, and the root `pnpm test` runs both packages;
  - formatting: 12345678.5 gives 1,23,45,678.50; -1250 gives (1,250.00); 0 gives a dash in statements; 999.995 rounds; BS labels at month and year ends;
  - the Excel builder: header rows, numeric cells with the lakh format, bold totals, and the same rows as the API returns, for each report;
  - the PDF builder: the page count for a long Day Book, the header and the page numbers present (a smoke test on jspdf's output);
  - the large-export rule (above 5,000 vouchers the PDF refuses with the message).
- **Not automated:** how the PDF looks on paper. The owner or accountant checks one printout of each report.

## 9. Questions for the accountant (each with a recommended answer; all 15 approved as recommended by the owner, 2026-11-27; question 8: answered with the recommended comparison layout, see section 4.8)
1. **Format of the statements.**
   - Recommended: vertical statements (as in section 4.5 and 4.6), in the usual Nepal small-business layout (NFRS for SMEs style): revenue, cost of sales, gross profit, expenses, net profit; assets, then liabilities and equity.
   - Not T-form.
2. **Depreciation lines.**
   - Recommended: none for now. Equipment shows at cost with the note "No depreciation charged (accountant's decision of 2026-11-24)".
   - When the accountant asks, accounts 1650 and 6850 are added and the layout shows "Less: accumulated depreciation" under 1600 and a Depreciation line in expenses.
3. **Drawings and owner's capital.**
   - Recommended: in equity, Owner's capital (3000), then "Less: Drawings" (3100) as a deduction, Opening balance equity (3050) on its own line until cleared, Retained earnings, and Current year profit.
   - Drawings are never an expense on the P&L.
4. **Cash short/over (7050).**
   - Recommended: one line in operating expenses, "Cash short/(over)", net for the period (an overall over shows in brackets).
   - Not split between expense and other income.
5. **Stock adjustments (5150).**
   - Recommended: in cost of sales, on its own line after Waste, so the gross profit reflects real stock.
   - Shown even when zero, so the accountant sees the counts were done.
6. **Operating consumables (5300: packaging, gas, cooking oil, cleaning).**
   - Recommended: in cost of sales, as "Other direct costs", because they are used in making and serving.
   - The brief lists 5000/5010/5200/5100 only, so please confirm, or say to put it under operating expenses.
7. **Advances on the wrong side.** Suppliers with a debit balance (advances, decided 2026-11-27 to stay on 2100) and customers with a credit balance on 1300.
   - Recommended: on the Balance Sheet, show them apart. "Advances to suppliers" goes under assets; customer credit balances are added to "Customer advances" under liabilities.
   - The General Ledger and statements keep them on 2100 and 1300 as posted.
8. **The comparison format ("Aegis-style", from the system used 4 years ago).**
   - Please share one printed or Excel sample of that report: its columns and rows.
   - Recommended until then: this month, last month, change and change %, for the P&L and the Balance Sheet, with changes above 20% highlighted.
9. **Comparison periods.**
   - Recommended: month against previous month (the default) and fiscal year to date against the same days of last fiscal year (from 2084/85).
   - Add the same month of last year once a year of data exists.
10. **Discounts and credit notes on the P&L.**
    - Recommended: as deductions from gross sales (Gross sales, less Discounts, less Sales returns, equals Net sales). Not as expenses.
    - NC cost (5200) is in cost of sales, as the brief says.
11. **Bank reconciliation against the bank statement.**
    - Recommended: not in step 4. The Bank Books show the ledger side with references.
    - A reconciliation screen (tick off statement lines) is a later step if the accountant wants it.
12. **Digits and script.**
    - Recommended: Latin digits with lakh grouping, and BS month names in English letters, on the screen, in Excel and in the PDF.
    - Devanagari digits or text in the PDF need an embedded Nepali font; add it only if needed for submission.
13. **Fiscal-year close.**
    - Recommended: no closing entry in step 4; the Balance Sheet computes earlier years' profit into retained earnings.
    - At the first year end (Ashadh 2084) the accountant decides whether to post a closing JV (income and expenses into 3200), as a small later part.
14. **Days not posted yet.**
    - Recommended: reports show posted figures only, with the "Posted up to …" line and the warning, rather than refusing to show a period.
15. **Hotel breakfast (4020) and course fees (4100).**
    - Recommended: their own revenue lines (as above), not merged into food sales.

## 10. Risks
- **The layout drifts from the chart.** A new account added later would be missing from the statements. Mitigation: the "Other (not yet placed)" line, and the total checks against the Trial Balance.
- **Profit of earlier years without closing entries:** the computation must split exactly at Shrawan 1. This is tested across a generated year boundary.
- **Large exports in the browser:** PDF generation of a full year can freeze the tab. Mitigation: the 5,000-voucher rule, and month-by-month export.
- **People read reports as complete while days are unposted.** Mitigation: the "Posted up to" line and the warning on every report and export.

## 11. What stays as it is
- Posting, the lock, the month close and the chart of accounts (step 3).
- The operational screens and reports.
- No change to any table except the indexes of migration 017 (016 is step 3e, stock adjustments).

## 12. Part 4a as built (2026-11-28; see docs/CHANGELOG.md)
- **Server:**
  - lib/reports/periods.ts: resolvePeriod (day, month=2083-09, fy=2083/84, from&to; the default is the current BS month), postedInfo, reportMeta;
  - lib/reports/books.ts: dayBook, generalLedger (the running balance as a window over the whole period), subLedger, book, trialBalancePeriod, journalParties;
  - lib/reports/drilldown.ts: SOURCE_LINKS, entryDetail, sourceDocument, consumptionView;
  - routes/reports.ts.
- **Endpoints:** the ones in 4.1 to 4.4, plus /reports/meta, /reports/parties, /reports/entries/:id, /reports/source/:type/:id and /reports/consumption/:day.
- **Day Book kinds:** "correction" and "late" are post entries with "(corrected:" or "(late:" in the narration.
- **Drill-down:** the source document is shown read-only inside Reports with an "Open in <page>" link. Only /suppliers?bill=<id> opens the exact document; deep links on the other pages are a possible later change.
- **Migration:** 017_report_indexes.sql (section 6).
- **Screen:** /reports with the four tabs; the BS period picker; the "Posted up to" line; lakh grouping with brackets for negatives.
- **Not built:** 4b statements, 4c exports.

## 13. Part 4b as built (2026-11-28; see docs/CHANGELOG.md)
- **Layout and columns** (lib/reportLayout.ts, config): PL_LAYOUT, BS_LAYOUT, PL_COLUMNS and BS_COLUMNS.
  - buildProfitLoss and buildBalanceSheet are pure: account sums in, rows out.
  - keyRatios gives the ratios; changeOf gives the highlight and the good/bad tone.
- **Net profit** is every income and expense account's Cr - Dr, so it equals the Trial Balance by construction; the endpoint checks it anyway.
- **Server** (lib/reports/statements.ts): profitLoss, balanceSheet, compareView, customerStatement, supplierStatement, partySummary.
- **Periods** (lib/reports/periods.ts): previousPeriod, lastYearPeriod (bsYearEarlier for days and ranges), ytdPeriod and fyStartOf.
- **Settings:** report_settings (migration 018), changed by the admin with PATCH /gl/report-settings, outside /reports.
- **Balance Sheet:**
  - each customer's and supplier's net is placed by its sign (receivable or customer advance; payable or supplier advance);
  - retained earnings = 3200 + the profit before the fiscal year's start; current profit = from the fiscal year's start to the date;
  - the fiscal-year-start column is the day before Shrawan 1, or the opening entry alone in the first year.
- **Statements:**
  - built on generalLedger with the party filter;
  - each line is named from its source: invoice, credit note (cancel, re-issue), receipt, bill, opening bill, payment, debit note, correction;
  - the agreement compares the ledger at the last posted day with receivablesAsOf or payablesAsOf.
- **Screen:** the Profit and Loss, Balance Sheet, Statements and Compare tabs (components/reports/statements.tsx).
- **Not built:** 4c exports.

## 14. Part 4c as built (2026-11-28; plan and decisions in docs/specs/step4c-exports.md)
- **Built on the server, not in the browser** as sections 5 and 8 (4c) of this plan first said:
  - GET /reports/export/:report?format=xlsx|pdf;
  - adapters in lib/reports/exportDocs.ts and builders in lib/reportExport.ts (exceljs, streaming; pdfmake);
  - helpers in lib/reportFormat.ts, tested in the api-server suite. No vitest in lhc-cafe.
- **Excel's lakh commas** come from the PC's region (English (India)). The format string `#,##,##0.00` of section 3 does not group in lakhs in Excel, so the files use `#,##0.00;(#,##0.00);"-"`.
- **File names:** LHC_<Report>_<period>.xlsx|pdf (instead of section 5's `<report>-<period>`).
- **PDFs:** no carried-forward totals per page (the owner, 2026-11-28); the column headings repeat on every page.
