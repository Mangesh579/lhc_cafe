const PAN_NUMBER = "194139113"; // change here if it ever changes

type KotItem = {
  quantity: number;
  menuItemName?: string | null;
  subtotal: string | number;
  notes?: string | null;
  kotNumber?: number | null;
  kotAt?: string | null;
  kotNote?: string | null;
  kotBy?: string | null;
};

export type KotOrder = {
  id: number;
  tableNumber?: number | null;
  tableName?: string | null;
  createdAt?: string | Date | null;
  backdatedAt?: string | Date | null;
  createdBy?: string | null;
  loyaltyCustomerName?: string | null;
  notes?: string | null;
  totalAmount?: string | number | null;
  invoiceNumber?: string | null;
  isNc?: boolean | null;
  ncPersonName?: string | null;
  ncReason?: string | null;
  items?: KotItem[];
};

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildKotHtml(order: KotOrder, opts: { kotNumber?: number; showPrices?: boolean } = {}): string {
  const showPrices = opts.showPrices ?? false;
  const allItems = order.items ?? [];
  const totalBatches = Math.max(1, ...allItems.map(i => i.kotNumber ?? 1));
  const kotNo = opts.kotNumber ?? totalBatches;
  const items = allItems.filter(i => (i.kotNumber ?? 1) === kotNo);
  const first = items[0];
  const kotAt = first?.kotAt;
  const when = new Date(kotNo > 1 && kotAt ? kotAt : (order.backdatedAt ?? order.createdAt ?? Date.now()));
  const note = kotAt ? first?.kotNote : (totalBatches <= 1 ? order.notes : null);
  const by = first?.kotBy ?? order.createdBy;
  const label = totalBatches > 1 || kotNo > 1 ? `KOT #${kotNo}` : "KOT";
  const tableLabel = order.tableNumber ? (order.tableName || `Table ${order.tableNumber}`) : "TAKEAWAY";
  const batchTotal = items.reduce((s, i) => s + parseFloat(String(i.subtotal)), 0);
  const logo = `${window.location.origin}/LHC_logo.png`;

  const row = (l: string, r: string, extra = "") =>
    `<div style="display:flex;justify-content:space-between;gap:8px;${extra}"><span>${l}</span><span>${r}</span></div>`;

  const itemsHtml = items.map(i => `
    <div style="margin-bottom:4px;">
      ${row(`<b>${i.quantity}× ${esc(i.menuItemName ?? "")}</b>`, showPrices ? `Rs. ${parseFloat(String(i.subtotal)).toFixed(0)}` : "")}
      ${i.notes ? `<p style="margin:0 0 0 14px;font-size:11px;font-style:italic;">↳ ${esc(i.notes)}</p>` : ""}
    </div>`).join("");

  return `
    <div style="font-family:monospace;font-size:12px;color:#000;background:#fff;">
      <div style="text-align:center;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:8px;">
        // <img src="${logo}" alt="LHC Cafe" style="height:44px;display:block;margin:0 auto 6px;" />
        <h2 style="font-size:15px;font-weight:bold;margin:0;">Legendary House Cafe &amp; Barista School</h2>
        <p style="font-size:11px;margin:2px 0;">Sulimha Durbar, Pimbahal, Nepal</p>
        <p style="font-size:11px;margin:2px 0;">PAN/VAT No: ${PAN_NUMBER}</p>
        <p style="margin:8px 0 0;"><span style="display:inline-block;border:3px solid #000;padding:2px 18px;font-weight:bold;font-size:22px;letter-spacing:3px;">${label}</span></p>
        ${order.isNc ? `<p style="margin:6px 0 0;"><span style="display:inline-block;border:2px solid #000;padding:1px 8px;font-weight:bold;font-size:11px;">NOT CHARGEABLE</span></p>` : ""}
      </div>
      <p style="text-align:center;margin:6px 0;"><span style="display:inline-block;border:2px solid #000;padding:2px 12px;font-weight:bold;font-size:15px;">${esc(tableLabel)}</span></p>
      <p style="margin:2px 0;">Order #${order.id}${totalBatches > 1 ? ` · ${totalBatches} KOTs on this bill` : ""}</p>
      ${order.invoiceNumber ? `<p style="margin:2px 0;font-weight:bold;">Invoice No: ${esc(order.invoiceNumber)}</p>` : ""}
      <p style="margin:2px 0;">${when.toLocaleString()}</p>
      ${by ? `<p style="margin:2px 0;">Staff: ${esc(by)}</p>` : ""}
      ${order.loyaltyCustomerName ? `<p style="margin:2px 0;">Customer: ${esc(order.loyaltyCustomerName)}</p>` : ""}
      ${order.isNc ? `<p style="margin:2px 0;font-weight:bold;">Issued To: ${esc(order.ncPersonName)}</p>${order.ncReason ? `<p style="margin:2px 0;">Reason: ${esc(order.ncReason)}</p>` : ""}` : ""}
      <div style="border-top:1px dashed #000;border-bottom:1px dashed #000;padding:8px 0;margin:8px 0;">${itemsHtml}</div>
      ${showPrices ? row(totalBatches > 1 ? "KOT TOTAL" : (order.isNc ? "VALUE (NOT COLLECTED)" : "TOTAL"), `Rs. ${batchTotal.toFixed(0)}`, "font-weight:bold;font-size:14px;") : ""}
      ${showPrices && totalBatches > 1 && order.totalAmount != null ? row("Bill so far", `Rs. ${parseFloat(String(order.totalAmount)).toFixed(0)}`, "font-size:11px;margin-top:2px;") : ""}
      ${note ? `<p style="margin:8px 0 0;font-size:11px;">Note: ${esc(note)}</p>` : ""}
      ${order.isNc ? `<div style="margin-top:26px;padding-top:14px;border-top:1px solid #000;display:flex;justify-content:space-between;font-size:11px;"><div style="width:45%;"><div style="border-bottom:1px solid #000;height:26px;"></div><p style="margin:4px 0 0;">Authorized By (Staff)</p></div><div style="width:45%;"><div style="border-bottom:1px solid #000;height:26px;"></div><p style="margin:4px 0 0;">Received By (Signature)</p></div></div>` : ""}
      <p style="text-align:center;margin:14px 0 0;font-size:11px;">Thank you for visiting LHC!</p>
    </div>`;
}

// ── Print size: one dial for every bill and KOT. 1 = old size, smaller = more compact ──
export const RECEIPT_ZOOM = 0.80;
// Hide the logo, address and PAN on the KOT (saves paper in the kitchen). Bills keep theirs.
export const KOT_SHOW_LOGO = false;

export function wrapReceipt(inner: string): string {
  const z = RECEIPT_ZOOM;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { zoom: ${z}; width: ${(72 / z).toFixed(1)}mm; margin: 0 auto; font-family: monospace; font-size: 12px; line-height: 1.2; color: #000; }
    body > div { padding: 1mm 3mm 3mm !important; }
  </style></head><body>${inner}</body></html>`;
}

export function printReceiptHtml(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open();
  doc.write(wrapReceipt(html));
  doc.close();
  const waits = Array.from(doc.images).map(img => img.complete ? Promise.resolve() : new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); }));
  Promise.race([Promise.all(waits), new Promise(res => setTimeout(res, 2000))]).then(() => {
    iframe.contentWindow?.print();
    setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 1000);
  });
}