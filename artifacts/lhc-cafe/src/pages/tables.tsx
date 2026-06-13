import { useListTables, useCreateTable, useDeleteTable, getListTablesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Download, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Tables() {
  const { data: tables, isLoading } = useListTables();
  const createTable = useCreateTable();
  const deleteTable = useDeleteTable();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

      {isLoading ? (
        <div className="text-center py-12">Loading tables...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {tables?.map((table: any) => (
            <Card key={table.id} className="overflow-hidden border-border/50">
              <div className="p-4 bg-sidebar text-sidebar-foreground flex justify-between items-center">
                <span className="font-bold text-lg font-serif">Table {table.tableNumber}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground/50 hover:text-destructive" onClick={() => handleDelete(table.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <CardContent className="p-6 flex flex-col items-center justify-center space-y-4">
                {table.token ? (
                  <>
                    <div className="p-2 bg-white rounded-lg shadow-sm border">
                      <img src={qrUrl(table.token)} alt={`QR Table ${table.tableNumber}`} className="w-32 h-32" />
                    </div>
                    <p className="text-xs text-muted-foreground font-mono break-all text-center px-2">
                      {orderUrl(table.token).replace(window.location.origin, "…")}
                    </p>
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
    </div>
  );
}
