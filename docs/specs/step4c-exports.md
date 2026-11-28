# Step 4c: Excel and PDF exports, plus three 4b fixes (plan, not built)

Written for: the owner, to approve before any code is written, and for whoever builds it.
Status: approved by the owner on 2026-11-28 (answers in section 10: 1 a, 2 a, 3 "Sulimha Durbar, Patan", 4 the recommendation, no carried-forward totals) and built the same day (docs/CHANGELOG.md, 2026-11-28 (e)). Builds on 4a and 4b (docs/specs/step4-reports.md sections 12 and 13).

## 1. In one paragraph
Every report on the Reports page gets two download buttons, Excel and PDF:
- Day Book, General Ledger, Cash Book, Bank Books, Trial Balance;
- Profit and Loss, Balance Sheet, Compare;
- customer and supplier statements, and the all-customers and all-suppliers summaries.

The server builds each file from the same lib/reports functions that feed the screen, so the numbers cannot differ. The export routes are GET only, for the admin and the accountant; everyone else gets 403, and nothing is written. Before that, three small 4b fixes (part A).

## 2. Where the spec and the code disagree (and what this plan does)
| # | The spec (step4-reports.md) | The code or the request | This plan |
|---|---|---|---|
| 1 | Sections 5 and 8 (4c): exports built in the browser with xlsx and jspdf; vitest added to lhc-cafe for the helpers | The request needs export routes with 403 tests, built from the server's report functions | Exports are built **on the server**. The helpers live in api-server and are tested in the existing suite. No vitest in lhc-cafe (section 4). |
| 2 | Section 5: "xlsx, already used by the app" | The free SheetJS (xlsx 0.18) cannot write bold, cell fills or frozen rows | Use **exceljs** on the server: styles, fills, frozen rows, number formats, and a streaming writer for large files. |
| 3 | Section 3 and 5: the cell format `#,##,##0.00;(#,##,##0.00);-` gives lakh grouping | Excel ignores the repeated commas: that format shows 1,234,567.00. Excel draws digit grouping from the Windows region setting. | Use `#,##0.00;(#,##0.00);"-"`. On a PC set to English (India) this shows 12,34,567.00 (question 10.2). |
| 4 | Section 5: file names `<report>-<period>.xlsx` | The request: `LHC_<Report>_<period>.xlsx` | The request's names (section 6.8). |
| 5 | Section 5: header "Legendary House Cafe & Barista Coffee School, PAN 194139113" | The app's printed notes and vouchers say "Sulimha Durbar, Pimbahal, Nepal"; the request says "Sulimha Durbar, Patan" | The request's text, unless you say otherwise (question 10.3). |
| 6 | Section 5: books repeat their totals at the foot of each PDF page; statements have a "Prepared by / Checked by" line | The request does not mention either | The column headings repeat on every page. The signature line stays on statements. No per-page carried-forward totals (question 10.4). |
| 7 | Section 5: portrait for statements, landscape for books | The request: landscape for wide reports (comparison, ledgers), portrait for the rest | Landscape for the Day Book, General Ledger, Cash and Bank Books, the period Trial Balance, Compare, and a P&L with comparison columns. Portrait for the rest. |
| 8 | 4b as built: a row whose previous figure is 0 is never highlighted | The request (fix A1) | Changed as asked (section 3). |
| 9 | Section 5: month names in English letters; a Devanagari PDF needs an embedded font | Party names may be in Devanagari | Question 10.1. |

## 3. Part A: three 4b fixes (first, with tests)
1. **changeOf** (lib/reportLayout.ts): when the previous figure is 0 and the current is not:
   - changePct stays null;
   - the row is highlighted when |change| is above highlight_min (the % test cannot apply);
   - the tone follows the direction as before.
2. **Key ratios table** (components/reports/statements.tsx): a header row with the same column labels and period labels as the P&L, available columns only, so each value sits under its name.
3. **PATCH /gl/report-settings:** highlightPct must be 0 to 1,000 and highlightMin 0 to 1,000,000,000. Anything else, a non-number included, returns 400: "The highlight percentage must be between 0 and 1,000." or "The highlight amount must be between 0 and 1,00,00,00,000."

