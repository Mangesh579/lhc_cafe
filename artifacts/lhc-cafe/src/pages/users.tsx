import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit2, Trash2, UserCheck, UserX, KeyRound } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/auth";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const APIJSON = (path: string, method = "GET", body?: object) =>
  fetch(`${API_BASE}/api${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` }, body: body ? JSON.stringify(body) : undefined }).then(r => r.ok ? r.json() : r.json().then((d: any) => Promise.reject(d)));

function UserDialog({ user, open, onClose, onSaved }: { user?: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState(user?.username ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.role ?? "staff");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) { setUsername(user?.username ?? ""); setPassword(""); setRole(user?.role ?? "staff"); }
  }, [open, user]);

  const handleSave = async () => {
    if (!username) { toast({ title: "Username required", variant: "destructive" }); return; }
    if (!user && !password) { toast({ title: "Password required for new user", variant: "destructive" }); return; }
    setLoading(true);
    try {
      if (user) {
        await APIJSON(`/auth/users/${user.id}`, "PATCH", { username, role });
      } else {
        await APIJSON(`/auth/users`, "POST", { username, password, role });
      }
      toast({ title: user ? "User updated" : "User created" }); onSaved(); onClose();
    } catch (err: any) { toast({ title: "Error", description: err?.error ?? "Failed to save", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{user ? "Edit User" : "Add User"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-1"><Label>Username *</Label><Input value={username} onChange={e => setUsername(e.target.value)} placeholder="staff_username" /></div>
          {!user && <div className="space-y-1"><Label>Password *</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimum 6 characters" /></div>}
          <div className="space-y-1">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="head_chef">Head Chef</SelectItem>
                <SelectItem value="head_barista">Head Barista</SelectItem>
                <SelectItem value="accountant">Accountant</SelectItem>
                <SelectItem value="reception">Reception (Sulimha Durbar, Room Stays only)</SelectItem>
                <SelectItem value="supervisor">Supervisor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>{user ? "Update" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, open, onClose }: { user: any; open: boolean; onClose: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleReset = async () => {
    if (!newPassword || newPassword.length < 6) { toast({ title: "Password must be at least 6 characters", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const r = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/auth/users/${user.id}/reset-password`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        body: JSON.stringify({ newPassword })
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error ?? "Failed"); }
      toast({ title: "Password reset successfully" }); setNewPassword(""); onClose();
    } catch { toast({ title: "Failed to reset password", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Reset Password — {user?.username}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-1"><Label>New Password *</Label><Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password..." /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleReset} disabled={loading}>Reset Password</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userDialog, setUserDialog] = useState<{ open: boolean; user?: any }>({ open: false });
  const [resetDialog, setResetDialog] = useState<{ open: boolean; user?: any }>({ open: false });
  const [deleteUser, setDeleteUser] = useState<any>(null);
  const { user: currentUser } = useAuth();
  const { toast } = useToast();

  const loadUsers = async () => {
    setLoading(true);
    try { const d = await APIJSON("/auth/users"); setUsers(Array.isArray(d) ? d : []); }
    catch { toast({ title: "Failed to load users", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadUsers(); }, []);

  const handleDelete = async () => {
    if (!deleteUser) return;
    if (deleteUser.id === currentUser?.id) { toast({ title: "Cannot delete your own account", variant: "destructive" }); setDeleteUser(null); return; }
    try {
      await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/auth/users/${deleteUser.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("lhc_token")}` } });
      toast({ title: "User deleted" }); setDeleteUser(null); await loadUsers();
    } catch { toast({ title: "Failed to delete user", variant: "destructive" }); }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold">User Management</h1>
        <Button onClick={() => setUserDialog({ open: true })} className="gap-2"><Plus className="w-4 h-4" /> Add User</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
              <tr>
                <th className="px-5 py-3">Username</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Created</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : users.map(user => (
                <tr key={user.id} className={`hover:bg-muted/20 ${user.id === currentUser?.id ? "bg-primary/5" : ""}`}>
                  <td className="px-5 py-3 font-medium">
                    {user.username}
                    {user.id === currentUser?.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={user.role === "admin" ? "default" : user.role === "supervisor" ? "outline" : "secondary"} className="gap-1">
                      {user.role === "admin" ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                      {user.role}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{user.createdAt ? format(new Date(user.createdAt), 'MMM d, yyyy') : "—"}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => setResetDialog({ open: true, user })}>
                        <KeyRound className="w-3 h-3" /> Reset PW
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setUserDialog({ open: true, user })}><Edit2 className="w-4 h-4 text-muted-foreground" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteUser(user)} disabled={user.id === currentUser?.id}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && users.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <UserDialog user={userDialog.user} open={userDialog.open} onClose={() => setUserDialog({ open: false })} onSaved={loadUsers} />
      <ResetPasswordDialog user={resetDialog.user} open={resetDialog.open} onClose={() => setResetDialog({ open: false })} />

      <Dialog open={!!deleteUser} onOpenChange={(o) => !o && setDeleteUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Delete User</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Permanently delete <strong>{deleteUser?.username}</strong>? This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteUser(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
