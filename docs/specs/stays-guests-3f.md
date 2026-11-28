# Part 3f: hotel guests, the stay folio and the stay history (plan, not built)

Written for: the owner, to approve before any code or migration, and for whoever builds it.
Status: approved by the owner on 2026-11-28 (questions 1 to 6 as recommended, plus the four points in section 12) and built the same day (docs/CHANGELOG.md, 2026-11-28 (g)). Builds on docs/specs/room-stays.md.

## 1. The design, in one paragraph
- **One customer table:** hotel guests stay on loyalty_customers, the one table that receivables, credit notes, re-issue, statements and the immutable journal lines point at. A new `kind` column marks each row 'member' or 'hotel_guest'.
- **Guests:** only the name is required at check-in. Loyalty lists show members only, and a guest can be promoted to a member.
- **Points:** a guest earns points on the extras they pay for, never on the included breakfast. Sulimha Durbar never earns.
- **Stays:** a Guests view on the Stays page; a folio page that prints the guest's extras bill; and an insert-only history of each stay.
- **No delete:** a guest who was never billed can be archived. Nothing is deleted.

## 2. What exists today (read on 2026-11-28)
| Topic | Where | Today |
|---|---|---|
| Customer row | lib/db/src/schema/loyalty.ts | name required; **phone required and unique**; email optional and unique (any row); points, orders, spent, credit terms. No kind, no archive. |
| Who points at a customer | migrations 001, 002, 004, 012, 013 | **Foreign keys** from customer_receipts, credit_notes, account_conversions, room_stays.customer_id, hotel_settings.sulimha_customer_id, journal_lines.customer_id, opening_balance_lines.customer_id. That is why a guest cannot be deleted: the stay (and once billed, the journal) holds the row. |
| Delete | routes/loyalty.ts:171 | `DELETE /loyalty/customers/:id` (admin) **physically deletes** the row. It fails with a database error when a foreign key holds it. A customer with only orders (orders.loyalty_customer_id has no foreign key) would be deleted and leave those orders pointing at nothing. |
| Lists and pickers | routes/loyalty.ts:8 (GET /loyalty/customers, all rows, or by phone); pages/loyalty.tsx, pages/pos.tsx, pages/order-log.tsx | Every customer, guests included. |
| Public QR loyalty | routes/public.ts:460, 609-670, 698 | Looks a customer up by phone; sign-up refuses a phone or **email already used by any customer**, guests included. |
| Check-in | routes/stays.ts:102 (POST /stays), lib/stayRules.ts validateCheckIn | Name **and phone required**. Finds a customer by phone or creates one; refuses an email used by another customer. |
| Stay edit | routes/stays.ts:136 (PATCH /stays/:id) | Changes adults, children, breakfast, check-out and notes. **No record of what changed.** |
| Folio | routes/stays.ts:76 (GET /stays/:id); pages/stays.tsx (a dialog) | Every paid bill on the stay (moved-away bills hidden), with items, outstanding and Sulimha's cost for admin and accountant. Reception gets `bills: null`. No print, no "who added it". |
| Who did what on an order | schema orders.created_by (nullable; set at creation, routes/orders.ts:324); order_payments.created_by (each payment part, orders.ts:544) | Who created the order is known for new orders. **Who took the payment** is known only through the payment rows, so it is missing for a bill with none (NC, a Rs 0 bill, the breakfast charged to Sulimha, a bill fully on credit). There is no orders.paid_by. |

### What happens to points today (routes/orders.ts and lib/receivables.ts)
- Points follow the money paid: `syncLoyaltyForOrder` gives 1 point per Rs 10 of the net amount paid. It runs when a bill is settled (orders.ts:547), when a receipt is allocated or voided, and when a credit note is issued or voided (receivables.ts).
- **No stay bill earns points at all** (owner, 2026-11-26): `syncLoyaltyForOrder` returns at once for any order with a room_stay_id (lib/receivables.ts:149). So today:
  - a guest earns **nothing** on the extras they pay for (this breaks the new rule);
  - Sulimha Durbar earns **no points** on breakfast bills (correct, and it stays so).
