import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const SESSION_SECRET_ENV = process.env.SESSION_SECRET;
if (!SESSION_SECRET_ENV || SESSION_SECRET_ENV.length < 32) {
  throw new Error(
    "SESSION_SECRET environment variable is missing or too short (must be at least 32 characters). " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
  );
}
const JWT_SECRET: string = SESSION_SECRET_ENV;

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signToken(payload: { id: number; username: string; role: string; tokenVersion: number }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

// The QR page's loyalty sign-in (owner, 2026-11-28): a member who verified the email code stays signed in on that phone
// while the same table opening lasts (at most 4 hours). Signed with its own key, so it can never pass as a staff login.
const QR_LOYALTY_SECRET = `${JWT_SECRET}:qr-loyalty`;
export type QrLoyalty = { cid: number; tid: number; op: string | null };
export function signQrLoyalty(p: QrLoyalty): string {
  return jwt.sign(p, QR_LOYALTY_SECRET, { expiresIn: "4h" });
}
export function verifyQrLoyalty(token: unknown): QrLoyalty | null {
  if (typeof token !== "string" || !token) return null;
  try { return jwt.verify(token, QR_LOYALTY_SECRET) as QrLoyalty; } catch { return null; }
}

export function verifyToken(token: string): { id: number; username: string; role: string; tokenVersion: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: number; username: string; role: string; tokenVersion: number };
  } catch {
    return null;
  }
}
