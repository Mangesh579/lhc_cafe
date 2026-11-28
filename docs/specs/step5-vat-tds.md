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
