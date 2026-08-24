import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Clock, LogIn, LogOut as LogOutIcon, Save, Trash2, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday, isFuture, parseISO } from "date-fns";
import NepaliDate from "nepali-date-converter";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const APIJSON = (path: string, method = "GET", body?: object) =>
  fetch(`${API_BASE}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.ok ? r.json() : Promise.reject(r));

const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_BS = ["Baisakh","Jestha","Ashadh","Shrawan","Bhadra","Ashwin","Kartik","Mangsir","Poush","Magh","Falgun","Chaitra"];

type Shift = { id: number; userId: number; dayOfWeek: number; startTime: string; endTime: string };
type Punch = { id: number; userId: number; username: string; punchType: "in" | "out"; punchedAt: string };
type CommentEntry = { id: number; userId: number; username: string; commentDate: string; comment: string };
type Member = { id: number; username: string; role: string };

function toNepaliDateStr(date: Date): string {
  try {
    const nd = new NepaliDate(date);
    return `${nd.getYear()}-${String(nd.getMonth() + 1).padStart(2, "0")}-${String(nd.getDate()).padStart(2, "0")}`;
  } catch { return ""; }
}

function toNepaliMonthYear(date: Date): { year: number; month: number; monthName: string } {
  try {
    const nd = new NepaliDate(date);
    return { year: nd.getYear(), month: nd.getMonth(), monthName: MONTHS_BS[nd.getMonth()] };
  } catch { return { year: 0, month: 0, monthName: "" }; }
}

// ── Day status logic ─────────────────────────────────────────────────────────
type DayStatus = "present" | "late" | "absent" | "incomplete" | "future" | "today-active" | "none";

function getDayStatus(
  date: Date,
  dayPunches: Punch[],
  shifts: Shift[]
): DayStatus {
  if (isFuture(date) && !isToday(date)) return "future";

  const dayOfWeek = getDay(date);
  const shift = shifts.find(s => s.dayOfWeek === dayOfWeek);

  const inPunches = dayPunches.filter(p => p.punchType === "in");
  const outPunches = dayPunches.filter(p => p.punchType === "out");

  if (inPunches.length === 0) {
    if (isToday(date)) return "none"; // today, not punched in yet — no color
    return "absent";
  }

  if (outPunches.length === 0) {
    if (isToday(date)) return "today-active"; // currently working
    return "incomplete";
  }

  if (shift?.startTime) {
    const firstIn = new Date(inPunches[0].punchedAt);
    const [h, m] = shift.startTime.split(":").map(Number);
    const scheduledStart = new Date(date);
    scheduledStart.setHours(h, m, 0, 0);
    if (firstIn > scheduledStart) return "late";
  }

  return "present";
}

const STATUS_COLORS: Record<DayStatus, string> = {
  present: "bg-green-100 border-green-300 text-green-900",
  late: "bg-amber-100 border-amber-300 text-amber-900",
  absent: "bg-red-100 border-red-300 text-red-900",
  incomplete: "bg-orange-100 border-orange-300 text-orange-900",
  "today-active": "bg-blue-100 border-blue-300 text-blue-900",
  future: "bg-transparent border-border text-muted-foreground",
  none: "bg-transparent border-border text-foreground",
};

const STATUS_LABEL: Record<DayStatus, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  incomplete: "Incomplete",
  "today-active": "Working",
  future: "",
  none: "",
};

// ── Punch widget ─────────────────────────────────────────────────────────────
function PunchWidget({ punches, onPunched }: { punches: Punch[]; onPunched: () => void }) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const lastPunch = punches[0];
  const isPunchedIn = lastPunch?.punchType === "in";

  const handlePunch = async (type: "in" | "out") => {
    setLoading(true);
    try {
      await APIJSON("/staff/punch", "POST", { punchType: type });
      toast({ title: type === "in" ? "Punched in" : "Punched out" });
      onPunched();
    } catch { toast({ title: "Failed to record punch", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <Card className={isPunchedIn ? "border-green-300 bg-green-50/50" : "border-border"}>
      <CardContent className="p-5 flex flex-col items-center text-center space-y-3">
        <Clock className="w-7 h-7 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {isPunchedIn ? "Currently punched in" : "Currently punched out"}
        </p>
        {lastPunch && (
          <p className="text-xs text-muted-foreground">
            Last: {lastPunch.punchType === "in" ? "In" : "Out"} at {format(new Date(lastPunch.punchedAt), "h:mm a, MMM d")}
          </p>
        )}
        <div className="flex gap-2 w-full">
          <Button onClick={() => handlePunch("in")} disabled={loading || isPunchedIn} className="flex-1 gap-1.5 text-sm">
            <LogIn className="w-3.5 h-3.5" /> Punch In
          </Button>
          <Button onClick={() => handlePunch("out")} disabled={loading || !isPunchedIn} variant="outline" className="flex-1 gap-1.5 text-sm">
            <LogOutIcon className="w-3.5 h-3.5" /> Punch Out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Calendar view ────────────────────────────────────────────────────────────
function AttendanceCalendar({
  punches, comments, shifts, onSaved, targetUserId, isAdmin
}: {
  punches: Punch[];
  comments: CommentEntry[];
  shifts: Shift[];
  onSaved: () => void;
  targetUserId?: number;
  isAdmin: boolean;
}) {
  const now = new Date();
  const [viewMonth, setViewMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date>(now);
  const [useBS, setUseBS] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [deletingComment, setDeletingComment] = useState(false);
  const { toast } = useToast();

  // Group punches by date string
  const punchesByDate = useMemo(() => {
    const map: Record<string, Punch[]> = {};
    punches.forEach(p => {
      const key = format(new Date(p.punchedAt), "yyyy-MM-dd");
      if (!map[key]) map[key] = [];
      map[key].push(p);
    });
    return map;
  }, [punches]);

  // Load comment for selected date
  useEffect(() => {
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    const existing = comments.find(c => c.commentDate === dateStr);
    setCommentText(existing?.comment ?? "");
  }, [selectedDate, comments]);

  const days = eachDayOfInterval({ start: startOfMonth(viewMonth), end: endOfMonth(viewMonth) });
  const firstDayOfWeek = getDay(days[0]);

  const prevMonth = () => setViewMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setViewMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  const monthLabel = useBS
    ? (() => { const bs = toNepaliMonthYear(viewMonth); return `${bs.monthName} ${bs.year}`; })()
    : `${MONTHS_EN[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`;

  const selectedDateStr = format(selectedDate, "yyyy-MM-dd");
  const selectedPunches = (punchesByDate[selectedDateStr] ?? []).sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime());
  const existingComment = comments.find(c => c.commentDate === selectedDateStr);

  const handleSaveComment = async () => {
    if (!commentText.trim()) return;
    setSavingComment(true);
    try {
      await APIJSON("/staff/comments", "POST", {
        date: selectedDateStr,
        comment: commentText,
        ...(isAdmin && targetUserId ? { targetUserId } : {}),
      });
      toast({ title: "Comment saved" });
      onSaved();
    } catch { toast({ title: "Failed to save comment", variant: "destructive" }); }
    finally { setSavingComment(false); }
  };

  const handleDeleteComment = async () => {
    if (!existingComment) return;
    setDeletingComment(true);
    try {
      // Use a blank comment to effectively clear it — update to empty then delete
      await fetch(`${API_BASE}/api/staff/comments/${existingComment.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
      });
      setCommentText("");
      toast({ title: "Comment deleted" });
      onSaved();
    } catch {
      // Fallback: if no DELETE endpoint, just save empty string won't work — skip
      toast({ title: "Failed to delete comment", variant: "destructive" });
    }
    finally { setDeletingComment(false); }
  };

  return (
    <div className="space-y-4">
      {/* Calendar header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="font-semibold text-base min-w-40 text-center">{monthLabel}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1))}>Today</Button>
        </div>
        {/* AD / BS toggle */}
        <div className="flex items-center gap-2 text-sm">
          <span className={`text-xs ${!useBS ? "text-foreground font-medium" : "text-muted-foreground"}`}>AD</span>
          <button
            onClick={() => setUseBS(b => !b)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${useBS ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${useBS ? "translate-x-4" : "translate-x-1"}`} />
          </button>
          <span className={`text-xs ${useBS ? "text-foreground font-medium" : "text-muted-foreground"}`}>BS</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {[
          { label: "Present", color: "bg-green-200" },
          { label: "Late", color: "bg-amber-200" },
          { label: "Absent", color: "bg-red-200" },
          { label: "Incomplete", color: "bg-orange-200" },
          { label: "Working now", color: "bg-blue-200" },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded-sm ${s.color}`} />
            <span className="text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <Card>
        <CardContent className="p-3">
          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS_EN.map(d => (
              <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-1.5">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty cells for offset */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`empty-${i}`} />)}

            {days.map(day => {
              const dateStr = format(day, "yyyy-MM-dd");
              const dayPunches = (punchesByDate[dateStr] ?? []).sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime());
              const status = getDayStatus(day, dayPunches, shifts);
              const isSelected = isSameDay(day, selectedDate);
              const isPast = !isFuture(day) && !isToday(day);
              const hasComment = comments.some(c => c.commentDate === dateStr);

              // Nepali date display
              const displayDay = useBS
                ? (() => { try { return new NepaliDate(day).getDate(); } catch { return day.getDate(); } })()
                : day.getDate();

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(day)}
                  className={`
                    relative min-h-14 p-1.5 rounded-md border text-left transition-all
                    ${STATUS_COLORS[status]}
                    ${isSelected ? "ring-2 ring-primary ring-offset-1" : ""}
                    ${isToday(day) ? "font-bold" : ""}
                    hover:opacity-80 cursor-pointer
                  `}
                >
                  <div className="text-xs font-medium mb-1">{displayDay}</div>
                  {dayPunches.length > 0 && (
                    <div className="space-y-0.5">
                      {dayPunches.slice(0, 3).map(p => (
                        <div key={p.id} className="text-[9px] leading-tight opacity-80">
                          {p.punchType === "in" ? "▶" : "◼"} {format(new Date(p.punchedAt), "h:mm")}
                        </div>
                      ))}
                      {dayPunches.length > 3 && <div className="text-[9px] opacity-60">+{dayPunches.length - 3}</div>}
                    </div>
                  )}
                  {hasComment && (
                    <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary/60" title="Has comment" />
                  )}
                  {status !== "future" && status !== "none" && STATUS_LABEL[status] && isPast && (
                    <div className="text-[8px] mt-0.5 opacity-70 font-medium uppercase tracking-wide">{STATUS_LABEL[status]}</div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Selected day detail */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">
              {useBS ? (() => {
                try {
                  const nd = new NepaliDate(selectedDate);
                  return `${nd.getDate()} ${MONTHS_BS[nd.getMonth()]} ${nd.getYear()}`;
                } catch { return format(selectedDate, "MMMM d, yyyy"); }
              })() : format(selectedDate, "MMMM d, yyyy")}
            </h4>
            {selectedPunches.length > 0 && (
              <Badge variant="secondary" className={
                getDayStatus(selectedDate, selectedPunches, shifts) === "present" ? "bg-green-100 text-green-800" :
                getDayStatus(selectedDate, selectedPunches, shifts) === "late" ? "bg-amber-100 text-amber-800" :
                getDayStatus(selectedDate, selectedPunches, shifts) === "incomplete" ? "bg-orange-100 text-orange-800" :
                getDayStatus(selectedDate, selectedPunches, shifts) === "today-active" ? "bg-blue-100 text-blue-800" :
                "bg-muted text-muted-foreground"
              }>
                {STATUS_LABEL[getDayStatus(selectedDate, selectedPunches, shifts)] || "No status"}
              </Badge>
            )}
          </div>

          {/* All punch sessions for the day */}
          {selectedPunches.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              {isFuture(selectedDate) && !isToday(selectedDate) ? "Future date" : "No punches recorded"}
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Punch Sessions</p>
              <div className="flex flex-wrap gap-2">
                {selectedPunches.map(p => (
                  <Badge key={p.id} variant="secondary" className={p.punchType === "in" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}>
                    {p.punchType === "in" ? "▶ In" : "◼ Out"} {format(new Date(p.punchedAt), "h:mm a")}
                  </Badge>
                ))}
              </div>
              {/* Session pairs */}
              {(() => {
                const ins = selectedPunches.filter(p => p.punchType === "in");
                const outs = selectedPunches.filter(p => p.punchType === "out");
                const pairs = ins.map((inP, i) => {
                  const outP = outs[i];
                  if (!outP) return null;
                  const duration = (new Date(outP.punchedAt).getTime() - new Date(inP.punchedAt).getTime()) / 60000;
                  const hours = Math.floor(duration / 60);
                  const mins = Math.round(duration % 60);
                  return <span key={inP.id} className="text-xs text-muted-foreground">{hours > 0 ? `${hours}h ` : ""}{mins}m session</span>;
                }).filter(Boolean);
                return pairs.length > 0 ? <div className="flex flex-wrap gap-2 mt-1">{pairs}</div> : null;
              })()}
            </div>
          )}

          {/* Comment box */}
          <div className="space-y-2 pt-2 border-t">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Comment for this day</p>
            <Textarea
              placeholder="Add a note for this day…"
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              className="resize-none h-16 text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveComment} disabled={savingComment || !commentText.trim()} className="gap-1.5">
                <Save className="w-3.5 h-3.5" /> {existingComment ? "Update" : "Save"}
              </Button>
              {existingComment && (
                <Button size="sm" variant="ghost" onClick={handleDeleteComment} disabled={deletingComment} className="gap-1.5 text-destructive hover:text-destructive">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Table view (for payroll/reports) ─────────────────────────────────────────
function AttendanceTable({ punches, comments, shifts, onSaved, targetUserId, isAdmin }: {
  punches: Punch[];
  comments: CommentEntry[];
  shifts: Shift[];
  onSaved: () => void;
  targetUserId?: number;
  isAdmin: boolean;
}) {
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1);
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [editingComment, setEditingComment] = useState<Record<string, string>>({});
  const [savingComment, setSavingComment] = useState<string | null>(null);
  const { toast } = useToast();

  const byDate: Record<string, Punch[]> = {};
  punches.forEach(p => {
    const date = format(new Date(p.punchedAt), "yyyy-MM-dd");
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(p);
  });

  const allDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const filteredDates = allDates.filter(date => {
    const d = new Date(date);
    return d.getMonth() + 1 === filterMonth && d.getFullYear() === filterYear;
  });
  comments.forEach(c => {
    const d = new Date(c.commentDate);
    if (d.getMonth() + 1 === filterMonth && d.getFullYear() === filterYear && !filteredDates.includes(c.commentDate)) {
      filteredDates.push(c.commentDate);
    }
  });
  filteredDates.sort((a, b) => b.localeCompare(a));

  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  // Total hours for the month
  const totalMinutes = filteredDates.reduce((total, date) => {
    const dayPunches = (byDate[date] ?? []).sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime());
    const ins = dayPunches.filter(p => p.punchType === "in");
    const outs = dayPunches.filter(p => p.punchType === "out");
    return total + ins.reduce((sum, inP, i) => {
      const outP = outs[i];
      if (!outP) return sum;
      return sum + (new Date(outP.punchedAt).getTime() - new Date(inP.punchedAt).getTime()) / 60000;
    }, 0);
  }, 0);

  const handleSaveComment = async (date: string) => {
    const text = editingComment[date];
    if (!text?.trim()) return;
    setSavingComment(date);
    try {
      await APIJSON("/staff/comments", "POST", {
        date, comment: text,
        ...(isAdmin && targetUserId ? { targetUserId } : {}),
      });
      toast({ title: "Comment saved" });
      setEditingComment(prev => { const n = { ...prev }; delete n[date]; return n; });
      onSaved();
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setSavingComment(null); }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <Select value={String(filterMonth)} onValueChange={v => setFilterMonth(parseInt(v))}>
          <SelectTrigger className="w-36 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{months.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(filterYear)} onValueChange={v => setFilterYear(parseInt(v))}>
          <SelectTrigger className="w-28 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground self-center">{filteredDates.length} day{filteredDates.length !== 1 ? "s" : ""}</span>
        <span className="text-xs font-medium text-primary self-center ml-auto">
          Total: {Math.floor(totalMinutes / 60)}h {Math.round(totalMinutes % 60)}m
        </span>
        <Button variant="outline" size="sm" onClick={() => {
          const headers = ["Date", "Status", "Punches", "Hours", "Comment"];
          const rows = filteredDates.map(date => {
            const dayPunches = (byDate[date] ?? []).sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime());
            const status = getDayStatus(new Date(date), dayPunches, shifts);
            const comment = comments.find(c => c.commentDate === date);
            const ins = dayPunches.filter(p => p.punchType === "in");
            const outs = dayPunches.filter(p => p.punchType === "out");
            const dayMinutes = ins.reduce((sum, inP, i) => {
              const outP = outs[i];
              if (!outP) return sum;
              return sum + (new Date(outP.punchedAt).getTime() - new Date(inP.punchedAt).getTime()) / 60000;
            }, 0);
            const punchList = dayPunches.map(p => `${p.punchType}@${format(new Date(p.punchedAt), "h:mma")}`).join("; ");
            return [date, STATUS_LABEL[status] || "-", punchList, `${Math.floor(dayMinutes/60)}h ${Math.round(dayMinutes%60)}m`, comment?.comment ?? ""];
          });
          const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `attendance-${months[filterMonth-1]}-${filterYear}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        }} className="gap-1.5"><Download className="w-3.5 h-3.5" /> Export CSV</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[600px]">
              <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Punches</th>
                  <th className="px-4 py-3">Hours</th>
                  <th className="px-4 py-3">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredDates.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No attendance recorded for this period.</td></tr>
                ) : filteredDates.map(date => {
                  const dayPunches = (byDate[date] ?? []).sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime());
                  const status = getDayStatus(new Date(date), dayPunches, shifts);
                  const comment = comments.find(c => c.commentDate === date);
                  const isEditingThisRow = editingComment[date] !== undefined;
                  const ins = dayPunches.filter(p => p.punchType === "in");
                  const outs = dayPunches.filter(p => p.punchType === "out");
                  const dayMinutes = ins.reduce((sum, inP, i) => {
                    const outP = outs[i];
                    if (!outP) return sum;
                    return sum + (new Date(outP.punchedAt).getTime() - new Date(inP.punchedAt).getTime()) / 60000;
                  }, 0);

                  return (
                    <tr key={date} className="hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium whitespace-nowrap text-sm">{format(new Date(date), "MMM d, yyyy")}</td>
                      <td className="px-4 py-3">
                        {STATUS_LABEL[status] ? (
                          <Badge variant="secondary" className={
                            status === "present" ? "bg-green-100 text-green-800" :
                            status === "late" ? "bg-amber-100 text-amber-800" :
                            status === "absent" ? "bg-red-100 text-red-800" :
                            status === "incomplete" ? "bg-orange-100 text-orange-800" :
                            status === "today-active" ? "bg-blue-100 text-blue-800" : ""
                          }>{STATUS_LABEL[status]}</Badge>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {dayPunches.length === 0 ? <span className="text-xs text-muted-foreground">—</span> :
                            dayPunches.map(p => (
                              <Badge key={p.id} variant="secondary" className={`text-xs ${p.punchType === "in" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                                {p.punchType === "in" ? "▶" : "◼"} {format(new Date(p.punchedAt), "h:mm a")}
                              </Badge>
                            ))
                          }
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                        {dayMinutes > 0 ? `${Math.floor(dayMinutes / 60)}h ${Math.round(dayMinutes % 60)}m` : "—"}
                      </td>
                      <td className="px-4 py-3 max-w-64">
                        {isEditingThisRow ? (
                          <div className="flex gap-2 items-start">
                            <Textarea value={editingComment[date]} onChange={e => setEditingComment(prev => ({ ...prev, [date]: e.target.value }))} className="resize-none h-14 text-xs flex-1" autoFocus />
                            <div className="flex flex-col gap-1">
                              <Button size="sm" className="h-7 text-xs" disabled={savingComment === date} onClick={() => handleSaveComment(date)}>
                                {savingComment === date ? "…" : "Save"}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingComment(prev => { const n = { ...prev }; delete n[date]; return n; })}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground cursor-pointer hover:text-foreground group flex items-start gap-2"
                            onClick={() => setEditingComment(prev => ({ ...prev, [date]: comment?.comment ?? "" }))}>
                            <span className="flex-1">{comment?.comment ?? <span className="italic">Click to add…</span>}</span>
                            <span className="opacity-0 group-hover:opacity-100 text-primary shrink-0">Edit</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Shift schedule editor ────────────────────────────────────────────────────
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ShiftEditor({ userId }: { userId: number }) {
  const [shifts, setShifts] = useState<Record<number, { start: string; end: string }>>({});
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    APIJSON(`/staff/shifts?userId=${userId}`)
      .then((data: Shift[]) => {
        const map: Record<number, { start: string; end: string }> = {};
        data.forEach(s => { map[s.dayOfWeek] = { start: s.startTime, end: s.endTime }; });
        setShifts(map);
      }).catch(() => {});
  }, [userId]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const payload = Object.entries(shifts)
        .filter(([, v]) => v.start && v.end)
        .map(([day, v]) => ({ dayOfWeek: parseInt(day), startTime: v.start, endTime: v.end }));
      await APIJSON(`/staff/shifts/${userId}`, "PUT", { shifts: payload });
      toast({ title: "Shift schedule saved" });
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Weekly Schedule</h3>
        {DAY_NAMES.map((day, idx) => (
          <div key={idx} className="grid grid-cols-3 gap-3 items-center">
            <span className="text-sm font-medium">{day}</span>
            <Input type="time" value={shifts[idx]?.start ?? ""} onChange={e => setShifts(prev => ({ ...prev, [idx]: { start: e.target.value, end: prev[idx]?.end ?? "" } }))} />
            <Input type="time" value={shifts[idx]?.end ?? ""} onChange={e => setShifts(prev => ({ ...prev, [idx]: { start: prev[idx]?.start ?? "", end: e.target.value } }))} />
          </div>
        ))}
        <Button onClick={handleSave} disabled={loading} className="gap-2 w-full mt-2">
          <Save className="w-4 h-4" /> Save Schedule
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function Staff() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [members, setMembers] = useState<Member[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [comments, setComments] = useState<CommentEntry[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  const loadMembers = async () => {
    if (!isAdmin) return;
    try {
      const data = await APIJSON("/staff/members");
      setMembers(data);
      if (data.length > 0 && !selectedUserId) setSelectedUserId(data[0].id);
    } catch { }
  };

  const loadData = async () => {
    try {
      const userIdParam = isAdmin && selectedUserId ? `?userId=${selectedUserId}` : "";
      const [p, c, s] = await Promise.all([
        APIJSON(`/staff/punches${userIdParam}`),
        APIJSON(`/staff/comments${userIdParam}`),
        APIJSON(`/staff/shifts${userIdParam}`),
      ]);
      setPunches(p);
      setComments(c);
      setShifts(s);
    } catch { }
  };

  useEffect(() => { loadMembers(); }, [isAdmin]);
  useEffect(() => { loadData(); }, [isAdmin, selectedUserId]);

  const myPunches = !isAdmin ? punches : [];
  const currentTargetUserId = isAdmin ? (selectedUserId ?? undefined) : undefined;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl md:text-3xl font-serif font-bold">Staff</h1>
        {isAdmin && members.length > 0 && (
          <Select value={selectedUserId ? String(selectedUserId) : ""} onValueChange={v => setSelectedUserId(parseInt(v))}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Select staff member" /></SelectTrigger>
            <SelectContent>
              {members.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.username} ({m.role})</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Staff punch widget */}
      {!isAdmin && (
        <PunchWidget punches={myPunches} onPunched={loadData} />
      )}

      {/* Main tabs: Calendar / Table / Schedule */}
      <Tabs defaultValue="calendar">
        <TabsList>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="table">Table View</TabsTrigger>
          {isAdmin && selectedUserId && <TabsTrigger value="schedule">Shift Schedule</TabsTrigger>}
        </TabsList>

        <TabsContent value="calendar" className="mt-4">
          {(!isAdmin || selectedUserId) ? (
            <AttendanceCalendar
              punches={punches}
              comments={comments}
              shifts={shifts}
              onSaved={loadData}
              targetUserId={currentTargetUserId}
              isAdmin={isAdmin}
            />
          ) : (
            <p className="text-muted-foreground text-sm py-8 text-center">Select a staff member to view their calendar.</p>
          )}
        </TabsContent>

        <TabsContent value="table" className="mt-4">
          {(!isAdmin || selectedUserId) ? (
            <AttendanceTable
              punches={punches}
              comments={comments}
              shifts={shifts}
              onSaved={loadData}
              targetUserId={currentTargetUserId}
              isAdmin={isAdmin}
            />
          ) : (
            <p className="text-muted-foreground text-sm py-8 text-center">Select a staff member to view their attendance.</p>
          )}
        </TabsContent>

        {isAdmin && selectedUserId && (
          <TabsContent value="schedule" className="mt-4">
            <ShiftEditor userId={selectedUserId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
