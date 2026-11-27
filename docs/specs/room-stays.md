# Hotel room stays (plan, for the owner and the accountant to confirm)

Written 2026-11-26, updated the same day with the owner's answers (sections 12 and 14), and **built the same day** (migration 012; see docs/CHANGELOG.md). Section 15 says how the build differs from the plan.

## 1. What the owner asked (2026-11-25)
- Sulimha Durbar is a separate business (the hotel). Its room guests get breakfast included, and Sulimha pays LHC for those breakfasts.
- A guest's extras (snacks, dinner, drinks) are normal LHC sales, paid at the end of the stay.
- The two must be kept apart: breakfasts are billed to Sulimha Durbar, extras to the guest.
- Today staff use **NC (Not Chargeable)** for hotel guests. NC books the cost as LHC's own Complimentary cost, which is wrong for breakfasts Sulimha pays for, and it never charges the guest for extras.

## 2. What already exists and is reused
| Need | Already in the system |
|---|---|
| A bill to someone who pays later | Credit sale: a credit invoice at the visit, on the customer's receivable (Receivables). |
| Paying several bills at once | Receipt voucher (RV): one receipt settles several invoices (allocation). |
| Item cost at the time of sale | Every order item keeps its ingredient cost (unit_cost snapshot), as used for NC. |
| A statement of what is owed | Receivables > customer ledger, with Excel export and aging. |
| Rooms | The rooms are tables already, **by name** ("103" is table 10, ...): 103, 104, 105, 106, 201, 202, 203, 301, 302, 303, 401, 402 (owner). Guests can order from the room's QR. |

So a room stay is mostly a **label that ties bills together**. The money flows through credit invoices and receipts.

## 3. The plan in short
1. **Check-in, by Sulimha's reception.**
   - Reception logs in with a new **reception** role that sees only the Stays page.
   - They open a stay for the room: guest name and phone, number of adults and children, check-in date, expected check-out date, and whether breakfast is included.
   - The guest is added to the customer list. Email is optional.
