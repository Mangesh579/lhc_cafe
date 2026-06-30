import { Router } from "express";
import { db, staffShiftsTable, attendancePunchesTable, attendanceCommentsTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, desc, asc } from "drizzle-orm";
import { authenticate, requireAdmin, type AuthRequest } from "../middlewares/auth";
import type { Response } from "express";

const router = Router();

// ── Shifts ───────────────────────────────────────────────────────────────

// GET /api/staff/shifts — staff sees own, admin sees all (optionally filtered by userId)
router.get("/staff/shifts", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const isAdmin = req.user!.role === "admin";
  const queryUserId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined;

  const targetUserId = isAdmin ? queryUserId : req.user!.id;

  const shifts = targetUserId
    ? await db.select().from(staffShiftsTable).where(eq(staffShiftsTable.userId, targetUserId)).orderBy(asc(staffShiftsTable.dayOfWeek))
    : await db.select().from(staffShiftsTable).orderBy(asc(staffShiftsTable.dayOfWeek));

  res.json(shifts);
});

// PUT /api/staff/shifts/:userId — admin only, sets the full weekly schedule for a user
router.put("/staff/shifts/:userId", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const userId = parseInt(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId, 10);
  const { shifts } = req.body; // array of { dayOfWeek, startTime, endTime }
  if (!Array.isArray(shifts)) { res.status(400).json({ error: "shifts array required" }); return; }

  await db.delete(staffShiftsTable).where(eq(staffShiftsTable.userId, userId));

  for (const s of shifts) {
    if (s.startTime && s.endTime) {
      await db.insert(staffShiftsTable).values({
        userId,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
      });
    }
  }

  const updated = await db.select().from(staffShiftsTable).where(eq(staffShiftsTable.userId, userId)).orderBy(asc(staffShiftsTable.dayOfWeek));
  res.json(updated);
});

// ── Attendance punches ───────────────────────────────────────────────────

// POST /api/staff/punch — any authenticated staff punches in/out for themselves
router.post("/staff/punch", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { punchType } = req.body;
  if (punchType !== "in" && punchType !== "out") { res.status(400).json({ error: "punchType must be 'in' or 'out'" }); return; }

  const [punch] = await db.insert(attendancePunchesTable).values({
    userId: req.user!.id,
    punchType,
  }).returning();

  res.status(201).json(punch);
});

// GET /api/staff/punches — staff sees own, admin sees all (optionally filtered by userId, date range)
router.get("/staff/punches", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const isAdmin = req.user!.role === "admin";
  const queryUserId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined;
  const targetUserId = isAdmin ? queryUserId : req.user!.id;

  const conditions = [];
  if (targetUserId) conditions.push(eq(attendancePunchesTable.userId, targetUserId));
  if (req.query.from) conditions.push(gte(attendancePunchesTable.punchedAt, new Date(req.query.from as string)));
  if (req.query.to) {
    const toDate = new Date(req.query.to as string);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(attendancePunchesTable.punchedAt, toDate));
  }

  const punches = await db
    .select({
      id: attendancePunchesTable.id,
      userId: attendancePunchesTable.userId,
      username: usersTable.username,
      punchType: attendancePunchesTable.punchType,
      punchedAt: attendancePunchesTable.punchedAt,
    })
    .from(attendancePunchesTable)
    .leftJoin(usersTable, eq(attendancePunchesTable.userId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(attendancePunchesTable.punchedAt));

  res.json(punches);
});

// ── Comments ─────────────────────────────────────────────────────────────

// POST /api/staff/comments — staff adds/updates their own comment for a date
router.post("/staff/comments", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { date, comment } = req.body;
  if (!date || !comment) { res.status(400).json({ error: "date and comment required" }); return; }

  const [existing] = await db.select().from(attendanceCommentsTable)
    .where(and(eq(attendanceCommentsTable.userId, req.user!.id), eq(attendanceCommentsTable.commentDate, date)));

  if (existing) {
    const [updated] = await db.update(attendanceCommentsTable)
      .set({ comment })
      .where(eq(attendanceCommentsTable.id, existing.id))
      .returning();
    res.json(updated);
    return;
  }

  const [created] = await db.insert(attendanceCommentsTable).values({
    userId: req.user!.id,
    commentDate: date,
    comment,
  }).returning();
  res.status(201).json(created);
});

// GET /api/staff/comments — staff sees own, admin sees all (optionally filtered by userId)
router.get("/staff/comments", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const isAdmin = req.user!.role === "admin";
  const queryUserId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined;
  const targetUserId = isAdmin ? queryUserId : req.user!.id;

  const comments = await db
    .select({
      id: attendanceCommentsTable.id,
      userId: attendanceCommentsTable.userId,
      username: usersTable.username,
      commentDate: attendanceCommentsTable.commentDate,
      comment: attendanceCommentsTable.comment,
    })
    .from(attendanceCommentsTable)
    .leftJoin(usersTable, eq(attendanceCommentsTable.userId, usersTable.id))
    .where(targetUserId ? eq(attendanceCommentsTable.userId, targetUserId) : undefined)
    .orderBy(desc(attendanceCommentsTable.commentDate));

  res.json(comments);
});

// GET /api/staff/members — admin only, list of all staff for the filter dropdown
router.get("/staff/members", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const members = await db.select({ id: usersTable.id, username: usersTable.username, role: usersTable.role }).from(usersTable);
  res.json(members);
});

export default router;