## 4. Where the code lives, and why
- **Server (api-server), new files:**
  - **lib/reportFormat.ts**, pure helpers:
    - lakh grouping (12,34,567.00);
    - negatives in brackets;
    - a dash for zero in statements, 0.00 in books;
    - percentages with one decimal;
    - rounding to the paisa (half away from zero, so 0.005 gives 0.01 and -0.005 gives (0.01));
    - BS date with the AD date beside it;
    - safe file names.
  - **lib/reports/exportDocs.ts:** one adapter per report. It calls the existing report function (dayBook, generalLedger, book, trialBalancePeriod, trialBalance, profitLoss, balanceSheet, compareView, customerStatement, supplierStatement, partySummary) and turns its JSON into one neutral **ReportDoc**:
    ```
    ReportDoc = { title, fileStem, periodText, postedText, warning, orientation,
                  sections: [{ title, columns: [{ key, label, type: text|money|pct|date, width }],
                               rows: [{ cells, style: line|heading|subtotal|total, tone: good|bad|null }],
                               notes: [], ruleText }] }
    ```
  - **lib/reportExport.ts**, the two builders with a shared header and footer:
    - toXlsx(doc, stream): exceljs streaming writer;
    - toPdf(doc): pdfmake, returning a buffer.
  - **routes/reports.ts:** the export route (section 5).
- **Why the server, not the browser:**
  - The request asks for export routes with 403 and "the same server data, never recalculated".
  - Building the files where the data already is means one code path, and the files can be tested in the existing PGlite suite.
  - So the helpers live in api-server, and lhc-cafe needs no test runner.
- **The cost:** the screen keeps its own small formatter (components/reports/common.tsx, Intl en-IN). The two are kept alike by a server test that pins the exact strings (12,34,567.00, (1,250.00), -). If you prefer one formatter, the screen could show server-formatted strings later.
- **New dependencies (api-server only):**
  - **exceljs** (MIT): styles, fills, frozen rows, streaming.
  - **pdfmake** (MIT, built on pdfkit): tables with repeating headers, page headers and footers, "Page x of y", A4 portrait or landscape.
  - Both are added to build.mjs's `external` list, because pdfkit reads its font files from disk at run time and cannot be bundled. deploy.sh already runs `pnpm install`, so the server gets them.
- **Migration:** none needed.

## 5. Routes (GET only, admin and accountant, 403 for everyone else)
```
GET /reports/export/:report?format=xlsx|pdf&<the same query as the screen>
  :report = day-book | ledger (&code=) | book (&code=1100|1200|1210) | trial-balance | profit-loss | balance-sheet
          | compare | customers | suppliers | customer-statement (&id=) | supplier-statement (&id=)
```
- **Same query as the screen:** month, fy, day, from and to, at, compare, the Day Book filters, hideZero, the party filters. The adapter passes them to the same functions.
- **Success:** 200, with Content-Type set for xlsx or pdf, and `Content-Disposition: attachment; filename="LHC_..."`.
- **Errors (JSON):** 400 for a bad period or format, or for the PDF size refusal; 404 for an unknown account or party; 403 for any other role.
- **No writes:** no audit row (the request, rule 11). A test proves no table's row count changes.
- **Rate limiter:** a download is one request.

## 6. The files

### 6.1 Header block (every file)
- Legendary House Cafe & Barista Coffee School
- Sulimha Durbar, Patan · PAN 194139113
- the report name, e.g. "Profit and Loss", or "Statement: Asha"
- the period in BS with the AD dates, e.g. "Poush 2083 (16 Dec 2026 to 14 Jan 2027)"
- "Posted up to 2 Poush 2083 (17 Dec 2026)"
- the unposted-days warning, if any, exactly as on the screen
- "Generated 28 Nov 2026 14:05 (Nepal time) by acct"

### 6.2 Footer
PDF: "Page x of y" on every page, with the report name.

