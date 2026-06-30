import { pgTable, serial, integer, text, timestamp, date, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const staffShiftsTable = pgTable("staff_shifts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
}, (table) => ({
  uniqUserDay: unique().on(table.userId, table.dayOfWeek),
}));

export const attendancePunchesTable = pgTable("attendance_punches", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  punchType: text("punch_type").notNull(),
  punchedAt: timestamp("punched_at").defaultNow().notNull(),
});

export const attendanceCommentsTable = pgTable("attendance_comments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  commentDate: date("comment_date").notNull(),
  comment: text("comment").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqUserDate: unique().on(table.userId, table.commentDate),
}));

export type StaffShift = typeof staffShiftsTable.$inferSelect;
export type AttendancePunch = typeof attendancePunchesTable.$inferSelect;
export type AttendanceComment = typeof attendanceCommentsTable.$inferSelect;