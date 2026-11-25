# Step 2: suppliers, purchases and payables (plan)

Status: approved by the owner 2026-11-24 with the answers in section 10. Part A being built. Parts: A (suppliers, ingredient-supplier links, purchase bills, supplier ledger), B (payments PV/CV, allocation, aging), C (purchase returns with item-wise debit notes).

## 1. What exists today (audit)

| Piece | Where | What it does |
|---|---|---|
| Ingredients | `inventory_items` | One row per ingredient, with `department` (kitchen or drink), `unit`, `current_stock` (negative allowed), `cost_per_unit`, `last_purchase_price/qty/date`, `last_supplier` (free text). |
| Record purchase | `POST /inventory/:id/purchase` (routes/expenses.ts), admin and accountant | **One ingredient per call.** In one transaction: adds stock, writes a Stock Log line, updates `cost_per_unit` (weighted average by default, or "last price" if chosen), sets the last-purchase fields, and books a **direct expense** linked by `expenses.inventory_item_id` + `purchase_quantity`. Composite ingredients are refused. No PAN, no bill number, no duplicate check, supplier is free text. |
| Purchase expenses | `expenses` (type direct), Expenses page | Editing a purchase expense is limited; **voiding it takes the stock back out** (cost per unit is not changed back). |
| Costing | `cost_per_unit` → `itemCostFields()` → `order_items.unit_cost` snapshot at each sale | Dish cost and profit use the snapshot taken when the dish was sold, so later price changes never rewrite past profit. |
| Accounting P&L | `computePnl` (routes/opcosting.ts) | Sales − recipe cost of dishes sold (snapshots) − NC − waste − **indirect** expenses. Direct purchases are a memo line only. |
| Cash profit / purchases vs recipe | `/costing/month` | Sales − **all direct and indirect expenses**, plus a "direct purchases vs recipe cost" comparison. |
| Approval requests, kitchen/drink split | `inventory_adjustment_requests`, `canWriteDepartment` | Non-admin stock changes go through approval; each department writes its own stock. Purchases are admin/accountant only and skip approvals. |
| Cost visibility | `hideCosts` middleware | Strips `costPerUnit`, `lastPurchasePrice`, `lastPurchaseQty`, `unitCost`, … for roles other than admin and accountant. |

## 2. How the purchase bill fits in (no duplication)

- **One posting path.** The per-line work done today by Record purchase (stock up, Stock Log, cost per unit, last-purchase fields, a direct expense) moves into one shared helper. Both the new purchase bill and the old endpoint call it, so the costing formula exists once.
- **A purchase bill (GRN) is a document with lines.** Saving it runs the shared helper for each line, inside one transaction with the bill itself.
- **The expense stays the cost record.** Each bill line still creates its direct expense, linked to the bill (new `expenses.purchase_bill_id` and `purchase_bill_item_id`).
  - So the accounting P&L, cash profit, the purchases-versus-recipe check, the Expenses page and its export all keep working, with each purchase counted once.
  - The expense category is the same one Record purchase uses today, from the ingredient (kitchen: "Food ingredients…", drink: "Beverages and drink ingredients").
  - These expenses are read-only on the Expenses page: edit and void say "void the purchase bill instead". This stops stock and payable drifting apart.
- **The payable is the bill, not the expense.**
  - A credit bill's balance is its total minus payments (Part B), and its due date is the bill date + the supplier's credit days (stored on the bill).
  - A cash bill counts as paid at purchase (balance 0). If it was paid from the drawer, its expense is marked `paid_from_drawer`, so the Cash Drawer and its close count already include it. That is the same mechanism as petty-cash payouts. Payments in Part B never create expenses, so nothing is counted twice.
- **Record purchase after Part A.** The accountant's rule is "no purchase without a bill, PAN and bill number". So the Inventory "Record purchase" button opens the new purchase-bill form, pre-filled with that ingredient, and the old endpoint refuses new calls with a clear message. Its code stays only as the shared helper.
- **Price history.** One `ingredient_price_history` row per bill line: ingredient, supplier, bill date, quantity, unit rate before VAT, VAT, landed unit cost. Voiding the bill marks its rows void.

## 3. Rules for each bill

- **PAN and bill number:** the supplier's PAN is mandatory (9 digits) and so is the supplier's bill number. A bill without either is refused.
- **Duplicates:** the same bill number (trimmed, case-insensitive) with the same supplier PAN is refused, through a unique index on active bills. A voided bill's number can be entered again, correctly.
- **Bill date:** the date printed on the bill (the delivery day). Backdating is allowed; a future date (Nepal time) is not. The due date is the bill date + credit days. Overdue is judged on the Nepal day (lib/ledgerData).
- **Lines:**
  - Each line is an ingredient, quantity, rate, VAT and total.
  - The unit must be the ingredient's own unit (unit conversion comes later).
  - Composite ingredients are refused, as today.
  - Stock goes into the ingredient's own inventory (kitchen or drink).