2. **Breakfast (included), at the LHC POS.**
   - Staff choose "Hotel breakfast", the room, and the **number of breakfasts** (filled in with the stay's adults, and can be changed).
   - Only menu items marked **breakfast** can be added.
   - The order becomes a **credit invoice to Sulimha Durbar** at a **fixed Rs 800 per breakfast**: "Hotel breakfast, Room 204 (guest) x 2 @ Rs 800 = Rs 1,600". The items served are listed underneath as "included".
   - The guest pays nothing.
3. **Extras, at the LHC POS.**
   - Staff choose "Charge to room" and the room.
   - The order becomes a **credit invoice to the guest** at normal menu prices, dated on the visit day. It shows on the stay.
4. **Check-out.**
   - The Stays page shows reception whether the guest's extras are paid. Reception sees only "paid" or "Rs X to pay at LHC", not prices or costs.
   - The guest pays LHC for the extras by cash, QR or card on any of the four machines, split if needed. This is **one receipt** settling all their extras, and a folio (a statement of the stay) is printed.
   - Then reception closes the stay.
5. **Sulimha pays.**
   - Breakfast invoices collect on Sulimha Durbar's receivable.
   - When Sulimha pays by bank transfer, the accountant records one receipt that settles them, with aging and a statement as for any credit customer.

## 4. Rules
**Stays**
- One open stay per room at a time.
- A stay cannot be closed while the guest's extras are unpaid. What happens if the guest has already left is question 1 in section 13.
- Stays are never deleted. A stay opened by mistake is cancelled with a reason, and only if it has no bills.

**Breakfast bills to Sulimha Durbar**
- **Price:**
  - a fixed Rs 800 per breakfast (a setting the admin can change; old bills keep their price);
  - no discount and no service charge;
  - **VAT is added on top** once LHC is VAT registered (Rs 800 + 13%). Until then, no VAT.
- **Invoices:** each breakfast order gets its own invoice (one invoice per sale), dated on the day.
- **Items:** only menu items marked "breakfast" can be on a hotel breakfast order. A second coffee or anything else is an extra for the guest.
- **LHC's own cost** of the breakfast is shown to the admin and accountant only, to see the margin on the Rs 800. It is the sum of the items' recipe costs.
  - **An item with no recipe cost yet:** the POS warns, and its cost counts as Rs 0 in the books. For now, the cost view shows that item's **menu price** instead, marked "no recipe cost yet", so the margin is not overstated while recipes are being added.
  - The stand-in only affects the cost view; it never changes the bill to Sulimha.
- **Breakfast count:** the POS shows how many breakfasts the stay has used today against the number of guests, and warns if it goes over. It never blocks.
- **No loyalty points.**

**Extras to the guest**
- Normal credit sales: menu prices, discounts allowed, an invoice at the visit, on the guest's receivable. The credit-limit warning does not apply to an open stay.
- **No loyalty points for hotel guests** (owner), on extras or breakfasts.
- If the guest pays for an extra there and then, it is a normal sale. Nothing is put on the room.

**Check-out payment**
- The receipt can be cash, QR or **card on any of the four machines**. This is new: receipts today allow only cash, QR and bank.
- Card receipts count toward that machine's settlement, like card sales.

## 5. Money and accounts (for roadmap step 3, posting)
- **Breakfast:**
  - Dr 1300 Accounts Receivable (Sulimha Durbar) Rs 800 x breakfasts, Cr 4000 Food sales (split food and beverage later if the accountant wants).
  - The ingredients consumed post to 5000/5010 as usual. The margin is Rs 800 less the cost.
  - Not 5200 Complimentary cost: that stays for real NC (owner, staff).
- **Extras:**
  - At the visit: Dr 1300 (the guest), Cr 4000/4010.
  - At check-out: Dr 1100 Cash, 1270 QR or 1250/1260 Card, Cr 1300.
- **Sulimha's own card machines:** unchanged.

## 6. Who does what
| Task | Roles |
|---|---|
| Open, edit, close or cancel a stay | **reception** (new, Sulimha's staff), admin, supervisor |
| Hotel breakfast, charge to room (at the POS) | the roles that use the POS today |
| Check-out payment (receipt) | admin, accountant, supervisor, head barista (as for receipts) |
| Breakfast price setting; LHC's breakfast cost and margin; Sulimha's statement | admin, accountant |
| What reception sees | Stays page only: rooms, guests, dates, breakfasts used, extras "paid" or "Rs X to pay". No menu, costs, reports or other pages. |

## 7. Tables (migration 012, draft, not run by Claude)
- **`cafe_tables`:** `+is_room` boolean. The migration sets it on tables 103 to 402 listed above and reports any number not found.
- **`room_stays`** (new):
  - table (room) id, guest customer id, number of adults and children, breakfast included;
  - check-in date, expected check-out date;
  - status (`open`, `checked_out`, `cancelled`), closed at and by, close or cancel reason;
  - notes, created by and at.
  - One open stay per room (partial unique index).
- **`orders`:** `+room_stay_id`, `+stay_charge` (`breakfast` or `extra`), `+breakfast_count`.
- **`menu_items`:** `+is_breakfast` boolean, ticked by the admin on the menu.
- **`loyalty_customers`:** `email` becomes optional (many hotel guests give none).
- **`customer_receipts`:** the mode check adds the four card modes.
- **Settings:** `hotel_settings` holds the breakfast price (default 800) and which customer is Sulimha Durbar. That customer is created once by the admin in the app.
- **`users`:** the role check allows `reception`.

## 8. Screens
- **Stays (new page):**
  - open stays by room, with today's breakfasts and whether the extras are paid;
  - Check-in, Close stay, Cancel;
  - for LHC roles, Check-out payment and the folio print;
  - history with an Excel export.
- **POS:** next to Not Chargeable, a "Room" choice: "Hotel breakfast (billed to Sulimha)" with the breakfast count, or "Charge to room (guest pays at check-out)". The room picker lists open stays only. A hotel breakfast shows only breakfast items.
- **Menu:** a "Breakfast" tick box on each item (admin).
- **Receivables:**
  - Sulimha Durbar appears as a customer, with its statement;
  - receipts gain the card modes;
  - the guest's extras are visible there too.
- **Settings:** the breakfast price, and which customer is Sulimha Durbar (admin).
- **NC label:** changes from "hotel guest / owner" to "owner / staff". Old NC hotel bills stay as they are.

## 9. Tests (to be written with the build)
- **Breakfast bills:**
  - 2 breakfasts give Rs 1,600 to Sulimha, with the items listed as included;
  - a non-breakfast item is refused;
  - a no-recipe item warns, and the cost view uses its menu price, marked;
  - no points;
  - never in the cash drawer or a settlement.
- **Extras:**
  - each is its own invoice on the visit day, on the guest's receivable;
  - no points when paid.
- **Check-out:**
  - one receipt (for example card on LHC HBL POS, split with cash) settles all the extras;
  - the card part shows in the HBL settlement;
  - closing is refused with extras unpaid.
- **Stays:**
  - one open stay per room;
  - cancel is only possible with no bills.
- **The reception role:**
  - sees only Stays;
  - sees no prices or costs;
  - cannot take payments.
- **Migration 012:**
  - runs twice safely;
  - marks the room tables;
  - existing customers keep their email;
  - the receipt modes are checked.

## 10. Not in this plan
- **Room rent, room booking and the hotel's own bills:** these are Sulimha's business, not LHC's.
- **Breakfasts for walk-in (non-hotel) customers:** these stay normal sales.
- **VAT and CBMS:** these follow roadmap steps 5 and 9. The breakfast bill is ready to take VAT on top.

## 11. Questions asked (2026-11-26)
1. Breakfast price: ingredient cost, or a fixed price?
2. Items with no recipe cost: warn or refuse?
3. Breakfast items: any item, or only ones marked breakfast?
4. Who opens the stay?
5. A guest who leaves without paying the extras?
6. VAT later on breakfast bills?
7. Loyalty points for hotel guests?
8. Room list?

## 12. Owner's answers (2026-11-26)
1. **A fixed breakfast price of Rs 800** (taken as per breakfast, i.e. per person; see 13.3).
2. Warn, and count Rs 0, but for now show the cost of the menu item (taken as: the cost view uses the menu price as a stand-in where a recipe has no cost; see 13.2).
3. Only items marked "breakfast".
4. **Sulimha's reception** opens the stay.
5. Asked what it means (explained below; see 13.1).
6. No VAT on the price itself: **VAT is added separately**, on top of Rs 800, once registered.
7. **No loyalty points** for hotel guests.
8. Rooms are the table numbers 103, 104, 105, 106, 201, 202, 203, 301, 302, 303, 401, 402.

## 13. Still open
1. **A guest who leaves without paying the extras.** This is not about complimentary. It means a guest who ate extras charged to the room (say a dinner of Rs 1,200) and checked out at Sulimha's reception without coming to LHC to pay. What should happen to the Rs 1,200?
   - **(a) Recommended:** reception cannot close the stay while extras are unpaid; the Stays page shows "Rs 1,200 to pay at LHC". If the guest has gone anyway, the admin closes the stay with a reason and the extras **move to Sulimha Durbar's account**. Sulimha recovers the money from the guest's hotel bill.
   - **(b)** The extras stay on the guest's own account as an unpaid debt.
2. **The "cost of the menu item".** Menu items have no cost field, only a selling price. Is using the **menu price** as the stand-in for items with no recipe cost right?
3. **Rs 800 per breakfast:** per person (2 guests = Rs 1,600), or per room?
4. **The reception login:** one shared reception user, or one per receptionist? It is recommended to have one per person, so each stay shows who opened it.
5. **The rooms as tables:** do the tables 103 to 402 already exist in the app? The owner can check with the query in the reply that sent this plan.

## 14. Owner's answers to section 13 (2026-11-26)
1. **(a):** reception cannot close a stay with unpaid extras. If the guest has left, the admin closes it with a reason and the extras move to Sulimha Durbar's account.
2. **The menu selling price is the stand-in cost.** Only an *included* breakfast costs Rs 800. A breakfast in a stay without breakfast included is an extra for the guest, at menu prices.
3. **Rs 800 per person.**
4. **One login per receptionist.**
5. The rooms are the tables **named** 103 ... 402. A screenshot showed "103" is table 10, "104" table 11, "Hall" table 9. The migration marks them by name.

## 15. As built (2026-11-26), where it differs from the plan above
- **Room charges are made on the payment screen (Orders), not at the POS.** Room bills often come from the room's QR, and every bill is settled there. The screen has a "Hotel room" box, filled in automatically when the bill is on a room table, with three choices:
  - Pay now;
  - Charge to room;
  - Included breakfast, with the number of breakfasts.
- **Check-out payment:** taken from the stay's folio on the Stays page, one receipt per mode (card first, then cash), allocated oldest bill first. It also works from Receivables, since receipts now take the card modes.
- **The breakfast invoice** lists the items at their menu prices, but its total is Rs 800 x breakfasts, with the note "Hotel breakfast x N @ Rs 800". Item-level sales reports therefore show breakfast items at menu prices; order totals are right.
- **No points:** stay bills never earn points, for the guest or Sulimha. No customer flag was needed.
