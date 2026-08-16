import { useState } from "react";
import { useListTables, useCreateTable, useDeleteTable, getListTablesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Download, Trash2, Lock, Unlock, Edit2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Tables() {
  const { data: tables, isLoading } = useListTables();
  const createTable = useCreateTable();
  const deleteTable = useDeleteTable();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [renameTable, setRenameTable] = useState<any>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);

  const handleRename = async () => {
    if (!renameTable) return;
    setRenameLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/tables/${renameTable.id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (!res.ok) throw new Error();
      queryClient.invalidateQueries({ queryKey: getListTablesQueryKey() });
      toast({ title: "Table renamed" });
      setRenameTable(null);
    } catch {
      toast({ title: "Failed to rename table", variant: "destructive" });
    } finally {
      setRenameLoading(false);
    }
  };

  const handleAddTable = async () => {
    const nextTableNum = tables ? Math.max(0, ...tables.map((t: any) => t.tableNumber)) + 1 : 1;
    try {
      await createTable.mutateAsync({ data: { tableNumber: nextTableNum } });
      queryClient.invalidateQueries({ queryKey: getListTablesQueryKey() });
      toast({ title: "Table added" });
    } catch {
      toast({ title: "Failed to add table", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this table?")) return;
    try {
      await deleteTable.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListTablesQueryKey() });
      toast({ title: "Table deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const handleToggleOccupied = async (table: any) => {
    setTogglingId(table.id);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/tables/${table.id}/occupy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lhc_token")}` },
        body: JSON.stringify({ isOccupied: !table.isOccupied }),
      });
      if (!res.ok) throw new Error();
      queryClient.invalidateQueries({ queryKey: getListTablesQueryKey() });
      toast({ title: table.isOccupied ? "Table closed" : "Table opened — QR is now active" });
    } catch {
      toast({ title: "Failed to update table", variant: "destructive" });
    } finally {
      setTogglingId(null);
    }
  };

  const orderUrl = (token: string) => `${window.location.origin}/order/${token}`;
  const qrUrl = (token: string) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(orderUrl(token))}`;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold text-foreground">Table Management</h1>
        <Button onClick={handleAddTable} className="gap-2" disabled={createTable.isPending}>
          <Plus className="w-4 h-4" /> Add Table
        </Button>
      </div>

      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
        <strong>Security note:</strong> A table's QR code only works while marked <strong>Open</strong>. Open a table when guests are seated, and close it manually once they've left — tables no longer auto-close.
      </div>

      {isLoading ? (
        <div className="text-center py-12">Loading tables...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {tables?.map((table: any) => (
            <Card key={table.id} className="overflow-hidden border-border/50">
              <div className="p-4 bg-sidebar text-sidebar-foreground flex justify-between items-center">
                <div>
                  <span className="font-bold text-lg font-serif">{table.name || `Table ${table.tableNumber}`}</span>
                  {table.name && <span className="block text-xs text-sidebar-foreground/50">Table {table.tableNumber}</span>}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground/50 hover:text-foreground" onClick={() => { setRenameTable(table); setRenameValue(table.name || ""); }}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground/50 hover:text-destructive" onClick={() => handleDelete(table.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <CardContent className="p-6 flex flex-col items-center justify-center space-y-4">
                <Badge variant="secondary" className={table.isOccupied ? "bg-green-100 text-green-800 border-green-200" : "bg-gray-100 text-gray-600 border-gray-200"}>
                  {table.isOccupied ? "● Open — QR Active" : "○ Closed"}
                </Badge>

                {table.token ? (
                  <>
                    <div className="p-2 bg-white rounded-lg shadow-sm border relative">
                      <img src={qrUrl(table.token)} alt={`QR Table ${table.tableNumber}`} className={`w-32 h-32 ${!table.isOccupied ? "opacity-30" : ""}`} />
                      {!table.isOccupied && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Lock className="w-8 h-8 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono break-all text-center px-2">
                      {orderUrl(table.token).replace(window.location.origin, "…")}
                    </p>

                    <Button
                      className="w-full gap-2"
                      variant={table.isOccupied ? "outline" : "default"}
                      onClick={() => handleToggleOccupied(table)}
                      disabled={togglingId === table.id}
                    >
                      {table.isOccupied ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                      {togglingId === table.id ? "Updating…" : table.isOccupied ? "Close Table" : "Open Table"}
                    </Button>

                    <Button variant="outline" className="w-full gap-2" asChild>
                      <a href={qrUrl(table.token)} download={`Table-${table.tableNumber}-QR.png`} target="_blank" rel="noreferrer">
                        <Download className="w-4 h-4" /> Download QR
                      </a>
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center">No QR token — delete and re-add this table.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={!!renameTable} onOpenChange={o => !o && setRenameTable(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Rename Table {renameTable?.tableNumber}</DialogTitle></DialogHeader>
          <div className="py-4 space-y-2">
            <Input
              placeholder={`e.g. "Window Table", "Patio 2"`}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Leave blank to just show "Table {renameTable?.tableNumber}"</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTable(null)}>Cancel</Button>
            <Button onClick={handleRename} disabled={renameLoading}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}