import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface AuthRequest extends Request {
  user?: { id: number; username: string; role: string };
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  // Check the token's version against the current value in the DB — this is
  // what allows the server to invalidate all previously-issued tokens for a
  // user the instant their password changes, even though JWTs are otherwise
  // stateless and would normally remain valid until they expire.
  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, payload.id)).limit(1);
  if (!dbUser || dbUser.tokenVersion !== payload.tokenVersion) {
    res.status(401).json({ error: "Session expired. Please log in again." });
    return;
  }

  req.user = { id: payload.id, username: payload.username, role: payload.role };
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export function requireAdminOrSupervisor(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin" && req.user?.role !== "supervisor") {
    res.status(403).json({ error: "Admin or supervisor access required" });
    return;
  }
  next();
}