- **One gap:** the payment step adds 1 to the paying customer's `total_orders` (visits) for every paid bill (orders.ts:534), Sulimha's breakfast bills included. Sulimha's visit count therefore grows with every breakfast bill. It is not points, but it is loyalty data on Sulimha.

## 3. The data changes
- **loyalty_customers:**
  - kind text NOT NULL DEFAULT 'member', CHECK in ('member', 'hotel_guest');
  - phone becomes nullable; unique only when present (the existing unique constraint already allows many NULLs);
  - email: the unique rule applies to members only (a partial unique index WHERE kind = 'member' AND email IS NOT NULL), so a guest may give an email a member also uses;
  - archived boolean NOT NULL DEFAULT false, archived_by text, archived_at timestamp;
  - promoted_by text, promoted_at timestamp (when a guest became a member).
- **stay_events:** a new table, insert-only (a trigger refuses UPDATE and DELETE, like the journal).
  - Columns: id, stay_id (references room_stays), event, detail jsonb, user_name, created_at.
  - event is one of: opened, edited, closed, cancelled, order_charged, order_moved_out, order_moved_in, bill_printed.
- **orders:** paid_by text, nullable. Set from now on at the payment step. Old rows stay empty, shown as "not recorded".
- **No change to** journal_entries, journal_lines, customer_receipts, credit_notes or any posted row.

## 4. Migration 019_hotel_guests.sql (idempotent; run by the owner after a backup, before deploy.sh)
### 4.1 Outline
```
BEGIN;
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'member';
  -- check constraint loyalty_customers_kind_chk (member, hotel_guest), added only if missing
ALTER TABLE loyalty_customers ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false, archived_by, archived_at, promoted_by, promoted_at;
  -- the email rule: drop the table-wide email unique constraint (its name is checked first, section 4.2),
  -- then CREATE UNIQUE INDEX IF NOT EXISTS loyalty_customers_member_email_idx ON loyalty_customers(email) WHERE kind = 'member' AND email IS NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_by text;
CREATE TABLE IF NOT EXISTS stay_events (...);  + index on (stay_id, id);  + the insert-only trigger (CREATE OR REPLACE)
-- existing stays: one 'opened' event from room_stays.created_by/created_at, and 'closed' or 'cancelled' from closed_by/closed_at/close_reason,
-- each with detail {"backfilled": true}; inserted only when the stay has no events yet (so a second run adds nothing)
-- the kind rule (section 4.2), as one UPDATE ... SET kind = 'hotel_guest' WHERE <rule> AND kind = 'member'
COMMIT;
-- checks afterwards (in the file)
```

### 4.2 The kind rule, and the read-only check to run on the server first
A customer becomes 'hotel_guest' when **all** of these hold:
1. they appear in room_stays (they checked in at least once);
2. total_points = 0, and they have no rows in loyalty_point_logs or the redemption logs (never earned or spent points);
3. they have no orders outside their stays (no order with loyalty_customer_id = them and room_stay_id IS NULL);
4. they are not Sulimha Durbar (hotel_settings.sulimha_customer_id).

Everyone else stays a member. Condition 2 is a little stricter than the brief ("no loyalty points"): someone who earned points and spent them to 0 is a member.