- **VAT:** stored per line, with the bill's total VAT computed. The cafe is not VAT-registered, so VAT is not claimed and is part of cost (cost per unit uses the line total including VAT). When the VAT switch arrives (roadmap step 5), registered periods will separate input VAT.
- **Cost per unit:** the same formula as today. It defaults to weighted average, with "last price" allowed per bill, as on the current form.
- **Numbering:** each bill also gets an internal purchase-journal number in the editable voucher series, for example `PJ-2083/84-00001`.
- **Immutable once saved:**
  - A mistake is corrected by **void with a reason**, or later by a debit note (Part C).
  - Void, in one transaction:
    - reverses each line's stock with a Stock Log line;
    - voids the linked expenses and price-history rows;
    - sets the payable to 0;
    - restores the ingredient's cost per unit and last-purchase fields only if nothing has changed them since this bill. Otherwise they are left as they are, and the void says so.
  - Void is refused if payments are allocated to the bill (Part B), or if the bill was paid from the drawer on a day that is now closed. Nothing is ever deleted.

## 4. Who sees what

| | admin | accountant | supervisor, head chef, head barista | staff |
|---|---|---|---|---|
| Suppliers: name, contact, PAN, type, credit days | edit | edit | view (no amounts) | – |
| Ingredient ↔ supplier links, preferred supplier, "unmapped" banner | edit | edit | view | – |
| Purchase bills: create, view, void | yes | yes | – | – |
| Supplier ledger, balances, due and overdue, price history | yes | yes | – | – |

All prices, bill amounts, balances and price history are served only to admin and accountant, checked at the route. `hideCosts` keeps stripping cost fields elsewhere.

## 5. Existing purchases and expenses

- **Untouched and readable:** every existing purchase expense, Stock Log line and cost per unit stays as it is. Past purchases are not turned into bills (they have no PAN or bill number) and are not counted as payables. The supplier ledger starts with the first bill entered.
- **`last_supplier` free text:** kept. New bills also set it to the supplier's name, so the Inventory screen keeps showing it.
- **Sales history unchanged:** past dish costs and profit stay as they are, because they come from the `unit_cost` snapshots.

## 6. Part A tables (migration 005, idempotent, not run by Claude)

- `suppliers`: name, PAN (unique), address, phone, contact person, credit days, notes, active, type (goods or service; stored now for TDS later).
- `ingredient_suppliers`: ingredient, supplier, preferred flag (at most one preferred per ingredient).
- `purchase_bills`: PJ number, supplier, a snapshot of the supplier PAN and name, the supplier's bill number, bill date, payment terms (cash or credit), paid from (drawer, bank or other, for cash bills), credit days, due date, subtotal, VAT, total, status (active or void), void reason, who and when.
- `purchase_bill_items`: ingredient, quantity, unit, rate, VAT, line total, and the cost and last-purchase values before and after (so void can restore them safely).
- `ingredient_price_history`: one row per bill line, as in section 2.
- `expenses`: two new nullable columns, `purchase_bill_id` and `purchase_bill_item_id`.

## 7. Screens (Part A)

- **Suppliers** (sidebar): list, add/edit, deactivate. **Supplier ledger** per supplier:
  - every bill with its number, date, items, total, paid, balance, due date and an overdue flag;
  - totals billed, paid and balance;
  - the items on each unpaid bill.
- **Purchase bill form:** supplier, bill number, date, lines and totals, cash or credit, with the PAN and duplicate checks shown before saving.
- **Inventory:** each ingredient shows its supplier(s). A banner lists ingredients with no supplier linked, like the existing unlinked-ingredient banners.

## 8. Tests (Part A)

On PGlite, like the conversion tests:
- the duplicate check, including that a voided bill's number can be re-entered;
- refusal without a PAN or bill number;
- stock going up in the right department, and the cost per unit (weighted and last) and last-purchase fields;
- the linked expense counted once in cash profit and the P&L memo;
- the payable and due date;
- void reversing stock, payable and expenses, and restoring cost only when safe;
- Nepal day boundaries for the bill date and overdue;
- role checks, so prices are never returned to other roles.

## 9. Questions for the owner or the accountant

