import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Clock, LogIn, LogOut as LogOutIcon, Save } from "lucide-react";
import { format } from "date-fns";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const APIJSON = (path: string, method = "GET", body?: object) =>
  fetch(`${API_BASE}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.ok ? r.json() : Promise.reject(r));

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Shift = { id: number; userId: number; dayOfWeek: number; startTime: string; endTime: string };
type Punch = { id: number; userId: number; username: string; punchType: "in" | "out"; punchedAt: string };
type CommentEntry = { id: number; userId: number; username: string; commentDate: string; comment: string };
type Member = { id: number; username: string; role: string };

// ── Shift schedule editor (admin) ───────────────────────────────────────────
function ShiftEditor({ userId }: { userId: number }) {
  const [shifts, setShifts] = useState<Record<number, { start: string; end: string }>>({});
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    try {
      const data: Shift[] = await APIJSON(`/staff/shifts?userId=${userId}`);
      const map: Record<number, { start: string; end: string }> = {};
      data.forEach(s => { map[s.dayOfWeek] = { start: s.startTime, end: s.endTime }; });
      setShifts(map);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, [userId]);

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
        {DAYS.map((day, idx) => (
          <div key={idx} className="grid grid-cols-3 gap-3 items-center">
            <span className="text-sm font-medium">{day}</span>
            <Input
              type="time"
              value={shifts[idx]?.start ?? ""}
              onChange={e => setShifts(prev => ({ ...prev, [idx]: { start: e.target.value, end: prev[idx]?.end ?? "" } }))}
            />
            <Input
              type="time"
              value={shifts[idx]?.end ?? ""}
              onChange={e => setShifts(prev => ({ ...prev, [idx]: { start: prev[idx]?.start ?? "", end: e.target.value } }))}
            />
          </div>
        ))}
        <Button onClick={handleSave} disabled={loading} className="gap-2 w-full mt-2">
          <Save className="w-4 h-4" /> Save Schedule
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Punch in/out widget ──────────────────────────────────────────────────
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
      <CardContent className="p-6 flex flex-col items-center text-center space-y-4">
        <Clock className="w-8 h-8 text-muted-foreground" />
        <div>
          <p className="text-sm text-muted-foreground">
            {isPunchedIn ? "You're currently punched in" : "You're currently punched out"}
          </p>
          {lastPunch && (
            <p className="text-xs text-muted-foreground mt-1">
              Last: {lastPunch.punchType === "in" ? "In" : "Out"} at {format(new Date(lastPunch.punchedAt), "h:mm a, MMM d")}
            </p>
          )}
        </div>
        <div className="flex gap-3 w-full">
          <Button onClick={() => handlePunch("in")} disabled={loading || isPunchedIn} className="flex-1 gap-2">
            <LogIn className="w-4 h-4" /> Punch In
          </Button>
          <Button onClick={() => handlePunch("out")} disabled={loading || !isPunchedIn} variant="outline" className="flex-1 gap-2">
            <LogOutIcon className="w-4 h-4" /> Punch Out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Comment box for a given date ─────────────────────────────────────────
function CommentBox({ comments, onSaved, selectedDate, onDateChange }: { comments: CommentEntry[]; onSaved: () => void; selectedDate: string; onDateChange: (d: string) => void }) {
  const existing = comments.find(c => c.commentDate === selectedDate);
  const [text, setText] = useState(existing?.comment ?? "");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => { setText(existing?.comment ?? ""); }, [existing?.comment, selectedDate]);

  const handleSave = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      await APIJSON("/staff/comments", "POST", { date: selectedDate, comment: text });
      toast({ title: "Comment saved" });
      onSaved();
    } catch { toast({ title: "Failed to save comment", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Add / Edit Comment</h3>
        <Input type="date" value={selectedDate} onChange={e => onDateChange(e.target.value)} className="h-9 text-sm" />
        <Textarea
          placeholder="Anything to note for this day? (e.g. came in late, left early, special task...)"
          value={text}
          onChange={e => setText(e.target.value)}
          className="resize-none h-20"
        />
        <Button onClick={handleSave} disabled={loading} size="sm" className="gap-2">
          <Save className="w-3.5 h-3.5" /> Save Comment
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Attendance history table ──────────────────────────────────────────────
function AttendanceHistory({ punches, comments, onSaved, isAdmin, targetUserId }: { punches: Punch[]; comments: CommentEntry[]; onSaved: () => void; isAdmin: boolean; targetUserId?: number }) {
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

  // Also show dates that have comments but no punches for the filtered month
  comments.forEach(c => {
    const d = new Date(c.commentDate);
    if (d.getMonth() + 1 === filterMonth && d.getFullYear() === filterYear) {
      if (!filteredDates.includes(c.commentDate)) filteredDates.push(c.commentDate);
    }
  });
  filteredDates.sort((a, b) => b.localeCompare(a));

  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);
  const months = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];

  const handleSaveComment = async (date: string) => {
    const text = editingComment[date];
    if (!text?.trim()) return;
    setSavingComment(date);
    try {
      await APIJSON("/staff/comments", "POST", {
        date,
        comment: text,
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
      {/* Month/Year filter */}
      <div className="flex gap-2 flex-wrap">
        <Select value={String(filterMonth)} onValueChange={v => setFilterMonth(parseInt(v))}>
          <SelectTrigger className="w-36 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {months.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(filterYear)} onValueChange={v => setFilterYear(parseInt(v))}>
          <SelectTrigger className="w-28 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground self-center">{filteredDates.length} day{filteredDates.length !== 1 ? "s" : ""} found</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
              <tr>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Punches</th>
                <th className="px-5 py-3">Comment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredDates.length === 0 ? (
                <tr><td colSpan={3} className="px-5 py-8 text-center text-muted-foreground">No attendance recorded for this period.</td></tr>
              ) : filteredDates.map(date => {
                const dayPunches = (byDate[date] ?? []).sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime());
                const comment = comments.find(c => c.commentDate === date);
                const isEditingThisRow = editingComment[date] !== undefined;
                const currentText = isEditingThisRow ? editingComment[date] : (comment?.comment ?? "");
                return (
                  <tr key={date} className="hover:bg-muted/20">
                    <td className="px-5 py-3 font-medium whitespace-nowrap">{format(new Date(date), "MMM d, yyyy")}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {dayPunches.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : dayPunches.map(p => (
                          <Badge key={p.id} variant="secondary" className={p.punchType === "in" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}>
                            {p.punchType === "in" ? "In" : "Out"} {format(new Date(p.punchedAt), "h:mm a")}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3 max-w-72">
                      {isEditingThisRow ? (
                        <div className="flex gap-2 items-start">
                          <Textarea
                            value={currentText}
                            onChange={e => setEditingComment(prev => ({ ...prev, [date]: e.target.value }))}
                            className="resize-none h-16 text-xs flex-1"
                            autoFocus
                          />
                          <div className="flex flex-col gap-1">
                            <Button size="sm" className="h-7 text-xs" disabled={savingComment === date} onClick={() => handleSaveComment(date)}>
                              {savingComment === date ? "…" : "Save"}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingComment(prev => { const n = { ...prev }; delete n[date]; return n; })}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="text-xs text-muted-foreground cursor-pointer hover:text-foreground group flex items-start gap-2"
                          onClick={() => setEditingComment(prev => ({ ...prev, [date]: comment?.comment ?? "" }))}
                          title="Click to edit comment"
                        >
                          <span className="flex-1">{comment?.comment ?? <span className="italic">Click to add comment…</span>}</span>
                          <span className="opacity-0 group-hover:opacity-100 text-xs text-primary shrink-0">Edit</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function Staff() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [members, setMembers] = useState<Member[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [comments, setComments] = useState<CommentEntry[]>([]);

  const loadMembers = async () => {
    if (!isAdmin) return;
    try {
      const data = await APIJSON("/staff/members");
      setMembers(data);
      if (data.length > 0 && !selectedUserId) setSelectedUserId(data[0].id);
    } catch { /* ignore */ }
  };

  const loadData = async () => {
    try {
      const userIdParam = isAdmin && selectedUserId ? `?userId=${selectedUserId}` : "";
      const [p, c] = await Promise.all([
        APIJSON(`/staff/punches${userIdParam}`),
        APIJSON(`/staff/comments${userIdParam}`),
      ]);
      setPunches(p);
      setComments(c);
    } catch { /* ignore */ }
  };

  useEffect(() => { loadMembers(); }, [isAdmin]);
  useEffect(() => { loadData(); }, [isAdmin, selectedUserId]);

  const myPunches = !isAdmin ? punches : [];
  const [commentDate, setCommentDate] = useState(format(new Date(), "yyyy-MM-dd"));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold">Staff</h1>
        {isAdmin && members.length > 0 && (
          <Select value={selectedUserId ? String(selectedUserId) : ""} onValueChange={v => setSelectedUserId(parseInt(v))}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Select staff member" /></SelectTrigger>
            <SelectContent>
              {members.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.username} ({m.role})</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {!isAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <PunchWidget punches={myPunches} onPunched={loadData} />
          <CommentBox comments={comments} onSaved={loadData} selectedDate={commentDate} onDateChange={setCommentDate} />
        </div>
      )}

      {isAdmin && selectedUserId && (
        <Tabs defaultValue="history">
          <TabsList>
            <TabsTrigger value="history">Attendance History</TabsTrigger>
            <TabsTrigger value="schedule">Shift Schedule</TabsTrigger>
          </TabsList>
          <TabsContent value="history" className="mt-4">
            <AttendanceHistory punches={punches} comments={comments} onSaved={loadData} isAdmin={true} targetUserId={selectedUserId ?? undefined} />
          </TabsContent>
          <TabsContent value="schedule" className="mt-4">
            <ShiftEditor userId={selectedUserId} />
          </TabsContent>
        </Tabs>
      )}

      {!isAdmin && (
        <AttendanceHistory punches={punches} comments={comments} onSaved={loadData} isAdmin={false} />
      )}
    </div>
  );
}