**Read-only check first.** Run this on the server (it changes nothing), and send me the counts:
```sql
-- 1. the constraints and indexes on loyalty_customers (the migration needs the email constraint's exact name)
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'loyalty_customers'::regclass ORDER BY conname;
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'loyalty_customers' ORDER BY indexname;

-- 2. who would become a hotel guest, and why the others would not
WITH s AS (SELECT sulimha_customer_id AS id FROM hotel_settings WHERE id = 1)
SELECT c.id, c.name, c.phone, c.total_points,
  (SELECT count(*) FROM room_stays r WHERE r.customer_id = c.id)                                  AS stays,
  (SELECT count(*) FROM orders o WHERE o.loyalty_customer_id = c.id AND o.room_stay_id IS NULL)   AS orders_outside_stays,
  (SELECT count(*) FROM loyalty_point_logs l WHERE l.loyalty_customer_id = c.id)                  AS point_logs,
  c.id = (SELECT id FROM s)                                                                        AS is_sulimha
FROM loyalty_customers c
WHERE EXISTS (SELECT 1 FROM room_stays r WHERE r.customer_id = c.id) OR c.id = (SELECT id FROM s)
ORDER BY c.id;

-- 3. the count the migration would change
WITH s AS (SELECT sulimha_customer_id AS id FROM hotel_settings WHERE id = 1)
SELECT count(*) AS would_become_hotel_guest FROM loyalty_customers c
WHERE EXISTS (SELECT 1 FROM room_stays r WHERE r.customer_id = c.id)
  AND c.total_points = 0
  AND NOT EXISTS (SELECT 1 FROM loyalty_point_logs l WHERE l.loyalty_customer_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.loyalty_customer_id = c.id AND o.room_stay_id IS NULL)
  AND c.id IS DISTINCT FROM (SELECT id FROM s);

-- 4. totals, to compare after the migration (they must not change)
SELECT count(*) AS lines, sum(debit) AS dr, sum(credit) AS cr FROM journal_lines;
SELECT count(*) AS receipts, sum(amount) FROM customer_receipts WHERE status = 'active';
```
The redemption log's table name is confirmed while building, and the check gets that condition too.

### 4.3 The commands (after I build it; the full list comes with the build)
```bash
sudo -u postgres pg_dump cafenexus > /tmp/cafenexus_before_019_$(date +%F_%H%M).sql
git fetch origin && git show origin/<branch>:db/migrations/019_hotel_guests.sql > /tmp/019_hotel_guests.sql
sudo -u postgres psql cafenexus -v ON_ERROR_STOP=1 -f /tmp/019_hotel_guests.sql
# then the check queries in the file, and query 4 above again (the same totals)
```

## 5. API changes
- **Check-in (POST /stays; validateCheckIn):** name required; phone and email optional, and checked for shape only when given.
  - **Phone given and it matches a customer:** use that customer; the kind is unchanged, so a member stays a member.
  - **Phone given, no match:** a new hotel_guest with that phone. The email is not checked against members.
  - **No phone:** always a new hotel_guest. Never matched by name, so two phone-less guests with the same name are two guests.
  - **Then:** a stay_events 'opened' row.
- **PATCH /stays/:id:** writes one 'edited' event per changed field, {field, old, new}, in the same transaction. Fields left the same write nothing.
- **Close and cancel:** 'closed' (reason, and the invoices moved to Sulimha if any) and 'cancelled' (reason).
- **The payment step (routes/orders.ts):**
  - sets orders.paid_by;
  - a bill charged to a stay writes 'order_charged' {orderId, invoice, charge: breakfast|extra, total, createdBy, paidBy};
  - Sulimha's visit count is no longer increased (section 7).
- **Move to another room / Wrong customer (reissueInvoice in routes/receivables.ts):** a bill leaving a stay writes 'order_moved_out' on that stay, and 'order_moved_in' on the target stay, if any.
- **GET /stays/:id (the folio):**
  - adds each order's createdBy, createdAt and paidBy ("not recorded" when empty);
  - adds the stay's history for the history roles.
  - Amounts are unchanged by role: reception still gets no amounts here.
- **GET /stays/:id/history:** admin, accountant, reception, supervisor; anyone else gets 403.
- **POST /stays/:id/bill:** builds the guest's extras bill for that stay and writes 'bill_printed'.
  - Who: admin, accountant, supervisor, head_barista, and reception (question 11.1).
  - What: the invoices charged to the guest on this stay only (stay_charge 'extra' and still on the guest); never Sulimha's breakfast.
  - Each invoice: number, items, total, paid, outstanding.
  - POST because it records the print.
