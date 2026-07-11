import { Router } from "express";
import { db, loyaltyEmailVerificationsTable } from "@workspace/db";
import { gte, sql } from "drizzle-orm";
import { authenticate, requireAdmin } from "../middlewares/auth";

const router = Router();

router.get("/system/health", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  try {
    // 1. Cloudinary usage via Admin API
    let cloudinary = null;
    try {
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      if (cloudName && apiKey && apiSecret) {
        const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
        const r = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/usage`, {
          headers: { Authorization: `Basic ${auth}` }
        });
        if (r.ok) {
          const d = await r.json() as any;
          cloudinary = {
            storageUsedGB: (d.storage?.usage ?? 0) / (1024 ** 3),
            storageLimitGB: 25,
            bandwidthUsedGB: (d.bandwidth?.usage ?? 0) / (1024 ** 3),
            bandwidthLimitGB: 25,
            creditsUsed: d.credits?.usage ?? 0,
            creditsLimit: d.credits?.limit ?? 25,
            creditsPercent: d.credits?.used_percent ?? 0,
          };
        }
      }
    } catch { /* non-critical */ }

    // 2. Email OTPs sent this month (from our own DB)
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [emailResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(loyaltyEmailVerificationsTable)
      .where(gte(loyaltyEmailVerificationsTable.createdAt, monthStart));
    const emailsSentThisMonth = Number(emailResult?.count ?? 0);

    // 3. Database size
    const dbSizeRows = await db.execute(
      sql`SELECT pg_size_pretty(pg_database_size(current_database())) as size, 
          pg_database_size(current_database()) as bytes`
    );
    const dbSizeResult = (dbSizeRows as any).rows?.[0] ?? (dbSizeRows as any)[0] ?? {};
    const dbSize = {
      pretty: dbSizeResult?.size ?? "unknown",
      bytes: Number(dbSizeResult?.bytes ?? 0),
      limitBytes: 1024 ** 3,
    };

    res.json({
      cloudinary,
      email: {
        sentThisMonth: emailsSentThisMonth,
        limitPerMonth: 3000,
        percent: Math.round((emailsSentThisMonth / 3000) * 100),
      },
      database: dbSize,
      links: {
        railway: "https://railway.com/dashboard",
        vercel: "https://vercel.com/dashboard",
        resend: "https://resend.com/emails",
        cloudinary: "https://console.cloudinary.com",
      }
    });
  } catch (err) {
    console.error("System health error:", err);
    res.status(500).json({ error: "Failed to fetch system health" });
  }
});

export default router;