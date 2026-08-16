import { Router } from "express";
import { db, inventoryItemsTable } from "@workspace/db";
import { Resend } from "resend";

const router = Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "noreply@example.com";
const ADMIN_EMAIL = process.env.ADMIN_ALERT_EMAIL;

// GET /api/alerts/low-stock-check
// Triggered by an external cron service once daily. Protected by a secret
// query param instead of JWT since cron services can't easily send auth headers.
router.get("/alerts/low-stock-check", async (req, res): Promise<void> => {
  const { secret } = req.query;
  if (secret !== process.env.CRON_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!ADMIN_EMAIL) {
    res.status(200).json({ skipped: true, reason: "No ADMIN_ALERT_EMAIL configured" });
    return;
  }

  try {
    const items = await db.select().from(inventoryItemsTable);
    const lowStock = items.filter(i =>
      i.minStockLevel && parseFloat(String(i.currentStock)) < parseFloat(String(i.minStockLevel))
    );

    if (lowStock.length === 0) {
      res.json({ sent: false, reason: "No low stock items" });
      return;
    }

    const rows = lowStock.map(i => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${i.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#C85A3A;font-weight:600;">${parseFloat(String(i.currentStock)).toFixed(1)} ${i.unit}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;">${parseFloat(String(i.minStockLevel)).toFixed(1)} ${i.unit}</td>
      </tr>
    `).join("");

    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `⚠️ ${lowStock.length} item${lowStock.length > 1 ? "s" : ""} low on stock — LHC Cafe`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;background:#fdf8f0;border-radius:12px;">
          <h2 style="color:#1A0F0A;margin-bottom:4px;">Low Stock Alert</h2>
          <p style="color:#5a4a3a;font-size:14px;margin-bottom:24px;">LHC Cafe · Daily check</p>
          <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;">
            <thead>
              <tr style="background:#f0e6d2;">
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#7a6a5a;">Item</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#7a6a5a;">Current</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#7a6a5a;">Min Level</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="color:#7a6a5a;font-size:13px;margin-top:20px;">Log in to Cafe Nexus to restock or adjust levels.</p>
        </div>
      `,
    });

    res.json({ sent: true, itemCount: lowStock.length });
  } catch (err) {
    console.error("Low stock alert error:", err);
    res.status(500).json({ error: "Failed to send alert" });
  }
});

export default router;