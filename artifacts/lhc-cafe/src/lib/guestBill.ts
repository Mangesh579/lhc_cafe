// Part 3f: print the guest's extras bill for one stay (POST /stays/:id/bill: the invoices charged to the guest, never the
// breakfast billed to Sulimha Durbar). Reception may print it with its amounts. The receipts' print style.
import { apiJson } from "@/lib/expenseApi";
import { printReceiptHtml } from "@/lib/kot";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number) => `Rs. ${Number(n).toFixed(2)}`;
const row = (l: string, r: string, extra = "") => `<div style="display:flex;justify-content:space-between;${extra}"><span>${l}</span><span>${r}</span></div>`;

export async function printGuestBill(stayId: number) {
  const b = await apiJson(`/stays/${stayId}/bill`, "POST");
  const s = b.stay;
  const invoices = b.invoices.map((i: any) => `
    <div style="margin:6px 0;">
      ${row(`${esc(i.day)} · ${esc(i.invoiceNumber ?? `#${i.orderId}`)}`, money(i.total), "font-weight:bold;")}
      ${i.items.map((x: any) => row(`&nbsp;&nbsp;${x.quantity} x ${esc(x.name)}`, Number(x.amount).toFixed(2), "font-size:11px;")).join("")}
      ${i.credited > 0 ? row("&nbsp;&nbsp;Credited", `(${Number(i.credited).toFixed(2)})`, "font-size:11px;") : ""}
      ${row("&nbsp;&nbsp;Paid", Number(i.paid).toFixed(2), "font-size:11px;")}${row("&nbsp;&nbsp;Still to pay", Number(i.outstanding).toFixed(2), "font-size:11px;")}
    </div>`).join("");
  printReceiptHtml(`<div style="font-family:monospace;font-size:12px;padding:16px;color:black;background:white;">
    <div style="text-align:center;border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:8px;">
      <h2 style="font-size:15px;margin:0;">${esc(b.business.name)}</h2>
      <p style="font-size:11px;margin:2px 0;">${esc(b.business.address)}</p>
      <p style="font-size:11px;margin:2px 0;">PAN/VAT No: ${esc(b.business.pan)}</p>
      <p style="font-weight:bold;margin-top:4px;display:inline-block;border:2px solid #1a1a1a;padding:2px 8px;">GUEST BILL (EXTRAS)</p>
    </div>
    <p style="margin:2px 0;">Room ${esc(s.room)} · ${esc(s.guestName)}${s.guestPhone ? ` · ${esc(s.guestPhone)}` : ""}</p>
    <p style="margin:2px 0;">${esc(s.checkIn)} to ${esc(s.checkOut)} · ${s.adults} adult${s.adults === 1 ? "" : "s"}${s.children ? `, ${s.children} child${s.children === 1 ? "" : "ren"}` : ""}</p>
    <div style="border-top:1px dashed #999;margin:6px 0;padding-top:4px;">${invoices || "<p>No extras on this stay.</p>"}</div>
    <div style="border-top:1px dashed #999;padding-top:6px;">
      ${row("TOTAL", money(b.totals.total), "font-weight:bold;")}${b.totals.credited > 0 ? row("Credited", `(${money(b.totals.credited)})`) : ""}
      ${row("Paid", money(b.totals.paid))}${row("STILL TO PAY", money(b.totals.outstanding), "font-weight:bold;font-size:14px;")}
    </div>
    <p style="font-size:10px;margin-top:6px;">Included breakfasts are billed to Sulimha Durbar and are not on this bill.</p>
    <p style="font-size:10px;margin:2px 0;">Printed by ${esc(b.printedBy)}</p>
    <div style="margin-top:20px;font-size:11px;"><div style="border-bottom:1px solid #1a1a1a;height:22px;width:55%;"></div><p>Guest signature</p></div>
  </div>`);
  return b;
}
