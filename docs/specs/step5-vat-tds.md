# Step 5: VAT and TDS (plan, not built)

Written for: the owner and the accountant, to answer section 9 before anything is built, and for whoever builds it.
Status: questions answered by the owner on 2026-11-28 (section 11). Not built yet; the next migration is 020.

## In one paragraph
- **VAT stays off** until LHC is registered, but every document from now on carries what VAT needs: the bill type, the taxable amount, and the supplier's and customer's PAN. On the switch-on date, sales start charging 13% on top, purchases and expenses with a VAT bill put their VAT into Input VAT, and a monthly VAT return (sales book, purchase book and the amount to pay) comes out of the ledger. Nothing already posted is redone.
- **TDS works both ways.** LHC withholds tax when it pays a landlord or a service provider: TDS payable, deposited monthly with a report by payee and PAN. A customer, mainly Sulimha Durbar, may withhold tax when it pays LHC: TDS receivable, an advance-tax asset, kept with the certificate number to set against LHC's income tax at year end.

## 1. What exists today (read on 2026-11-28)
| Topic | Where | Today |
|---|---|---|
| The VAT switch | ledger_settings.vat_enabled (migration 014); PATCH /gl/settings (routes/gl.ts:58); GET /gl/vat-status (routes/gl.ts:236) | Off. Only a flag: no start date, no registration number, no rate. |
| VAT bills refused | routes/orders.ts:411 | While VAT is off, a payment with bill_type 'vat' or a VAT amount above 0 is refused: "VAT bills are stopped until LHC is VAT registered. Print a PAN bill." |
| VAT on a sale | schema orders: vat_amount, bill_type (pan/vat), other_party_name, other_party_pan, non_taxable_amount | The fields exist and are always 0 / 'pan' today. The hotel breakfast and NC bills force VAT 0 (orders.ts:464, 482). |
| Sales posting | lib/postingRules.ts saleEntry | Posts net sales to 4000/4010/4020 and any vat_amount to 2200 Output VAT. A VAT bill while VAT is off is an acknowledge-level problem. |
| Credit notes | lib/receivableRules.ts (vatRate from the invoice); routes/receivables.ts:317 | A credit note takes VAT back at the invoice's own rate. Ready for VAT; nothing to change. |
| Loyalty points | lib/receivableRules.ts loyaltyBasis | Points are on the amount before VAT. Ready. |
| Purchases | schema purchase_bills / purchase_bill_items / debit_notes: vat_amount; lib/purchaseRules.ts:26 ("VAT is part of the cost, not VAT registered"); postingRules purchaseBillEntry | A bill's VAT is recorded but posted into stock cost (1400/1410) with the rest. |
| Suppliers | schema suppliers: pan (required, unique), supplier_type (goods/service) | PAN on every supplier. No "VAT registered" flag. supplier_type will help pick the TDS rate. |
| Expenses | schema expenses: amount, bill_number, vendor | **No VAT amount, no supplier PAN, no TDS.** The whole amount posts to the expense account. |
| Supplier payments | postingRules supplierPaymentEntry | Dr 2100, Cr cash or bank. No TDS. |
| Customer receipts | postingRules receiptEntry | Dr cash, bank or machine, Cr 1300. No TDS. |
| Accounts | migration 013 | 1450 Input VAT, 2200 Output VAT payable and 2250 TDS payable exist, postable, unused. **No account for TDS a customer withheld from LHC**, and none for income tax payable. |
| Reports | lib/reportLayout.ts | The Balance Sheet already shows 1450, 2200 and 2250. The P&L is net of VAT by construction (VAT never reaches 4000/4010). |
| Settings decisions | CLAUDE.md | VAT 13% added on top of menu prices, behind a switch with a start date. TDS: 1% salary, 15% individual service providers with a PAN bill, 1.5% VAT bills from service providers. "Tax rates, thresholds and limits are configurable settings or tables, never hard-coded." CBMS: fields and outbox only, later (roadmap step 9). |

## 2. Nepal rules the design depends on
Official sources found, but their text could not be read by the tools used (the IRD pages load their body in the browser only). So every rate below is from secondary sources and is **UNVERIFIED**. The accountant confirms each one against the IRD page or the Act before any is used. The system takes every rate and threshold from a settings table, so nothing here is hard-coded.

