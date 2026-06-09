import { useState } from "react";
import { 
  useListMenuItems, 
  useListMenuCategories, 
  useCreateMenuItem, 
  useUpdateMenuItem, 
  useDeleteMenuItem,
  getListMenuItemsQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, List } from "lucide-react";

export default function Menu() {
  const { data: menuItems, isLoading } = useListMenuItems();
  const { data: categories } = useListMenuCategories();
  
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteMenuItem();
  const updateMutation = useUpdateMenuItem();

  const filteredItems = menuItems?.filter(item => 
    activeCategory === "all" || item.categoryId?.toString() === activeCategory
  ) ?? [];

  const handleToggleAvailable = async (id: number, isAvailable: boolean) => {
    try {
      await updateMutation.mutateAsync({ id, data: { isAvailable: !isAvailable } });
      queryClient.invalidateQueries({ queryKey: getListMenuItemsQueryKey() });
      toast({ title: "Availability updated" });
    } catch (err) {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure?")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListMenuItemsQueryKey() });
      toast({ title: "Item deleted" });
    } catch (err) {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  if (isLoading) return <div className="p-8">Loading menu...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold text-foreground">Menu Management</h1>
        <Button className="gap-2"><Plus className="w-4 h-4"/> Add Item</Button>
      </div>

      <div className="flex gap-2 pb-4 border-b">
        <Button 
          variant={activeCategory === "all" ? "default" : "outline"} 
          onClick={() => setActiveCategory("all")}
          className="rounded-full"
        >
          All Items
        </Button>
        {categories?.map(cat => (
          <Button
            key={cat.id}
            variant={activeCategory === cat.id.toString() ? "default" : "outline"}
            onClick={() => setActiveCategory(cat.id.toString())}
            className="rounded-full"
          >
            {cat.name}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Name</th>
                <th className="px-6 py-4 font-medium">Category</th>
                <th className="px-6 py-4 font-medium">Price</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredItems.map(item => (
                <tr key={item.id} className="hover:bg-muted/30">
                  <td className="px-6 py-4">
                    <div className="font-medium text-base">{item.name}</div>
                    {item.description && <div className="text-xs text-muted-foreground mt-1">{item.description}</div>}
                  </td>
                  <td className="px-6 py-4">{item.categoryName}</td>
                  <td className="px-6 py-4 font-bold">Rs. {item.price}</td>
                  <td className="px-6 py-4">
                    <Badge 
                      variant={item.isAvailable ? "default" : "secondary"}
                      className="cursor-pointer"
                      onClick={() => handleToggleAvailable(item.id, item.isAvailable)}
                    >
                      {item.isAvailable ? "Available" : "Unavailable"}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="sm" className="gap-2">
                        <List className="w-3 h-3" /> Recipes
                      </Button>
                      <Button variant="ghost" size="icon"><Edit2 className="w-4 h-4 text-muted-foreground"/></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)}><Trash2 className="w-4 h-4 text-destructive"/></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No menu items found.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