### 6.3 Excel
- **One sheet per report.** The comparison has two sheets: "Profit and Loss" and "Balance Sheet".
- **Cells:**
  - **Money:** real numbers rounded to the paisa, in the format `#,##0.00;(#,##0.00);"-"`. Books use 0.00 for zero instead of the dash.
  - **Percentages:** real percentages (the value / 100, format `0.0%`).
  - **Dates:** text in BS, with the AD date in the next column as a real date.
- **Layout:**
  - headings bold; subtotals bold; totals bold with a top border;
  - the header block above the table, and the table's column-heading row frozen;
  - column widths set per column type.
- **Highlighted changes:** a light green or light red fill. The rule text sits under the table, as on the screen.
- **No formulas.** Every total is the value the server computed and checked (the P&L check against the Trial Balance; the Balance Sheet check). A formula over "Less:" rows would need signs per row, and could round differently from the screen. The values are the ones on the screen.
- **Large files:** the Day Book, General Ledger and books are written in pages of 200 vouchers or 500 lines, using the existing page functions, through exceljs's streaming writer. Each row is committed as it is written, so a full-year Day Book never sits in memory at once. There is no size limit for Excel.

### 6.4 PDF
- A4. Landscape or portrait as in section 2, row 7.
- The header block on page 1. The column headings repeat on every page.
- Highlighted cells keep their green or red fill, with the rule text under the table.
- Statements end with "Prepared by ________ Checked by ________".
- Fonts: the standard Helvetica; question 10.1 covers non-Latin names.

### 6.5 Size limit (PDF only)
- **The count:** vouchers for the Day Book, and lines for the General Ledger, books and statements. The statements and the Trial Balance never come near the limit.
- **Above 3,000 rows drawn** (changed by the 4c-fix of 2026-11-28; see below): 400 "Too many lines for a PDF: use Excel, or narrow the period.", with count and limit in the JSON. The count is checked before anything is built.
- **Rows drawn** (ReportDoc.pdfRows): the Day Book counts every journal line plus a heading and a total per day and the grand total; the ledgers and books count their lines plus the opening, the day rows and the total; the other reports count the rows of their sections.
- **Why rows:** the PDF is laid out on the server's main thread, so its cost follows the rows it draws. A 2,721-row Day Book took about 1.3 seconds in the tests.
- **Excel:** the same data downloads.

### 6.6 Unposted days
The same "Posted up to" line and warning as the screen, at the top of every file.

### 6.7 Frontend
- **One `<DownloadButtons>` component:** Excel and PDF buttons on every tab, and on an open statement.
- **What it does:**
  - builds the export URL from the tab's current period and filters;
  - fetches it with the bearer token and saves the blob under the server's file name;
  - shows "Preparing…" with both buttons disabled while it runs;
  - shows the server's error text if refused, e.g. the 3,000-row message.

### 6.8 File names
`LHC_<Report>_<period>.<ext>`, with safe characters only: A-Z, a-z, 0-9, hyphen and underscore.
- **Report:** DayBook, Ledger-1100, CashBook, BankBook-Nabil, BankBook-HBL, TrialBalance, ProfitLoss, BalanceSheet, Compare, Customers, Suppliers, Statement-<party>.
- **Period, in BS:**
  - a month: 2083-09;
  - a fiscal year: 2083-84;
  - a day: 2083-09-15;
  - a range: 2083-09-01_to_2083-09-20;
  - a Balance Sheet: its date, e.g. 2083-09-30.
- **Party names:**
  - spaces become hyphens; other characters outside the safe set are dropped;
  - "Ram & Sita Traders" gives Ram-Sita-Traders;
  - a name with nothing left (e.g. all Devanagari) gives Customer-12 or Supplier-4.
- **Examples:** LHC_ProfitLoss_2083-09.xlsx, LHC_BalanceSheet_2083-09-30.pdf, LHC_Statement-Asha_2083-09.pdf.

## 7. Build order
1. Part A fixes, with their tests.
2. lib/reportFormat.ts, with its tests.
3. lib/reports/exportDocs.ts (the adapters), then lib/reportExport.ts (xlsx, then pdf), then the route.
4. The DownloadButtons on every tab.
5. Docs: the CHANGELOG, HANDOFF, step4-reports.md section 14, and the roadmap line.

