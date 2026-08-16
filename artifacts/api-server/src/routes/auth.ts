import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, comparePassword, signToken } from "../lib/auth";
import { authenticate, requireAdmin, type AuthRequest } from "../middlewares/auth";
import { authRateLimiter } from "../middlewares/rateLimit";
import type { Response } from "express";

const router = Router();

router.post("/auth/login", authRateLimiter, async (req, res): Promise<void> => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!user || !comparePassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = signToken({ id: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion });
  res.json({
    user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt },
    token,
  });
});

router.post("/auth/logout", (_req, res): void => {
  res.json({ success: true });
});

router.get("/auth/me", authenticate, (req: AuthRequest, res: Response): void => {
  res.json({ id: req.user!.id, username: req.user!.username, role: req.user!.role });
});

router.post("/auth/change-password", authRateLimiter, authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user || !comparePassword(currentPassword, user.passwordHash)) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }
  // Incrementing tokenVersion invalidates every previously issued token for
  // this user immediately — including the one making this very request.
  await db.update(usersTable).set({
    passwordHash: hashPassword(newPassword),
    tokenVersion: user.tokenVersion + 1,
  }).where(eq(usersTable.id, req.user!.id));

  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  const newToken = signToken({ id: updated.id, username: updated.username, role: updated.role, tokenVersion: updated.tokenVersion });
  res.json({ success: true, token: newToken });
});

router.get("/auth/users", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const users = await db.select({ id: usersTable.id, username: usersTable.username, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable);
  res.json(users);
});

router.post("/auth/users", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (existing) {
    res.status(400).json({ error: "Username already exists" });
    return;
  }
  const [user] = await db.insert(usersTable).values({ username, passwordHash: hashPassword(password), role: role ?? "staff" }).returning();
  res.status(201).json({ id: user.id, username: user.username, role: user.role, createdAt: user.createdAt });
});

router.patch("/auth/users/:id", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { username, role } = req.body;
  const [user] = await db.update(usersTable).set({ ...(username && { username }), ...(role && { role }) }).where(eq(usersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ id: user.id, username: user.username, role: user.role, createdAt: user.createdAt });
});

router.delete("/auth/users/:id", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.sendStatus(204);
});

router.post("/auth/users/:id/reset-password", authRateLimiter, authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }
  // Bump tokenVersion so any device that user is logged into gets kicked out immediately
  const [user] = await db.update(usersTable).set({
    passwordHash: hashPassword(newPassword),
    tokenVersion: existing.tokenVersion + 1,
  }).where(eq(usersTable.id, id)).returning();
  res.json({ success: true });
});

export default router;
