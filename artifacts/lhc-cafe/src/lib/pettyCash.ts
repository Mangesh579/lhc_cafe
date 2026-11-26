// Petty cash CV (cash voucher), printed and signed for every payout from the drawer (owner, 2026-11-25).
import { printReceiptHtml } from "@/lib/kot";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function printPettyCashVoucher(p: { voucherNo: string; date: string; category: string; vendor?: string | null; description?: string | null; billNumber?: string | null; amount: number; createdBy?: string | null }) {
  printReceiptHtml(`
    <div style="font-family:monospace;font-size:12px;padding:20px;color:black;background:white;">
      <div style="text-align:center;margin-bottom:10px;border-bottom:2px solid #1a1a1a;padding-bottom:10px;">
        <h2 style="font-size:16px;font-weight:bold;margin:0;">Legendary House Cafe & Barista Coffee School</h2>
        <p style="font-size:11px;margin:2px 0;">Sulimha Durbar, Pimbahal, Nepal</p>
        <p style="font-size:11px;margin:2px 0;">PAN/VAT No: 194139113</p>
        <p style="font-size:11px;font-weight:bold;margin-top:4px;display:inline-block;border:2px solid #1a1a1a;padding:2px 8px;">CASH VOUCHER (PETTY CASH)</p>
      </div>
      <p style="margin:2px 0;font-weight:bold;">Voucher No: ${esc(p.voucherNo)}</p>
      <p style="margin:2px 0;">Date: ${esc(p.date)}</p>
      <p style="margin:2px 0;">Paid to: ${esc(p.vendor || "-")}</p>
      <p style="margin:2px 0;">Bill No: ${p.billNumber ? esc(p.billNumber) : "No bill"}</p>
      <div style="border-top:1px dashed #999;border-bottom:1px dashed #999;padding:6px 0;margin:8px 0;">
        <p style="margin:0;">${esc(p.category)}${p.description ? `: ${esc(p.description)}` : ""}</p>
      </div>
      <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:14px;"><span>AMOUNT PAID</span><span>Rs. ${Number(p.amount).toFixed(2)}</span></div>
      <p style="margin-top:4px;font-size:11px;">Paid in cash from the drawer.</p>
      <div style="margin-top:28px;display:flex;justify-content:space-between;font-size:11px;">
        <div style="width:45%;"><div style="border-bottom:1px solid #1a1a1a;height:24px;"></div><p>Paid by${p.createdBy ? ` (${esc(p.createdBy)})` : ""}</p></div>
        <div style="width:45%;"><div style="border-bottom:1px solid #1a1a1a;height:24px;"></div><p>Received by</p></div>
      </div>
      <div style="margin-top:16px;font-size:11px;"><div style="border-bottom:1px solid #1a1a1a;height:24px;width:45%;"></div><p>Approved by</p></div>
    </div>`);
}