## 8. Tests (api-server suite, PGlite)
- **Part A:**
  - changeOf with previous 0: highlighted above highlight_min, not below; tone by direction; changePct null;
  - report-settings: -1, 1001, "abc" and 1,000,000,001 refused with the messages; 0, 1,000 and 1,000,000,000 accepted;
  - the ratios header is a screen change: checked by typecheck, and by you in the browser.
- **Formatting:**
  - 1234567 gives 12,34,567.00; 9999999.99 gives 99,99,999.99;
  - -1250 gives (1,250.00); 0 gives "-" in statements and 0.00 in books;
  - 0.005 gives 0.01, and -0.005 gives (0.01);
  - percentages to one decimal;
  - BS with AD at a month end and at a fiscal-year end.
- **File names:** a name with spaces; "Ram & Sita"; a Devanagari name (falls back to Customer-<id>); the period forms.
- **Excel:** the P&L and Balance Sheet files are read back with exceljs.
  - Each money cell's value equals the JSON row's number, and its type is numeric.
  - The % cells are numbers (the value / 100); totals are bold; the heading row is frozen.
  - A highlighted row has its fill.
  - The comparison file has two sheets.
- **PDF:**
  - a customer statement renders (with compression off in the test); the bytes start with %PDF and end with %%EOF;
  - the text holds the header block ("Legendary House Cafe & Barista Coffee School", the period, "Posted up to") and "Page 1 of N";
  - the page count matches N.
- **Size (4c-fix):** a Day Book of 1,200 vouchers (3,600 lines) is refused as a PDF with its count and the limit, and downloads as Excel with all 3,600 lines; a Day Book of 2,721 rows builds as a PDF in under 15 seconds (the time is logged). Before the fix: on generated data with more than 5,000 lines, the PDF answered 400 with the exact message; Excel answered 200 and its row count equals the lines.
- **Who and what:**
  - staff and supervisor get 403 on every export route and both formats;
  - no table's row count changes after downloading every report in both formats.
- **Not automated:** opening the files in Excel and a PDF viewer, the look on paper, and the lakh grouping on your PC's region setting (section 11).

## 9. Risks
- **pdfkit fonts and the bundle:** handled by externals. A test renders a PDF from the built code path, and deploy.sh's pnpm install fetches the packages on the server.
- **A full-year PDF of a ledger:** refused above 3,000 rows drawn, so the server never lays out a huge PDF on its main thread.
- **A failed Excel stream (4c-fix):** an error after the download has started cuts the connection (res.destroy), so the browser reports a failed download; an error before any byte is sent answers the usual JSON error.
- **Excel's grouping depends on the PC:** the numbers are right either way. Only the commas move (question 10.2).

## 10. Questions for you (each with my recommendation)
1. **Names in Devanagari in the PDF.** Standard PDF fonts cannot draw Devanagari, and pdfkit cannot join Devanagari conjuncts properly, even with an embedded font.
   - Recommended: Excel shows every name exactly as typed. The PDF uses Helvetica, and a name that cannot be drawn shows as "(name in Excel)" with the customer number.
   - Alternative: embed Noto Sans Devanagari (free, about 200 KB) and accept imperfect conjuncts.
2. **Lakh grouping in Excel.**
   - Recommended: the format above, with the accountant's Windows region set to English (India) (Settings > Time & language > Region > Regional format), so Excel shows 12,34,567.00.
   - Alternative: a fixed lakh format that works on any PC but shows negatives with a minus sign instead of brackets. Excel allows only two conditions per format.
3. **The address line.** Recommended: "Sulimha Durbar, Patan" as you asked; or "Sulimha Durbar, Pimbahal, Nepal" like the printed notes.
4. **Carried-forward totals at the foot of each PDF page for books** (the spec's section 5). Recommended: not now; the column headings repeat, and the totals are on the last page.

## 11. By hand after it is built (you)
- **Server:** nothing beyond deploy.sh, which installs the two new packages; there is no migration.
- **Browser, on each tab:**
  - download Excel and PDF, and open each in Excel and in a PDF viewer;
  - check one P&L line by line against the screen;
  - check that the Excel cells are numbers (they add up with SUM) and that the lakh commas show on your PC.