- **GET /stays/guests?q=&archived=:** the Guests view. One row per stay: guest name, phone if any, kind, room, check-in and check-out, adults and children, status, and the stay id. Searched by name, phone or room. Archived guests are hidden unless asked.
- **Archive and promote:**
  - **POST /loyalty/customers/:id/archive (and /unarchive):** refused for a billed customer (any order, journal line, receipt or credit note) with the reason, e.g. "This guest has 2 invoices on room 103; a billed guest cannot be archived."
  - **POST /loyalty/customers/:id/promote:** needs a phone and an email (a member's email stays unique); sets kind 'member', promoted_by and promoted_at. The stays, invoices and points stay.
- **The lists:**
  - **GET /loyalty/customers:** members only, never archived, Sulimha left out. The POS, Order Log and Loyalty pickers get this automatically.
  - **Public QR (routes/public.ts):** looks up and signs up members only. The email check is against members only (question 11.3).
- **DELETE /loyalty/customers/:id:** see question 11.2.
- **Receivables and statements:** unchanged figures. The customer rows carry kind, so the screen and the statements can label "hotel guest".

## 6. Screens
- **Stays page:**
  - **Check-in:** "Phone (optional)" and "Email (optional)". When a phone matches an existing customer, the form says "This phone belongs to <name> (member): the stay goes on their record."
  - **New Guests tab:**
    - search, and the list of section 5, each row opening the stay's folio;
    - Archive only on an unbilled guest; a billed guest shows why it cannot be archived;
    - Promote to member, asking for the phone and email.
  - **The folio:** a full page (/stays/:id) instead of the dialog.
    - Shows the guest, room, check-in and check-out, adults and children, notes, and every order with who added it and when (and who took the payment), with the totals by money role as today.
    - A History panel.
    - A "Print bill" button: the extras bill in the receipts' print style, under the business header "Legendary House Cafe & Barista Coffee School, Sulimha Durbar, Patan, PAN 194139113".
- **Loyalty page:** members only (from the API).
- **Receivables and statements:** a "hotel guest" label next to the name.

## 7. The points rule (owner, 2026-11-28), and the fix
- **The rule:**
  - a guest earns points on the extras they pay for (orders charged to the guest);
  - nothing on an included breakfast (orders charged to Sulimha Durbar);
  - Sulimha never earns.
  - A guest keeps their points, and they stay on the record when promoted.
- **The fix** (lib/receivables.ts syncLoyaltyForOrder):
  - the room_stay_id early return is replaced by "no points when stay_charge = 'breakfast' or the paying customer is Sulimha Durbar";
  - extras then earn like any bill, as the money is paid (at payment, or as receipts are allocated);
  - an unpaid extra moved to Sulimha at check-out earns nothing, because Sulimha never earns.
- **Visit count:** the payment step stops adding to total_orders for Sulimha and for breakfast bills.
- **Not retroactive:** extras paid before this change earned nothing and stay at nothing (question 11.4).
- **CLAUDE.md:** "no loyalty points on stay bills" (2026-11-26) is replaced by this rule.

## 8. Tests
- **Check-in:**
  - with a name only: a hotel_guest with no phone;
  - with a phone that matches a member: that member, still a member;
  - two phone-less guests with the same name: two guests;
  - a guest's email equal to a member's is accepted.
- **Lists:** GET /loyalty/customers and the public lookup return no guests and not Sulimha.
- **Promotion:**
  - refused without a phone and email, or with an email a member uses;
  - accepted: kind 'member', the stays, invoices and points unchanged;
  - the guest then appears in the Loyalty list.
- **Points:**
  - an extra paid at check-out earns floor(net / 10);
  - an extra paid later by a receipt earns then;
  - an included breakfast earns nothing;
  - Sulimha earns nothing and its visit count does not move;
  - an unpaid extra moved to Sulimha earns nothing.
- **Archive:**
  - an unbilled guest is archived and hidden from the Guests view;
  - a billed guest is refused with the reason;
  - nothing is deleted (the row count is the same).
- **History:**
  - PATCH /stays/:id writes edited events with old and new values;
  - opened, closed, cancelled, order_charged, the move events and bill_printed are written;
  - UPDATE and DELETE on stay_events are refused by the database.
- **Roles:**
  - the history is readable by reception and supervisor, and staff gets 403;
  - reception prints the extras bill (with amounts) but still gets no amounts on the folio;
  - the bill holds only the guest's extras for that stay, not the breakfast or another stay's bills.
- **orders.paid_by:** set at payment; old rows show "not recorded".
- **Migration 019:**
  - runs twice;
  - the kind rule on fixture data: a stayed-only customer becomes a guest; a customer with points, with orders outside stays, or Sulimha stays a member;
  - the opened and closed events are backfilled once.
- **Nothing posted changes:** journal and receivables totals, a customer statement, and the Trial Balance are the same before and after the migration and after promotion or archive.

## 9. Risks
- **The email constraint's name:** it is not known from the repo (it may come from an early push). Section 4.2's check query gives it, and the migration drops it by that name.
- **Data drift:** a customer the rule calls a guest might be someone you think of as a member (they stayed, then never came to the cafe). Query 2 lists every one by name before anything runs, and a wrong one can be promoted afterwards.
- **Old orders:** they have no paid_by, and their history before the migration is only the backfilled opened and closed events. The folio says "not recorded" rather than guessing.

## 10. What stays as it is
- The journal and the posting rules.
- Receivables figures, credit notes, re-issue, statements and reports.
- Breakfast billing to Sulimha.
- Who may open, close and cancel stays.

## 11. Questions (each with my recommendation)
1. **"Reception may print the bill for its own stay only."** Is "its own" any stay (the reception logins are all Sulimha's front desk), or only stays that receptionist opened?
   - Recommended: any stay, because check-out is often done by another receptionist on a later shift. Reception sees the amounts only on that printed bill.
2. **DELETE /loyalty/customers/:id.** It physically deletes today, and orders could be left pointing at nothing.
   - Recommended: replace it with the same archive (refused for anyone billed, members included), so nothing is ever deleted.
3. **Public QR sign-up with a phone that belongs to a hotel guest.**
   - Recommended: the sign-up promotes that guest to a member (with the email they enter), so they keep their stays and points, instead of refusing the phone as "already used".
4. **Points on extras paid before this change.** Recommended: not retroactive; they stay at 0, and the rule starts when the change is deployed.
5. **Backfilling the history for existing stays.** Recommended: yes, only 'opened' and 'closed' or 'cancelled' from the stay's own columns, marked backfilled. Older orders show in the folio's order list with "paid by: not recorded".
6. **Who archives and promotes.** Recommended:
   - Archive: admin and supervisor.
   - Promote: admin, supervisor and reception, since reception is where a guest says "I'd like to join".

## 12. Added by the owner at approval (2026-11-28), and built
1. **An archived guest checks in again:** a check-in with an archived guest's phone un-archives that guest. There is no duplicate and no unique-phone error, and the stay's history gets a 'guest_unarchived' row.
2. **QR sign-up:** a sign-up that promotes a guest records promoted_by = 'QR sign-up' and the time. The public page returns only the member's id, name, phone, points and loop: never stays, rooms or invoices.
3. **Two more history events:** order_cancelled (Cancel invoice, with the reason) and order_credited (an item-wise credit note, and its void).
4. **Same transaction:** every history row is written in the same database transaction as the change it records (the payment step, edit, close, cancel, move, credit note and its void, Cancel invoice). A test proves both directions: a failed change leaves no history row, and a history row that cannot be written undoes the change.

## 13. As built (notes)
- **Promotion from the Stays page:** reception's login is limited to /stays (middlewares/auth.ts), so the screen promotes with POST /stays/guests/:customerId/promote. POST /loyalty/customers/:id/promote does the same for the admin and supervisors. Both use routes/loyalty.ts promoteGuest.
- **The email constraint:** the migration finds the table-wide unique rule on email by its definition (not its name) and drops it, so the read-only check's constraint name is not needed.
- **Points before deploy:** extras charged before the deploy keep 0 points even when paid later. Their loyalty_paid_basis is empty, which syncLoyaltyForOrder treats as the old rule.
