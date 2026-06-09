import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/auth";
import { 
  LayoutDashboard, 
  Coffee, 
  ClipboardList, 
  History, 
  MenuSquare, 
  PackageSearch, 
  Grid2X2, 
  Users, 
  Settings, 
  LogOut 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UserRole } from "@workspace/api-client-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "staff"] },
  { href: "/pos", label: "POS", icon: Coffee, roles: ["admin", "staff"] },
  { href: "/orders", label: "Active Orders", icon: ClipboardList, roles: ["admin", "staff"] },
  { href: "/order-log", label: "Order Log", icon: History, roles: ["admin", "staff"] },
  { href: "/menu", label: "Menu", icon: MenuSquare, roles: ["admin"] },
  { href: "/inventory", label: "Inventory", icon: PackageSearch, roles: ["admin", "staff"] },
  { href: "/tables", label: "Tables", icon: Grid2X2, roles: ["admin"] },
  { href: "/loyalty", label: "Loyalty", icon: Users, roles: ["admin", "staff"] },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["admin", "staff"] },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  if (!user) return null;

  const role = user.role || UserRole.staff;

  return (
    <aside className="w-64 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-sidebar-primary">LHC Cafe</h1>
        <p className="text-sm text-sidebar-foreground/70">Management System</p>
      </div>

      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {navItems
          .filter(item => item.roles.includes(role))
          .map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            
            return (
              <Link key={item.href} href={item.href}>
                <span
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                    isActive 
                      ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </span>
              </Link>
            );
          })}
      </nav>

      <div className="p-4 border-t border-sidebar-border bg-sidebar-accent/20">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{user.username}</span>
            <span className="text-xs text-sidebar-foreground/60 capitalize">{user.role}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => logout()} className="text-sidebar-foreground/80 hover:text-destructive">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