| # | Rule | Where it was found | Status |
|---|---|---|---|
| R1 | VAT rate is 13%. The Finance Act 2083 lets the Government set lower rates by notice (5% on ride-sharing and on electricity above 50 units); 13% stays standard. | [Budget 2083/84 tax changes, lawalpine](https://lawalpine.com/blog/budget-2083-84-tax-changes-in-nepal); [udhamsathi VAT registration 2083/84](https://udhamsathi.com/blog/vat-registration-nepal) (both read 2026-11-28) | UNVERIFIED |
| R2 | VAT registration threshold: NPR 50 lakh a year for goods, **NPR 30 lakh for services or mixed** (unchanged in 2083/84). Some sectors register whatever their turnover. One source lists "restaurant with a bar". Whether a cafe without a bar must register early is not confirmed. | [lawalpine VAT 2082/83](https://lawalpine.com/blog/vat-in-nepal-rates-and-thresholds-2082-83); [udhamsathi](https://udhamsathi.com/blog/vat-registration-nepal); [notarynepal](https://notarynepal.com/blog/vat-rules-in-nepal) | UNVERIFIED |
| R3 | The VAT Act 2052 as amended by the Finance Act 2082 is published by IRD (page dated 18 Poush 2082). | [ird.gov.np, VAT Act as amended](https://ird.gov.np/content/13407/value-added-tax-act--2052--as-amended/) | Source exists; its text was not read |
| R4 | The VAT return is monthly, filed and paid by the 25th of the following Nepali month, with a nil return when nothing was sold. Some small taxpayers file quarterly. | [vishalkoirala tax calendar](https://vishalkoirala.com/nepal-tax-calendar.html); [aadhikari](https://www.aadhikari.com/insights/nepal-tax-compliance-calendar); [udhamsathi deadlines](https://udhamsathi.com/blog/tax-return-filing-companies-nepal) | UNVERIFIED |
| R5 | Input VAT can be claimed only on a VAT invoice in the buyer's name with its PAN, within a time limit (often quoted as one year). | secondary only | UNVERIFIED |
| R6 | A tax invoice shows the seller's name, address and PAN; the buyer's name, address and PAN (when the buyer is registered or above a limit); invoice number and date; the description, quantity and price; the taxable amount, the VAT and the total. An abbreviated invoice is allowed for small retail sales. | [notarynepal](https://notarynepal.com/blog/vat-rules-in-nepal) (secondary); VAT Rules 2053 not read | UNVERIFIED |
| R7 | Service charge: CLAUDE.md says LHC charges none, so its VAT treatment does not arise. | CLAUDE.md | Decided |
| R8 | TDS rates for 2083/84 are published by IRD (page "भुक्तानीमा अग्रीम कर कट्टी दर (आ.व. 2083/84)", dated 25 Shrawan 2083). | [ird.gov.np, TDS rates 2083/84](https://ird.gov.np/content/13611/advance-tax-cut-rate-on-payment-tds/) | Source exists; the rate table was not read |
| R9 | TDS on service fees: **1.5%** when the provider issues a VAT bill, **15%** on a PAN-only bill. | [nexusadvisory TDS 2083/84](https://nexusadvisory.com.np/tds-rates-in-nepal-fy-2083-84/); [companyservicesnepal](https://www.companyservicesnepal.com.np/blogs/tds-in-nepal); [bizsewa](https://bizsewa.com/tax-deducted-source-tds-rates-nepal/); matches CLAUDE.md | UNVERIFIED |
| R10 | TDS on rent: **10%** (sources conflict on rent paid to an individual; some say a local rent tax applies instead, or an exemption under section 88(5)). | [bizsewa](https://bizsewa.com/tax-deducted-source-tds-rates-nepal/); [lawalpine TDS](https://lawalpine.com/blog/tds-in-nepal) | UNVERIFIED (conflicting) |
| R11 | TDS on contracts: **1.5%** above NPR 50,000 (counting other payments to the same person under the same contract within 10 days). | [nexusadvisory](https://nexusadvisory.com.np/tds-rates-in-nepal-fy-2083-84/); [kharchapatra](https://kharchapatra.com/blog/tds-rate-card-nepal) | UNVERIFIED |
| R12 | TDS on salary follows the income tax slabs. From 2083/84 the first slab is 1% up to NPR 10 lakh (per the budget), which matches CLAUDE.md's 1% for LHC's staff. Payroll is step 7. | [nepacalc 2083/84 slabs](https://nepacalc.com/income-tax/nepal-income-tax-slab-2083-84/) | UNVERIFIED |
| R13 | TDS is deposited and the e-TDS return filed monthly, by the 25th of the following Nepali month (or within 25 days of the month end). | [baca deadlines](https://baca.com.np/tools/deadlines); [vishalkoirala](https://vishalkoirala.com/nepal-tax-calendar.html) | UNVERIFIED |
| R14 | Tax withheld from LHC by a customer is recorded by the customer in e-TDS against LHC's PAN. LHC claims it as advance tax in its annual income tax return, using the customer's TDS record or certificate. | [IRD FAQ on advance withholding](https://ird.gov.np/faq/) (title only read); secondary | UNVERIFIED |
| R15 | Whether Sulimha Durbar must withhold TDS on what it pays LHC for breakfasts (a supply of food, which may count as goods, not a service) is not confirmed. | none found | UNVERIFIED: question 9.11 |
| R16 | CBMS (real-time billing sync) applies to some VAT-registered businesses above a turnover. CLAUDE.md keeps it for roadmap step 9. | not researched for this step | Out of scope |

## 3. VAT design
- **Settings** (Chart of Accounts > settings, admin):
  - "VAT registered from" (a date) and the registration number. In Nepal this is the same 9-digit PAN, 194139113; the screen shows it and asks to confirm.
  - The rates come from a small **tax_rates** table: tax, rate, effective from, effective to. VAT 13% is a row, not code.
  - Turning VAT on needs the date, and it can only be today or later (question 9.2).
- **The rule for every document:** VAT applies when its date is on or after the switch-on date. Documents dated before it never get VAT, however late they are entered or corrected. A credit note follows its invoice: a pre-VAT invoice gets a credit note with no VAT.
- **Output VAT on sales:**
  - **The amount:** 13% added on top of the bill after any discount (CLAUDE.md, "added on top of menu prices"), rounded once per bill.
  - **The bill:** every bill becomes a VAT bill (bill_type 'vat').
  - **The prints:** the receipt, the invoice and the guest bill show taxable amount, VAT 13% and total, under the heading "TAX INVOICE" with LHC's PAN.
  - **The buyer:** their name and PAN print when known (other_party_pan, or the customer's PAN, below).
  - **Posting:** saleEntry already credits 2200; only the refusal at payment changes, to "VAT on from <date>".
- **Business customers:** loyalty_customers gets an optional **pan**. Sulimha Durbar's PAN or VAT number then prints on its breakfast invoices, so Sulimha can claim the VAT if it is VAT-registered.
- **Hotel stays:**
  - **Guests' extras:** normal sales, VAT on top.
  - **The included breakfast billed to Sulimha:** Rs 800 per person plus 13% (CLAUDE.md: "VAT added on top once registered"), so Rs 904 a breakfast.
  - **The guest bill (3f):** shows the VAT line per invoice and in the totals.
- **Complimentary (NC):** no sale, so no output VAT. The cost goes to 5200 as now (question 9.6 asks the accountant to confirm there is no deemed-supply VAT).
- **Course fees (roadmap step 6):** VAT on top once registered (CLAUDE.md), with the same rule.
- **Input VAT on purchases:**
  - suppliers get a **VAT registered** flag;
  - a purchase bill keeps its VAT amount and gets a bill type: 'vat' (a VAT bill from a VAT-registered supplier) or 'pan';
  - a VAT bill dated on or after the switch-on date posts its VAT to **1450 Input VAT**, and only the net to stock;
  - before the switch-on date, or on a PAN bill, VAT stays in cost (as today).
- **Input VAT on expenses:** expenses get a bill type (vat/pan), a VAT amount and the supplier's PAN, with the same rule: VAT to 1450, net to the expense account.
  - Petty cash without a bill has no VAT.
  - Bank and card charges: no VAT (CLAUDE.md).
- **Returns:**
  - a customer credit note takes VAT out of 2200 (already built);
  - a supplier debit note takes VAT out of 1450 when its bill's VAT went to 1450, otherwise out of stock cost.
- **The VAT return (Reports > VAT return, one BS month):**
  - **Sales book:** each invoice and credit note with date (BS and AD), number, buyer, buyer PAN, total, non-taxable, taxable and VAT.
  - **Purchase book:** each VAT bill and debit note with date, bill number, supplier, PAN, total, non-taxable, taxable and VAT.
  - **Summary:** output VAT less input VAT is payable, or a credit carried to next month.
  - **Taken from the ledger:** the sales book, the purchase book and the summary are built from the posted journal and its source documents, with a check that 2200 and 1450 for the month equal the books.
  - **Exports and format:** Excel and PDF use the 4c builders, in the layout the accountant gives (question 9.8).
- **Paying the VAT:** a new **tax payment** voucher (TX): Dr 2200, Cr 1450 (the credit used), Cr bank, for a BS month, with IRD's payment reference. It posts on its own day like any document.
- **The lock and the month close:** the VAT return reads posted, locked days only. Closing a BS month adds a check: 2200 and 1450 for the month equal the sales and purchase books. The VAT return of a closed month is final.
- **The reports:** no new account lines. The Balance Sheet already lists 1450 and 2200 (and 2250). The P&L and the Trial Balance do not change shape, because VAT never touches income or expense accounts.

## 4. TDS design, both ways
### 4a. TDS LHC withholds (payable, 2250)
- **TDS types:** a **tds_types** table holds each type with its rate, threshold, Act section and effective dates (rates from the accountant, section 2): rent, service (VAT bill), service (PAN bill), contract above the threshold, and salary (step 7). Nothing is hard-coded.
- **Where it is withheld:**
  - an expense paid directly (rent, a consultant): the type is chosen on the expense;
  - a supplier payment against a service supplier's bill.
  - The type comes from the supplier's supplier_type and VAT flag, and can be changed by the admin or accountant.
  - Goods purchases have no TDS.
- **The entry:** Dr expense (or 2100 for a payment), the gross; Cr cash or bank, the net paid; Cr 2250 TDS payable, the tax.
  - The CV/PV voucher prints the gross, the TDS and the net.
  - 2250 carries the payee on the line, the way 2100 carries the supplier.
- **PAN:** a TDS payment needs the payee's PAN (suppliers already have one). A payee with no PAN is refused for TDS types, except petty cash without a bill (question 9.13).
- **Depositing it:** the tax payment voucher (TX) with kind "TDS deposit": Dr 2250, Cr bank, for a BS month, with the deposit reference (the e-TDS number).
- **Report (Reports > TDS payable, one BS month):** each payee with PAN, the TDS type, gross, rate, TDS and the voucher, and totals by type. It also shows what has been deposited and what is still to deposit. Exports as Excel and PDF.

### 4b. TDS a customer withholds from LHC (receivable, a new 1460)
- **The account:** 1460 "TDS receivable (advance tax)", an asset.
- **The receipt:** a receipt gets an optional "Tax withheld by the customer (TDS)" amount and the customer's certificate or e-TDS reference.
  - The entry: Dr cash, bank or machine, the money received; Dr 1460, the tax; Cr 1300, the money plus the tax, which is what the receipt settles.
  - The receipt's allocation to invoices covers the gross.
- **Report (Reports > TDS receivable):** by customer and BS month, with the invoice, the receipt, the tax and the certificate number, and which ones are still waiting for a certificate.
- **Year end:** the accountant sets 1460 against LHC's income tax with a JV (Dr income tax payable, Cr 1460). That needs an income tax payable account, 2270, added when he asks (question 9.12).
- **Sulimha Durbar:**
  - when Sulimha pays the breakfast invoices it may withhold; the receipt records it;
  - Sulimha's card-collection transfers (settlements) are LHC's own money, not a payment for a service, so they never carry TDS.

## 5. Posting rules
| Document | Debit | Credit | Voucher | When |
|---|---|---|---|---|
| Sale, VAT on (on or after the switch-on date) | cash / bank / machine / 1300, the total | 4000/4010/4020 net; 2200 the VAT | SJ | as now (saleEntry already does it) |
| Customer credit note on a VAT invoice | 4900 net; 2200 the VAT | 1300 | RJ (existing) | as now |
| Purchase bill, VAT bill, on or after the switch-on date | 1400/1410 net; 1450 the VAT | 2100 / cash / bank, the total | PB | change in purchaseBillEntry |
| Purchase bill, PAN bill or before the switch-on date | 1400/1410, the total | 2100 / cash / bank | PB | as now |
| Debit note on a VAT bill | 2100, the total | 1400/1410 net; 1450 the VAT | DJ | change in debitNoteEntry |
| Expense with a VAT bill | expense account net; 1450 the VAT | cash / bank, the total | EX | change in expenseEntry |
| Expense with TDS | expense account, gross | cash / bank, net; 2250 the TDS (payee on the line) | EX | new in expenseEntry |
| Supplier payment with TDS | 2100, gross (supplier on the line) | cash / bank, net; 2250 the TDS | SP | change in supplierPaymentEntry |
| Customer receipt with TDS withheld | cash / bank / machine, the money; 1460 the TDS | 1300, the gross (customer on the line) | RJ | change in receiptEntry |
| VAT payment | 2200 output for the month | 1450 the input used; bank, the payment | TX (new) | new rule |
| TDS deposit | 2250 | bank | TX (new) | new rule |
| Year-end set-off of TDS receivable | 2270 income tax payable (when added) | 1460 | JV | by the accountant |

- **How it fits:** every change is in lib/postingRules.ts and runs through the existing reviewDay/postDay. A document posts on its day; a change after posting is reversed and re-posted at the next revision; a late one is added; locked days and closed months refuse edits.
- **No new posting machinery:** the tax payment voucher is a new source type, `tax_payment`, with a drill-down link (section 3 of the step 4 plan, and the test that every source type has one).

## 6. Screens (only what is needed)
- **Settings** (Chart of Accounts > Settings):
  - VAT registered from (date) and the VAT number;
  - the tax rates (VAT 13%) and the TDS types and rates, edited by the admin or accountant, each with an effective date.
- **Suppliers:** a "VAT registered" tick, and the default TDS type for a service supplier.
- **Purchases:** the bill type (VAT bill / PAN bill). After the switch-on date, a VAT bill shows "Input VAT Rs X (claimable)".
- **Expenses:** bill type, VAT amount and the supplier's PAN; a TDS type, which computes the TDS and the net to pay. The CV prints all three.
- **Supplier payments:** a TDS line for service suppliers (gross, TDS, net).
- **POS, payment and receipts:**
  - while VAT is off, nothing changes;
  - from the switch-on date, the totals show taxable, VAT 13% and the total; the printed bill is a "TAX INVOICE" with LHC's PAN, and the buyer's name and PAN when given.
- **Receivables:**
  - Record receipt gets "Tax withheld by the customer (TDS)" and the certificate number;
  - customers get an optional PAN (Sulimha Durbar's prints on its invoices).
- **Stays:** the guest bill shows VAT per invoice and in the totals.
- **Reports:**
  - VAT return (sales book, purchase book, summary), TDS payable, TDS receivable;
  - each with Excel and PDF (4c builders) and the "Posted up to" line.
- **Chart of Accounts:** the new Tax payment voucher (VAT payment or TDS deposit) for the admin and accountant.

## 7. Migration 020 outline (idempotent; run by the owner after a backup, before deploy.sh)
- **ledger_settings:** + vat_start_date (date), vat_number (text). vat_enabled stays and means "on from vat_start_date".
- **tax_rates (new):** tax ('vat'), rate, effective_from, effective_to, set_by. It seeds VAT 13% with no effective date until the owner sets one.
- **tds_types (new):** code, label, rate, threshold, act_section, payee_kind, effective_from, effective_to, active. It seeds the rows of section 2 as inactive drafts until the accountant confirms them.
- **suppliers:** + vat_registered boolean default false, default_tds_type.
- **purchase_bills:** + bill_type ('pan' default). Existing rows stay 'pan'.
- **expenses:** + bill_type, vat_amount (default 0), supplier_pan, tds_type, tds_rate, tds_amount (default 0).
- **supplier_payments:** + tds_type, tds_rate, tds_amount (default 0).
- **customer_receipts:** + tds_amount (default 0), tds_reference.
- **loyalty_customers:** + pan (optional).
- **tax_payments (new):** kind ('vat_payment' / 'tds_deposit'), bs_year, bs_month, amounts, bank_account, reference, payment_date, status, void fields, created_by.
- **accounts:** seed 1460 "TDS receivable (advance tax)" (asset, postable). 2270 "Income tax payable" is seeded inactive until the accountant asks.
- **No change** to any posted row; the defaults keep today's behaviour exactly.

**Risks**
1. **The rates are UNVERIFIED** (section 2). Mitigation: every rate is a table row, the TDS rows start inactive, and nothing applies until the accountant confirms them.
2. **Switching on mid-month:** that month's VAT return covers only the days from the switch-on date. Mitigation: the rule is per document date, and the return shows the date it starts.
3. **Prices to customers** rise by 13% when VAT is added on top. This is the owner's decision; the menu and the receipt must say "VAT 13% extra" from the switch-on date.
4. **Rounding:** VAT is computed once per bill, not per line, so a bill's VAT always equals the 13% of its taxable total; credit notes keep the invoice's rate.
5. **CBMS:** registration may bring a real-time billing requirement. Out of scope here (roadmap step 9); flagged.
6. **Wrong TDS on a payment:** a wrong TDS is fixed by the usual void and re-enter. The posted entry reverses and re-posts.

## 8. Tests
- **Settings:** VAT cannot be switched on without a date; the date cannot be in the past (question 9.2); the rate comes from tax_rates on the document's date.
- **While VAT is off:** every existing test passes unchanged; a VAT bill is refused as now; new fields default to 0 and 'pan', and posting is identical (the Day Book of the 3c worked days is byte-for-byte the same).
- **Switched on in a test:**
  - a sale on the switch-on date carries VAT on top (Rs 1,000 to Rs 130 VAT, Rs 1,130 total), posts 2200, and its loyalty points are on Rs 1,000;
  - a sale the day before carries none;
  - a credit note on each follows its invoice;
  - the breakfast to Sulimha is Rs 904 a person, with Sulimha's PAN on the invoice.
- **Input VAT:**
  - a VAT bill after the switch-on date puts its VAT in 1450 and the net in stock;
  - a PAN bill, and a VAT bill dated before, put everything in stock;
  - a debit note reverses the same way;
  - an expense with a VAT bill the same.
- **TDS payable:**
  - rent of Rs 50,000 at 10% posts Dr rent 50,000, Cr bank 45,000, Cr 2250 5,000;
  - a service payment on a PAN bill uses the PAN-bill rate, and on a VAT bill the VAT-bill rate;
  - no PAN is refused;
  - the deposit voucher clears 2250;
  - the monthly report lists the payee with PAN, and the totals equal 2250's movement.
- **TDS receivable:**
  - Sulimha pays Rs 9,040 for breakfasts and withholds Rs 135.60: Dr bank 8,904.40, Dr 1460 135.60, Cr 1300 9,040; the invoice is fully settled, and the register shows the certificate number.
- **VAT return:**
  - the sales and purchase books for a month equal 2200 and 1450 for the month;
  - the summary gives payable or a credit carried forward;
  - the VAT payment clears it;
  - the month close refuses while the books and the ledger disagree, without a note.
- **The reports still agree with VAT on:**
  - the Trial Balance balances;
  - the 4b P&L net profit equals the Trial Balance's income less expenses (VAT never in it);
  - the Balance Sheet balances, with 1450, 2200, 2250 and 1460;
  - the customer statements equal the Receivables screen, TDS receipts included.
- **Revisions:** voiding an expense with TDS reverses its entry; a corrected TDS re-posts at the next revision; a tax payment dated in a locked day is refused.
- **Who and what:** the VAT and TDS reports are admin and accountant only (403 otherwise) and read-only; the tax payment is admin and accountant only.
- **Migration 020:** runs twice; every existing row keeps today's values.

## 9. Questions for the owner and the accountant (each with a recommended answer)
1. **The rates and thresholds in section 2.** Recommended: the accountant checks each row (R1, R2, R4 to R6, R9 to R14) against IRD and enters the confirmed rates in the TDS types and tax rates tables. Nothing applies until he does.
2. **The switch-on date.** Recommended: only today or a future date, never a past one, so no posted day changes. If IRD registers LHC with an earlier effective date, the accountant posts the difference by JV.
3. **Prices.** Recommended: as decided, 13% on top of menu prices (exclusive), shown as "VAT 13%" on the bill and noted on the menu from the switch-on date. Alternative: raise menu prices so the total stays the same (VAT included); not recommended, because every price would change.
4. **Rounding.** Recommended: VAT computed once per bill on the taxable total, rounded to the paisa.
5. **Abbreviated invoices.** Recommended: every bill is a full tax invoice (LHC prints few enough bills), with the buyer's name and PAN only when the customer gives them.
6. **Complimentary (NC).** Recommended: no output VAT (it is not a sale). The accountant confirms there is no deemed-supply VAT.
7. **The hotel breakfast.** Recommended: Rs 800 + 13% = Rs 904 a person to Sulimha, with Sulimha's PAN on each invoice. The guest's extras carry VAT like any sale.
8. **The VAT return format.** Recommended: the accountant gives IRD's sales book and purchase book columns (or a sample), and the report follows them. Until then, the columns in section 3.
9. **Input VAT on purchases before the switch-on date.** Recommended: none claimed (it stays in cost), as the law allows input credit only once registered. The accountant confirms.
10. **Who records TDS.** Recommended: the admin and accountant only, on expenses and supplier payments. Cashiers paying petty cash never withhold TDS.
11. **Does Sulimha Durbar withhold TDS on breakfast payments?** Recommended: ask Sulimha's accountant. If yes, record it on the receipt with their certificate number; the system supports it either way.
12. **Income tax payable (2270).** Recommended: add it, inactive until the year-end set-off of 1460, when the accountant activates it.
13. **A payee without a PAN.** Recommended: no TDS-type payment without a PAN (refused), except petty cash without a bill, which is never a TDS payment. The accountant says if IRD requires a different treatment (some payments to persons without PAN carry a higher rate).
14. **Rent paid to an individual landlord.** Recommended: the accountant confirms whether TDS (10%) or the local rent tax applies (R10 conflicts). The rent TDS type stays inactive until he decides.
15. **The VAT and TDS deposit deadline.** Recommended: the Reports page shows "due by the 25th of <next BS month>" as a reminder only; filing stays on IRD's portal.
16. **CBMS.** Recommended: out of this step. Before registration, the owner asks IRD whether real-time billing (CBMS) applies to LHC at its turnover; if it does, roadmap step 9 comes before VAT is switched on.

## 10. Build parts, in order
- **5a, settings and VAT-ready data:**
  - migration 020; the tax rates and TDS types tables;
  - bill type, VAT and PAN fields on suppliers, purchase bills, expenses and customers;
  - receipts' TDS fields;
  - no behaviour change while VAT is off.
- **5b, TDS payable:** TDS on expenses and supplier payments, the vouchers, the TDS deposit, the TDS payable report (useful now, before VAT).
- **5c, TDS receivable:** TDS on customer receipts with the certificate, account 1460, the register (Sulimha).
- **5d, input VAT:** purchase bills, debit notes and expenses with a VAT bill post 1450 from the switch-on date.
- **5e, output VAT:** the switch-on rule at the payment step, the tax invoice prints (receipt, invoice, guest bill), the breakfast at 800 + VAT, and Sulimha's PAN.
- **5f, VAT return and payment:** the sales and purchase books, the summary, the tax payment voucher, the month-close check, and the exports.

## 11. The owner's answers (2026-11-28)
1. **Rates:** the researched rates of section 2 go in as the starting values, editable by the admin and accountant, so the confirmed rates can be entered later. They are seeded active:
   - VAT 13%;
   - TDS on a service with a VAT bill 1.5%, with a PAN bill 15%;
   - TDS on a contract 1.5% above NPR 50,000;
   - TDS on salary 1% (step 7).

   Rent (10%) is seeded inactive (answer 14).
2. **The switch-on date:** today or a future date only; an earlier effective date is corrected by JV.
3. **Prices:** VAT 13% on top of menu prices, shown as "VAT 13%" on the bill and noted on the menu from the switch-on date.
4. **Rounding:** VAT once per bill, rounded to the paisa.
5. **Invoices:** every bill is a full tax invoice; the buyer's name and PAN print when given.
6. **Complimentary (NC):** confirmed: no deemed-supply VAT; no output VAT on NC.
7. **Breakfast:** Rs 800 + 13% = Rs 904 a person to Sulimha, with Sulimha's PAN on each invoice; extras carry VAT like any sale.
8. **The VAT return:** the accountant gives IRD's sales and purchase book columns; until then, the columns of section 3.
9. **Input VAT:** none claimed before the switch-on date (it stays in cost).
10. **Who records TDS:** the admin and accountant only.
11. **Sulimha Durbar:** confirmed: it **does** withhold TDS on its payments to LHC. Its receipts record the TDS and the certificate number (part 5c).
12. **Account 2270 Income tax payable:** added inactive, for the year-end set-off of 1460.
13. **Payees without a PAN:** no TDS-type payment without one; petty cash without a bill is never a TDS payment.
14. **Rent to an individual landlord:** the rent TDS type stays inactive until the accountant decides between TDS and the local rent tax.
15. **Deadlines:** the reports show "due by the 25th of <next BS month>" as a reminder only.
16. **CBMS:** last on the roadmap; the owner says when LHC applies to IRD.

## 12. Part 5a as built (2026-11-28; see docs/CHANGELOG.md)
- **Migration 020:**
  - ledger_settings.vat_start_date and vat_number;
  - tax_rates (VAT 13%) and tds_types (service_vat 1.5, service_pan 15, contract 1.5 above 50,000, salary 1, rent 10 inactive), all editable;
  - suppliers.vat_registered and default_tds_type; purchase_bills.bill_type;
  - expenses: bill_type, vat_amount, supplier_pan, tds_type, tds_rate, tds_amount;
  - supplier_payments: tds_type, tds_rate, tds_amount; customer_receipts: tds_amount, tds_reference;
  - loyalty_customers.pan; tax_payments;
  - accounts 1460 (active) and 2270 (inactive).
- **A latent bug, fixed:** ledger_settings.vat_enabled (migration 014) was not in the Drizzle schema, so ledgerSettings() never read it, and the admin's switch could not be saved. It is in the schema now. VAT was meant to be off, so nothing was affected.
- **VAT cannot be switched on yet:** PATCH /gl/settings refuses vatEnabled = true until output VAT (5e) is built. The date (today or later) and the VAT number (9 digits) can be set now.
- **Editing the rates:** /gl/tax-rates and /gl/tds-types (GET, POST, PATCH) for the admin and accountant, on Chart of Accounts > Taxes.
- **The new fields:**
  - suppliers (VAT registered, TDS when paid);
  - purchase bills (the type follows the VAT; a contradiction is refused);
  - expenses (bill type, VAT inside the amount, the supplier's PAN; changes logged);
  - customers' PAN (PATCH /receivables/customers/:id/pan; Receivables > customer > PAN).
- **Unchanged:** posting is the same. The VAT on bills and expenses stays in cost until 5d; TDS fields are unused until 5b and 5c.

## 13. Part 5b as built (2026-11-28; see docs/CHANGELOG.md)
- **Migration 021:**
  - ledger_settings.tds_base ('excl_vat' default, or 'incl_vat');
  - confirmed_by and confirmed_at on tax_rates and tds_types;
  - indexes for the TDS lines and the month's deposits.
- **The TDS base (to confirm with the accountant):**
  - excl_vat: TDS = rate x (amount - VAT) on a VAT bill, rate x amount otherwise;
  - incl_vat: rate x the whole amount;
  - rounded to the paisa, half away from zero (lib/tds.ts computeTds).
- **The 10-day contract total:** for a type with a threshold, it sums the active expenses and supplier payments with the same PAN and the same type dated from 10 days before up to the payment's date. A supplier payment's PAN is the supplier's. An edited expense leaves itself out. The type applies when that total plus this payment is above the threshold.
  - The figure is returned as tdsAggregate and shown on saving.
  - Earlier payments that were below the threshold are not taxed afterwards.
- **Supplier payments:**
  - service suppliers only, never from the drawer;
  - the base leaves out the VAT share of the VAT bills allocated (pro rata); an unallocated advance counts in full;
  - the payment's amount stays the gross that settles the bills.
- **Ledger:**
  - an expense: Dr its account gross, Cr cash or bank net, Cr 2250 TDS with the supplier found by the PAN;
  - a supplier payment: Dr 2100 gross, Cr bank net, Cr 2250 TDS, the supplier on both;
  - a deposit (TX, source tax_payment): Dr 2250, Cr bank.
  - lib/glRules.ts allows a supplier on 2250 and a customer on 1460.
- **Confirmation:** a change of rate, threshold or dates clears it. Unconfirmed documents warn but are allowed.
- **Report:** the check compares the TDS of the documents of the posted days with the 2250 credits less debits of the month, leaving out tax payments.

- **Two known limits of 5b (for the accountant to confirm):**
  1. Contract TDS applies only to the current payment, when the same PAN's 10-day total crosses the threshold. There is no catch-up on the earlier payments.
  2. A debit note on a bill whose payment carried TDS does not adjust the TDS. The accountant corrects it with a JV.
- **A deposit cannot be more than is still to deposit (5c-A):** POST /tax-payments refuses an amount above what was withheld less what was deposited for that BS month: "That is more than the TDS still to deposit (Rs X). Record a fine or interest as an expense."

## 14. Part 5c as built (2026-11-28; see docs/CHANGELOG.md)
- **Migration 022:** customer_receipts.tds_reference_by and tds_reference_at (who entered the certificate, and when). It also adds an index for the register. tds_amount and tds_reference came with 020.
- **What a receipt means:**
  - customer_receipts.amount is the money received, and tds_amount is extra;
  - the receipt settles amount + tds_amount;
  - allocations to invoices cover that total, and "unallocated" is that total less the allocations.
- **Rules:**
  - TDS is 0 or more, and no more than the part of the receipt allocated to invoices (a certificate is for invoices paid, never for an advance);
  - only on cash or bank receipts, never card or QR (machine money, LHC's own through the settlement);
  - only the admin and accountant enter it; supervisors and the head barista still record plain receipts;
  - the amount is never edited: void the receipt and enter it again.
- **The certificate:** PATCH /receivables/receipts/:id/tds-reference (admin and accountant) records who and when. It changes no posting, so a posted or locked day does not stop it. Without a reference, the receipt is "waiting for certificate".
- **Posting:** Dr cash, bank or machine with the money; Dr 1460 with the TDS (customer on the line); Cr 1300 with money + TDS (customer on the line). A void reverses it. New problem codes: receipt_tds (below zero) and receipt_tds_mode (TDS on a card or QR receipt).
- **Points:** they follow the allocations, so the TDS part counts as paid. Hotel guests and members follow the normal rule; Sulimha never earns.
- **Every place that sums receipts:**
  - **using money + TDS:**
    - customerBalances (Receivables, the POS credit warning, opening balances, conversion);
    - receivablesAsOf (the day and month-end Receivables checks, the 4b statement agreement);
    - receiptsWithAllocations (unallocated);
    - the customer ledger; the allocation limits; receiptEntry;
    - the 4b statement (from the 1300 lines; its label reads "Receipt (TDS withheld Rs X)");
    - the drill-down.
  - **using money only, on purpose:** receiptsBetween and what uses it (the cash drawer, Collections and payment-mode ledgers, Settlements, the daily sales and cash checks).
- **Report:** Reports > TDS receivable, for one BS month:
  - by customer: date, receipt, invoices settled, money, TDS, the certificate or "waiting for certificate", and a running total;
  - totals;
  - a check that the month's 1460 movement from receipts equals the register for the posted days;
  - the year-end note "At year end the accountant sets 1460 against income tax with a JV (2270 when active)". The JV itself is not built.
  - Excel and PDF.
- **The customer page** in Receivables shows the TDS withheld this fiscal year and how many certificates are missing.
- **The hint:** on Record receipt, "<rate>% of the taxable amount would be Rs X" uses the service_vat TDS type's rate on the invoices allocated. It is never filled in. Shortcut: the taxable amount is the allocated total, which equals the amount before VAT while VAT is off; it must leave out VAT once 5e switches VAT on.
- **The Sulimha example** (TDS base excl_vat, VAT off): 10 breakfasts x Rs 800 = Rs 8,000; 1.5% = Rs 120; paid Rs 7,880. The entry is Dr 1200 7,880, Dr 1460 120, Cr 1300 8,000, and both invoices are fully settled.

## 15. Part 5d as built: input VAT (2026-11-28; see docs/CHANGELOG.md)
- **One helper:** vatActiveOn(day) in lib/taxes.ts: vat_enabled, vat_start_date set, and the day on or after it. claimsInputVat adds "a VAT bill with VAT above 0". 5e and 5f use the same helper.
- **The flag is frozen (migration 023):** purchase_bills.input_vat_claimed and expenses.input_vat_claimed, default false (existing rows stay false). Posting reads only the stored flag, so moving the VAT date later never changes a document.
  - **Purchase bills:** set when the bill is made. A bill is never edited (void and re-enter). Opening bills are always false.
  - **Expenses:** set when made, and recomputed only when the date, the bill type or the VAT changes (logged as an "input VAT" change). An edit after posting goes through the usual reverse and repost at the next revision, with the recomputed flag. An expense moved across the switch-on date therefore follows its new date. Any other edit keeps the flag.
  - **Debit notes** follow their bill's flag.
- **The supplier tick:** a VAT bill that would claim needs the supplier ticked VAT registered ("Tick VAT registered on the supplier first"). Before the switch-on date the tick is not needed, as before, because the VAT stays in cost.
- **A claimed purchase bill:**
  - each line's stock cost is the amount before VAT: the cost per unit (average or last), the last purchase price, the landed unit cost in the price history, and the bill's own cost record on Expenses;
  - posting: Dr 1400/1410 net, Dr 1450 VAT, Cr 2100, cash or bank with the total;
  - the stock check (stock x cost per unit against 1400/1410) agrees, because both exclude the VAT.
- **A debit note on a claimed bill:** Dr 2100 with the total, Cr 1400/1410 with the net, Cr 1450 with the returned VAT (proportional). Its negative cost record is net. On an unclaimed bill, as before.
- **A claimed expense:** Dr expense net (amount less VAT), Dr 1450 VAT, Cr cash or bank with the amount less TDS, Cr 2250 TDS. The TDS base is the 5b setting. Petty cash from the drawer with no bill number cannot have VAT.
- **Fix problems at posting:**
  - input_vat: claimed, but not a VAT bill with VAT (or the VAT is not below the amount);
  - input_vat_supplier: a claimed bill whose supplier is no longer ticked VAT registered.
- **Screens:** the purchase bill, the expense list and the drill-down say "Input VAT Rs X (claimable)" or "VAT stays in cost".

## 16. The default TDS rate customers withhold (2026-11-28; migration 024)
- **The setting:** ledger_settings.tds_receivable_rate (default 15.00, from 0 to 100), with confirmed_by and confirmed_at (empty = UNVERIFIED).
  - It is on Chart of Accounts > Taxes, for the admin and accountant only.
  - Editing it to a different rate clears the confirmation.
- **Record receipt:** a "TDS withheld by the customer" tick pre-fills rate x the taxable amount of the invoices being settled. That is the whole amount while VAT is off, and the amount before VAT once an invoice carries VAT.
  - It follows the invoices until the user types over it.
  - It shows "Default X% - change in Settings".
  - A soft warning appears when the figure is above the default rate and more than Rs 1,000 above the pre-fill.
  - Only the amount typed is stored; posting is unchanged. This replaces the 5c hint line, which used the service_vat rate.

## 17. Part 5e plan: output VAT on sales (approved as recommended 2026-11-28; built, see 17.11)
Migration 025. Nothing changes until the admin switches VAT on; every existing figure and test stays as it is.

### 17.1 What exists today (read 2026-11-28)
- **Who works out VAT:** the payment step sends vatAmount, billType and finalTotal from the screen. PATCH /orders/:id/payment refuses any VAT while vat_enabled is off ("VAT bills are stopped").
- **Invoice numbers:** one series per fiscal year (2083/84-00001), taken inside the payment transaction from the invoice_sequences counter row. A failed payment rolls the counter back, so the series has no gaps. NC bills also take a number when they are made.
- **Posting:** saleEntry already posts total = net + VAT (Cr 4000/4010/4020 net, Cr 2200 VAT, Dr money or 1300 the total, Dr 4950 discounts).
- **Credit notes:** they take the invoice's own VAT ratio (vatAmount / netPreVat), so a credit note already follows its invoice.

### 17.2 Prices and the VAT base
- **Menu prices are VAT-exclusive.** VAT is added on top, once per invoice: VAT = round2(taxable x rate / 100), half away from zero, to the paisa. Total = taxable + VAT.
- **The rate:** the tax_rates VAT row in force on the invoice day (13%).
- **Taxable** = item subtotals less every discount on the bill (the POS discount, the staff %, the loyalty reward item). There is no service charge (accountant's decision) and nothing is non-taxable today (nonTaxableAmount stays 0).
- **The server works out the VAT, never the screen.** The payment step shows the server's figures (a preview call), and the parts paid must add up to the total including VAT.
- **NC (complimentary):** no VAT (no deemed supply, owner's answer 6), and no tax invoice.
- **Breakfast to Sulimha Durbar:** Rs 800 x breakfasts is taxable, so Rs 800 + 13% = Rs 904 a person.
- **Loyalty points:** they stay on the amount before VAT (loyaltyBasis already takes the VAT off).

### 17.3 Switch-on rule and the frozen figures
- **When VAT is charged:** only when vatActiveOn(invoice day) is true, where the invoice day is the payment day (or the backdated day of a backdated bill).
- **What is frozen at payment:** orders.vat_amount, vat_rate, taxable_amount and tax_invoice_no, all stored when the order is paid. They are never recomputed from the settings.
- **What stays as it is:** unpaid orders and orders paid earlier.
- **A paid order is never edited** (already the rule). Corrections are credit notes, which follow their invoice's frozen VAT. So an order paid before the switch-on date and corrected after it carries no VAT on either side.
- **A room-stay folio:** each extra is its own invoice, frozen on the day it is charged to the room (its payment as credit). The check-out payment is a receipt, which carries no VAT.
- **A credit sale to Sulimha:** VAT on the invoice day. The receipt later carries none, and its TDS works as in 5c.
- **Wrong customer (reissue):** the new invoice copies the original's frozen VAT, never a new rate. Because the reissue gets a new tax invoice number, the original stays in the list as cancelled.
- **Refunds and voids:** a refund is a credit note (Dr 4900 net, Dr 2200 VAT, Cr 1300 total). Cancelling an invoice is a full credit note. Cash refunds are not modelled (accountant: avoid them).

### 17.4 Posting (saleEntry, unchanged in shape; the figures come from the frozen order)
- **Split payment** (latte 2 x 250 and sandwich 400 = 900, staff 10% off = 90; taxable 810, VAT 105.30, total 915.30; cash 500 + LHC Nabil POS 415.30):
  - Dr 1100 500.00, Dr 1250 415.30, Dr 4950 90.00;
  - Cr 4010 500.00, Cr 4000 400.00, Cr 2200 105.30.
- **Credit sale to Sulimha** (10 breakfasts): Dr 1300 9,040 (Sulimha), Cr 4020 8,000, Cr 2200 1,040.
- **A credit note on half of it:** Dr 4900 4,000, Dr 2200 520, Cr 1300 4,520.
- **Late changes:** the usual reverse and repost. The "VAT bill while VAT is off" acknowledgement becomes a fix problem when an order's frozen VAT does not match its own rate and taxable amount.

### 17.5 Tax invoices
- **What the print shows** (receipt, invoice, guest bill and folio), from the switch-on date:
  - the heading "TAX INVOICE";
  - Legendary House Cafe & Barista Coffee School, Sulimha Durbar, Patan, PAN/VAT 194139113;
  - the tax invoice number and the date in BS and AD;
  - the buyer's name and PAN when known (Sulimha Durbar's PAN on its invoices; a walk-in buyer's name and PAN when typed at the payment step);
  - each item with its net amount, then the taxable amount, VAT 13% and the total.
- **Numbering:** see question 1. The number is taken inside the payment transaction, from a counter row like today's, so a failed payment leaves no gap.
- **Cancelling keeps the number:** a cancelled or credited invoice keeps its number and stays in the list, marked cancelled (or credited, with the note number).
- **The list:** Reports > Tax invoices (one BS month) lists every number in order, with the gap check (first, last, count, missing numbers). The VAT return itself is 5f.

### 17.6 Switching VAT on (and off)
- **PATCH /gl/settings with vatEnabled = true** is accepted only from the admin, and only when all of these hold:
  1. the VAT number (9 digits) is set;
  2. the VAT start date is set and is today or later;
  3. a VAT rate is in force on the start date (13%), confirmed by the accountant (question 2);
  4. the admin types the warning words exactly ("SWITCH ON VAT").
- **What the screen shows:** the checklist with a tick or a cross for each, what changes from the start date (prices + 13% on every bill, tax invoices, input VAT on VAT bills from 5d), and the typed box.
- **Switching off** (admin, typed "SWITCH OFF VAT"): only documents paid after it carry no VAT. Everything already paid keeps its frozen VAT and tax invoice number. Switching on again needs a start date of today or later.

### 17.7 Reports
- **Balance Sheet:** 2200 is already a line.
- **P&L:** it uses the net sales (4000/4010/4020 are credited before VAT).
- **Statements:** the receivables statements and Receivables use the total (1300 is debited with the total).
- **Collections:** the cash drawer, Collections and Settlements already count the money, VAT included.
- **The posting day's "Sales before VAT" check** already compares the net.

### 17.8 Migration 025 (idempotent)
- orders: + vat_rate numeric(5,2), taxable_amount numeric(12,2), tax_invoice_no text (unique when set), tax_invoice_at timestamptz.
- The tax invoice counter uses invoice_sequences with its own key per fiscal year (no new table).
- Existing rows stay empty.

### 17.9 Tests
- **A sale after the switch-on date:** breakfast 800 becomes 904, with the entry and the frozen figures. **The same sale dated before:** no VAT, no tax invoice number.
- **The split payment and the credit sale to Sulimha,** with the exact lines in 17.4.
- **A void (cancel) and a refund (credit note)** reverse the VAT by the invoice's own figures.
- **Changing vat_start_date** (or switching VAT off) after payment changes nothing paid.
- **Tax invoice numbers** are gap-free and unique under concurrent payments, and a failed payment leaves no gap. A cancelled invoice stays in the list.
- **Switching on** is refused for each missing check and accepted when all pass. Staff, supervisor and accountant get 403 on switching.
- **The server's VAT** ignores the screen's figures; NC and Rs 0 bills follow question 3.
- **Statements:** the Trial Balance, P&L and Balance Sheet agree, and the customer statements equal Receivables.
- **Every existing test passes unchanged while VAT is off.**

### 17.10 Questions (recommended answers first)
1. **Tax invoice number:** (a, recommended) a separate tax invoice series from the switch-on date, per fiscal year (e.g. TI-2083/84-00001), printed as the invoice number; the internal invoice_number stays. (b) The existing series continues and becomes the tax invoice number.
2. **Must the VAT rate be confirmed by the accountant before switching on?** Recommended: yes.
3. **A Rs 0 bill** (100% discount or a full loyalty reward) after the switch-on date: recommended, a tax invoice with Rs 0 VAT, so every sale is in the series. NC never gets one.
4. **The buyer's PAN on walk-in bills:** recommended, optional at the payment step (name and PAN print when typed), as decided in section 11.

### 17.11 As built (2026-11-28)
- **The owner's answers:** approved as recommended. A separate tax invoice series TI-<FY>-00001; the rate must be confirmed by the accountant before switching on; a Rs 0 bill gets a tax invoice with Rs 0 VAT; the walk-in buyer's PAN is optional.
- **lib/salesVat.ts:**
  - saleVat(taxable, rate): once per invoice, to the paisa, half away from zero;
  - saleVatOn(day): vatActiveOn plus the rate in force; a missing rate refuses the payment;
  - nextTaxInvoiceNumber: the counter row 'TI <FY>' in invoice_sequences, inside the payment's transaction.
- **The invoice day is the payment day.** Posting already dates a sale on its payment, and a backdated bill is posted on the day it is paid, so its VAT follows that same day. This narrows 17.3, which said "or the backdated day".
- **The payment** (PATCH /orders/:id/payment):
  - while VAT is in force the server ignores the screen's billType, vatAmount, finalTotal and non-taxable amount;
  - it takes the order's own total after discounts as the taxable amount and adds the VAT;
  - it stores vat_amount, vat_rate, taxable_amount, tax_invoice_no and tax_invoice_at;
  - the parts paid must add up to the total including VAT.
  - Room charges (an extra, or the breakfast to Sulimha) follow the same rule. NC carries none.
- **Before the switch-on date:** a VAT bill is refused as before. While VAT is on but before its start date, the message is "VAT starts on <date>".
- **GET /orders/:id/vat-preview:** whether VAT is in force today, and the rate. The payment dialog and the POS use it.
- **Wrong customer:** the new invoice copies the frozen VAT and takes a new tax invoice number. The original stays in the list, cancelled.
- **Posting:** saleEntry gets the frozen rate and taxable amount. A mismatch is the fix problem sale_vat. The entry's reference is the tax invoice number when there is one.
- **Switching on** (PATCH /gl/settings vatEnabled true): admin only. It needs the VAT number, a start date today or later, a VAT rate in force on it confirmed by the accountant, and confirmText "SWITCH ON VAT". The refusal starts "VAT cannot be switched on yet:" and lists what is missing.
  - Switching off needs "SWITCH OFF VAT".
  - While VAT is on, the start date cannot be cleared.
  - GET /gl/settings returns vatChecklist.
- **Reports > Tax invoices** (GET /reports/tax-invoices?month=): the month's tax invoices in number order, with the buyer and PAN, taxable, VAT, total, the state (issued, credited, cancelled), and the gap check over the fiscal-year series.
- **Prints:** after payment the dialog offers to print the tax invoice (lib/taxInvoice.ts), and the Order Log reprints a tax invoice as "TAX INVOICE (COPY)". The QR menu cart and the POS total say "+ VAT 13% extra" once VAT is in force.
- **Not built in 5e** (small follow-ups if wanted):
  - an Excel or PDF of the tax invoice list;
  - the tax invoice number on the credit note print;
  - VAT lines on the guest extras bill (each extra reprints as its own tax invoice from the Order Log).

## 18. Part 5f plan: the VAT return and the VAT payment (approved as recommended 2026-11-28; built, see 18.8)
Migration 026 (one index only). CBMS is not built.

### 18.1 What exists (read 2026-11-28)
- **tax_payments (020):** it already has kind 'vat_payment', vat_output, vat_input, amount (0 or more), the bank, a reference, and void.
  - The TX voucher, the TDS deposit and the void route (routes/taxes.ts) exist from 5b.
  - taxPaymentEntry posts only tds_deposit today, and refuses vat_payment ("posted from step 5f").
- **The documents carry frozen VAT:**
  - sales: orders.vat_amount, taxable_amount, tax_invoice_no and tax_invoice_at (5e);
  - credit notes: vat_amount, taken from their invoice;
  - purchases: purchase bills and expenses with input_vat_claimed (5d); debit notes follow their bill.
- **The ledger:** sales credit 2200 and credit notes debit it; claimed bills and expenses debit 1450 and debit notes credit it.

### 18.2 The VAT return for one BS month (Reports > VAT return; admin and accountant; GET only)
- **Sales book:** every tax invoice whose tax invoice date is in the month (the 5e list), with number, date (BS and AD), buyer, PAN, taxable, VAT and total.
  - **Credit notes** dated in the month on a tax invoice: negative lines, "CN-... on TI-...".
  - **A cancelled invoice:** if it was cancelled in the same month, it shows with nil amounts (the cancel note is not listed separately). If it was cancelled in a later month, it shows in full in its own month and the cancel note is a negative line in the later month. See question 3.
  - **A Wrong-customer move:** see question 2.
- **Purchase book:** every purchase bill (by bill date) and expense (by expense date) with input_vat_claimed in the month, with supplier, PAN, bill number, taxable and VAT.
  - **Debit notes** on claimed bills, dated in the month: negative lines.
  - **A bill or expense voided:** in the same month, left out. In a later month, a negative line there (the same rule as question 3).
- **Summary:**
  - output VAT (the sales book);
  - less input VAT (the purchase book);
  - less the credit brought forward from the previous return;
  - equals the VAT payable, or a credit carried forward.
  - Due by the 25th of the next BS month, as a reminder.
- **The check:** the sales book's VAT equals the month's 2200 movement, and the purchase book's VAT equals the month's 1450 movement. Both leave out the VAT payment vouchers and compare the posted days only, as the TDS registers do. The 2200 and 1450 balances at the month end are shown next to it.
- **Carry-forward:**
  - the credit brought into a month is the previous filed return's credit carried;
  - carry out = max(0, credit in + input - output);
  - payable = max(0, output - input - credit in).
  - The chain starts in the month VAT was switched on.
  - It is worked out from the filed returns, so no new column is needed.

### 18.3 The VAT payment voucher (TX, kind vat_payment) = filing the month's return
- **Who and when:** admin and accountant, for one BS month. The month must be closed (question 1), so its documents can no longer change. The months are filed in order. One active filing per month (migration 026: a unique index on active vat_payment by BS year and month).
- **What it stores:** vat_output and vat_input (the month's book totals, frozen at filing), the amount paid (the payable), the bank, and the IRD reference.
  - A payment above the payable is refused. The amount defaults to the payable and is never below zero.
- **Entry:** Dr 2200 with the month's output VAT; Cr 1450 with the input VAT used, min(output, input + credit in); Cr bank with the payable. It balances because output = used + payable.
- **A month with a credit** (input + credit in > output): Dr 2200 output, Cr 1450 output; no bank line, Rs 0 paid. The rest stays in 1450 and is carried forward.
- **A month with nothing:** a nil filing (Rs 0, no lines), so every VAT month is filed and the chain stays in order (question 4).
- **Balance Sheet and Trial Balance:** before payment, 2200 is a liability and 1450 an asset. The payment clears 2200 for the month and uses 1450. A credit carried stays as 1450 (Input VAT) under current assets.
- **Void:** with a reason, and only the latest filing (a later month depends on it). It reverses the entry.

### 18.4 Month close and late documents
- **New month-close checks** when VAT was in force on any day of the month. These are blockers, not acknowledgements:
  1. the sales book's VAT equals the 2200 movement;
  2. the purchase book's VAT equals the 1450 movement;
  3. the month's tax invoice numbers have no gaps;
  4. no VAT problem (sale_vat, input_vat, input_vat_supplier) is open on any day.
  - "Every day posted and locked" is already a blocker.
- **A late credit note** (after the return was filed) is dated on its own day, which is in a later, open month. So it goes into that month's return as a negative line against its earlier invoice. A filed month is never rewritten.
  - Documents cannot be dated in a closed month (the period lock).
  - If the admin reopens a filed month and its figures change, the report shows "changed after filing: Rs X", and the difference is listed in the next open return as an adjustment.

### 18.5 Exports
- Excel and PDF through the 4c builders (lib/reports/exportDocs.ts), with the same header block (name, Sulimha Durbar, Patan, PAN 194139113), the "Posted up to" line, lakh grouping and the same limits.
- Three sections: sales book, purchase book, summary. File LHC_VATReturn_2083-09.
- The columns follow the accountant's IRD format when he gives it (question 5).

### 18.6 Tests
- **Books and ledger:** output and input totals equal the 2200 and 1450 movements. A credit note and a debit note reduce the month. A cancelled invoice (same month) is nil, and one cancelled in a later month goes negative there.
- **Carry-forward:** a credit month carries into the next and is used there.
- **The payment:** above the payable is refused. The voucher balances (Dr 2200 = Cr 1450 + Cr bank), for a credit month too.
- **Filing rules:** refused for a month not closed and out of order; one filing per month; a nil month is filed with Rs 0.
- **Late documents:** a late credit note goes into the next month and the filed month stays the same.
- **Month close:** refused while a VAT book check fails.
- **Statements:** the TB, P&L and Balance Sheet agree after the payment.
- **Access:** staff and supervisor get 403 on the new routes.
- **Exports:** the Excel and PDF file names.
- **Migration:** 026 runs twice.
- **Every earlier test passes.**

### 18.7 Questions (recommended answers first)
1. **File and pay only after the month is closed?** Recommended: yes. Closing locks the month, so the filed figures can never change. The deadline (the 25th of the next month) leaves time to close first.
2. **Wrong customer (the sale moved to the right customer):** recommended, the VAT stays with the first tax invoice. The replacement is listed with nil amounts, "replaces TI-...", so the VAT counts once, as in the ledger.
3. **A cancel or void:** recommended, in the same month it is nil (or left out). In a later month it is a negative line in that month.
4. **Nil returns:** recommended, record a Rs 0 filing for a month with nothing payable, so every VAT month is filed in order.
5. **The columns:** recommended, build the standard sales and purchase book columns now (with non-taxable and export columns at 0), and switch to the accountant's IRD layout when he gives it.
6. **A credit that stays for months:** recommended, it only carries forward. A refund claim from IRD is outside the app.

### 18.8 As built (2026-11-28)
- **The owner's answers:** approved as recommended. File after the month is closed, in order. The VAT of a moved sale stays with the first invoice. A cancel in the same month is nil, a later one negative in its month. Nil returns are filed at Rs 0. Standard columns for now. A credit only carries forward.
- **lib/reports/vatReturn.ts:**
  - salesBook, purchaseBook, filedReturns (the credit carried along the filed returns), vatReturn (books, summary, the check against 2200 and 1450, the balances, the filing, unfiled earlier months, the due date);
  - a void of a bill or expense in a later month is a negative line in that month; a void in the same month leaves it out.
- **The filing** (POST /tax-payments kind vat_payment; GET /tax-payments/vat-suggest):
  - refused when VAT was not in force that month, when the month is not closed, when an earlier VAT month is unfiled, when it is already filed (and the unique index), or when the books do not agree with the ledger;
  - the amount defaults to the payable and may not be above it;
  - it stores vat_output and vat_input, the month's book totals, frozen.
  - **Posting** (taxPaymentEntry vat_payment): Dr 2200 (input used + paid), Cr 1450 (input used = min(output, input + credit in)), Cr bank (paid). A nil filing posts nothing.
  - **Void:** only the latest filing.
- **Month close:** for a VAT month whose days are all posted, the blockers are a sales or purchase book that differs from the 2200 or 1450 movement, and missing tax invoice numbers. Posting problems (sale_vat, input_vat, input_vat_supplier) already stop a day from posting, so an unposted day is the existing blocker.
- **Reports > VAT return** shows the summary next to the 2200 and 1450 balances, the check, the filing and both books, with Excel and PDF (LHC_VATReturn_YYYY-MM; sales book, purchase book, summary; non-taxable and export columns at 0).
- **Chart of Accounts > Tax payments > File a VAT return:** the month's figures, the reasons it cannot be filed yet, and the amount.
- **Narrower than the plan:**
  - when a filed month is reopened and changes, the return shows "Changed after filing" with the difference. The difference is not added to the next return as an adjustment line automatically: the accountant enters it (or files the corrected month after voiding the latest filing).
  - a payment below the payable is allowed; what is left stays on 2200 as owed.
