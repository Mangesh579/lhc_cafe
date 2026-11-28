// Step 5e: the tax invoice print (docs/specs/step5-vat-tds.md 17.5), for a bill paid while VAT was in force. Every
// figure comes from what the server froze on the order: the tax invoice number, its date (BS and AD), the taxable
// amount, the VAT rate and amount, and the total. Used by Active Orders after payment and by the Order Log reprint.
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rs = (v: unknown) => `Rs. ${(Number(v) || 0).toFixed(2)}`;
const row = (l: string, r: string, extra = "") => `<div style="display:flex;justify-content:space-between;gap:8px;${extra}"><span>${l}</span><span>${r}</span></div>`;

export function buildTaxInvoiceHtml(o: any, opts: { reprint?: boolean; payLabel?: string } = {}): string {
  const buyer = o.otherPartyName || o.loyaltyCustomerName || "";
  const pan = o.otherPartyPan || o.loyaltyCustomerPan || "";
  const items = (o.items ?? []).map((i: any) => row(`${i.quantity}× ${esc(i.menuItemName ?? "")}`, rs(i.subtotal))).join("");
  const discount = Number(o.discountAmount) || 0;
  return `
    <div style="font-family:monospace;font-size:12px;padding:20px;color:black;background:white;">
      <div style="text-align:center;margin-bottom:10px;border-bottom:2px solid #1a1a1a;padding-bottom:10px;">
        <h2 style="font-size:16px;font-weight:bold;margin:0;">Legendary House Cafe & Barista Coffee School</h2>
        <p style="font-size:11px;margin:2px 0;">Sulimha Durbar, Patan</p>
        <p style="font-size:11px;margin:2px 0;">PAN/VAT No: 194139113</p>
        <p style="font-size:12px;font-weight:bold;margin-top:4px;display:inline-block;border:2px solid #1a1a1a;padding:2px 8px;">TAX INVOICE${opts.reprint ? " (COPY)" : ""}</p>
      </div>
      <p style="margin:2px 0;font-weight:bold;">Tax Invoice No: ${esc(o.taxInvoiceNo)}</p>
      <p style="margin:2px 0;">Date: ${esc(o.taxInvoiceDayBs ?? "")} (${esc(o.taxInvoiceDay ?? "")})</p>
      ${o.invoiceNumber ? `<p style="margin:2px 0;font-size:11px;">Bill ref: ${esc(o.invoiceNumber)} · Order #${o.id}</p>` : ""}
      ${buyer ? `<p style="margin:2px 0;">Buyer: ${esc(buyer)}</p>` : ""}
      ${pan ? `<p style="margin:2px 0;">Buyer's PAN: ${esc(pan)}</p>` : ""}
      ${opts.payLabel ? `<p style="margin:2px 0;">Payment: ${esc(opts.payLabel)}</p>` : ""}
      <div style="border-top:1px dashed #999;border-bottom:1px dashed #999;padding:8px 0;margin:8px 0;">${items}</div>
      ${discount > 0 ? row("Discount", `−${rs(discount)}`) : ""}
      ${row("Taxable amount", rs(o.taxableAmount))}
      ${row(`VAT @ ${Number(o.vatRate) || 13}%`, rs(o.vatAmount))}
      ${row("TOTAL", rs(o.totalAmount), "font-weight:bold;font-size:14px;border-top:2px solid #1a1a1a;margin-top:6px;padding-top:6px;")}
      <p style="text-align:center;margin-top:16px;font-size:11px;">Thank you for visiting LHC!</p>
    </div>`;
}