1. Is it all right that, after Part A, Inventory's "Record purchase" opens the purchase-bill form and the quick one-ingredient path (no PAN or bill number) stops?
2. Cash bills paid from the drawer go through the Cash Drawer as payouts on the bill date. Is that right, or are cash purchases paid from elsewhere?
3. Supplier PAN unique, so one supplier record per PAN: correct, even for branches?
4. Bills with non-ingredient lines (for example cleaning supplies that aren't tracked in stock): keep them on Expenses with a bill number for now, until vouchers (roadmap step 3)?

## 10. Owner's answers (2026-11-24)

1. Yes: Inventory's "Record purchase" opens the purchase-bill form, and the quick path without a PAN or bill number stops.
2. Cash bills are paid at purchase in one of three ways:
   - from the **cash drawer**: a drawer payout on the bill date, so the drawer close includes it;
   - by **cheque**: with the cheque number;
   - by **online transfer**: with the transaction reference.

   Only the drawer reduces the drawer. Credit bills are paid later (Part B).
3. Yes: one supplier record per PAN (PAN unique).
4. Yes: items that aren't in stock stay on Expenses, with a bill number, until vouchers (roadmap step 3).
5. Added: the bill form has a **supplier dropdown** that auto-fills the supplier's PAN/VAT number and credit days. Both can be edited on the bill. The bill keeps its own PAN, which the duplicate check uses, and the form warns when it differs from the supplier's.

## 11. Additions (owner, 2026-11-24, after part A went live)

1. **Closed cash drawer.** A bill paid from the cash drawer is refused when that bill date's drawer is already closed, with a clear message. This is the same rule as cash receipts. It was built in part A; a test was added.
2. **Bank account for cheque and online bills.** A cheque or online-transfer bill also stores which bank account paid it, Nabil or HBL (`purchase_bills.paid_from_account`), next to the cheque number or transaction reference. It is required for those bills and empty for drawer and credit bills. Added by migration 006 (005 had already been run).

## 12. Opening supplier balances (built in part B, 2026-11-24)

When the cafe starts using supplier ledgers, suppliers are already owed money for bills from before. The accountant enters those unpaid bills once, per supplier, so balances, due dates and aging are right from the start date.

- **What is entered for each opening bill:** the supplier, their bill number, bill date, due date and the amount still unpaid.
- **No stock and no costing:**
  - no ingredient lines;
  - no stock change;
  - no cost per unit or price-history change;
  - no expense. The goods were received and expensed before the start date, so booking them again would double-count.
- **What it does create:** a payable that part B's payments (PV/CV) can be allocated to, partly or fully, like any credit bill. It shows in the supplier ledger as "opening balance", and aging counts it from its due date.
- **Rules:**
  - The same duplicate check applies: bill number per supplier PAN, across opening bills and purchase bills.
  - An opening bill is immutable like any bill and corrected by void with a reason.
  - Only the admin and the accountant enter them.
  - Each opening bill is dated before the start date.
  - The start date is a setting.
- **For step 3:** the opening total per supplier becomes the opening balance of Accounts Payable (2100), against an opening-balance equity entry. The accountant confirms the start date and totals before posting.

## 13. Note for roadmap step 3 (chart of accounts and posting)

Account numbers are from the chart of accounts the accountant approved on 2026-11-24 (CLAUDE.md, "Chart of accounts"). Purchases and consumption must post to different accounts, so that nothing is counted as a cost twice.

- **A purchase bill increases stock, not cost of sales:**
  - kitchen lines post Dr **1400 Inventory - Kitchen**;
  - drink lines post Dr **1410 Inventory - Drinks**;
  - the credit side depends on how it was paid:
    - **2100 Accounts Payable** for credit bills (suppliers are the sub-ledger);
    - **1100 Cash on Hand** for drawer-paid bills;
    - **1200 Bank - Nabil** or **1210 Bank - HBL** for cheque and online bills, from `purchase_bills.paid_from_account`.
- **Only consumption posts to cost of sales:**
  - Dr **5000 Ingredient consumption - Food** (kitchen) and Dr **5010 Ingredient consumption - Beverage** (drinks), against Cr 1400/1410;
  - the amount is the ingredient cost of what was sold, from the `order_items.unit_cost` snapshots;
  - waste posts to **5100 Waste and spoilage** and NC to **5200 Complimentary (NC) cost**, also against inventory.
- **Purchase expenses must not be posted as costs again.** Each purchase-bill line also creates a direct expense row (`expenses.purchase_bill_id` set). That row keeps today's reports working (the P&L memo, cash profit, the Expenses page). The step-3 posting must skip those rows, and the older purchase expenses from Record purchase (`expenses.inventory_item_id` set), because the bill already posted them to inventory. Otherwise the same purchase would be a cost twice: once as an expense and again when consumed.
- **Input VAT:** stays part of the inventory cost until the VAT switch (roadmap step 5). After registration, VAT on bills posts to **1450 Input VAT**.
- **Opening supplier balances** (section 12) post to 2100 against an opening-balance entry in equity, as the accountant decides when step 3 is built.

## 14. Part C plan: purchase returns with item-wise debit notes (2026-11-24)

Accountant's rule: returns are item-wise and per supplier, with a debit note. A debit note reduces what we owe the supplier and reduces stock. Every point below can be done safely; the cost-per-unit decision is explained.

- **Against what.** A debit note is raised on one active **purchase** bill, with lines picked from that bill's lines:
  - each line is an ingredient, a quantity and an optional reason, plus one reason for the note;
  - the quantity cannot exceed what was bought minus what active debit notes already returned for that line;
  - **opening bills** have no lines and are refused with a clear message.
- **Number and date.**
  - Numbered from the voucher sequences, series `DN` (editable prefix), in the fiscal year of the return date.
  - The return date is the real date: backdating allowed, never the future, not before the bill date, in the current fiscal year, on the Nepal day. These are the same rules as payments.
- **Value of a returned line.**
  - The value is the returned share of what the bill charged for that line: amount × qty / bought qty, plus the same share of the line's VAT, to the paisa.
  - When a return takes the line's last remaining quantity, it uses the exact remainder (line total minus earlier returns), so the returns add up to the line exactly.
- **Effects, in one transaction:**
  1. Stock goes down in the ingredient's own department (kitchen or drink), with a Stock Log line. Negative stock is allowed, as elsewhere.
  2. The payable goes down by the note's value:
     - the note is applied first to its own bill, up to what that bill still owes;
     - anything more (the bill was already paid, in full or in part) stays as a **credit (advance) with that supplier**. It can be allocated to the supplier's other open bills or left, exactly like a payment's advance (new table `debit_note_allocations`).
     - Bill balance = total − paid at purchase − payments allocated − debit notes allocated. Supplier advance = unallocated payments + unallocated debit notes.
  3. The cost record: **one negative direct expense per line**, linked to the bill, bill line and debit note. It uses the same category as the purchase, is not paid from the drawer, and is read-only on the Expenses page. The original expense is never edited, so cash profit and the P&L memo go down by exactly the returned value.
  4. Price history: the bill line's row gets `returned_quantity` increased. If the whole line is returned the row is marked void; otherwise it stays, with its net quantity shown. The rate itself does not change.
- **Cost per unit: not recalculated.**
  - Stock is valued at a weighted average that already includes later purchases and consumption. Taking a return out at its own purchase price would need (stock × average − returned value) / (stock − qty). With little stock left, or negative stock (which the cafe allows), that gives very large, zero or negative costs.
  - Leaving cost per unit unchanged keeps every future dish cost sensible. The difference stays small and corrects itself with the next purchase.
  - Past sales profit never changes, because it uses the cost snapshot taken at each sale.
- **No cash or drawer effect.** A debit note is a credit with the supplier, not a refund. If a supplier ever pays money back, that is a later decision for the accountant (refunds: avoid; void with a reason).
- **Immutable.**
  - Void a debit note with a reason (admin or accountant). In one transaction it puts the stock back with a Stock Log line, voids the negative expenses, restores the price-history quantity, and removes the payable reduction: its allocations stop counting.
  - Notes are never deleted.
  - A purchase bill with an active debit note cannot be voided until the note is voided.
- **Where it shows:**
  - the supplier ledger, with the running balance going down by the note's value;
  - the bill itself (returned quantity per line, and the debit notes);
  - a printable debit note;
  - aging, through the lower bill balance and the advance;
  - a Debit notes list;
  - the Excel exports (ledger and the debit-note list).

  All of it is admin and accountant only.
- **Migration 008 (idempotent):**
  - new tables: `debit_notes`, `debit_note_items`, `debit_note_allocations`;
  - new columns: `expenses.debit_note_id` and `ingredient_price_history.returned_quantity` (default 0).

  No existing row is changed. Before running it, the owner checks that `expenses.amount` has no check forbidding negative values. Neither the Drizzle schema nor any migration has one. If one did exist, saving a debit note would fail safely, with the whole transaction rolled back.
- **Step 3 posting (section 13):** a debit note posts Dr 2100 Accounts Payable (or the supplier advance), Cr 1400/1410 Inventory. The negative expense rows are skipped like the purchase expenses.
