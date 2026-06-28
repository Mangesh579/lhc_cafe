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

export function signToken(payload: { id: number; username: string; role: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

export function verifyToken(token: string): { id: number; username: string; role: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: number; username: string; role: string };
  } catch {
    return null;
  }
}
