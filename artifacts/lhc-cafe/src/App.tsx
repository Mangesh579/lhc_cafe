import { useState } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/auth";
import { NotificationProvider } from "@/contexts/notifications";
import NotFound from "@/pages/not-found";
import { Sidebar } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import Staff from "@/pages/staff";
import Dashboard from "@/pages/dashboard";
import POS from "@/pages/pos";
import Orders from "@/pages/orders";
import OrderLog from "@/pages/order-log";
import MenuPage from "@/pages/menu";
import Inventory from "@/pages/inventory";
import Expenses from "@/pages/expenses";
import CashDrawer from "@/pages/cash-drawer";
import Ledgers from "@/pages/ledgers";
import Receivables from "@/pages/receivables";
import Settlements from "@/pages/settlements";
import Stays from "@/pages/stays";
import ChartOfAccounts from "@/pages/chart-of-accounts";
import Suppliers from "@/pages/suppliers";
import PurchaseBill from "@/pages/purchase-bill";
import AccountConversion from "@/pages/account-conversion";
import Tables from "@/pages/tables";
import Loyalty from "@/pages/loyalty";
import Settings from "@/pages/settings";

import Users from "@/pages/users";
import Login from "@/pages/login";
import PublicOrder from "@/pages/public-order";

function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  if (!user) return null; // Will redirect to login

  return (
    <div className="flex h-screen bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar with hamburger trigger — shown on every screen size */}
        <div className="flex items-center gap-3 px-4 h-14 border-b bg-card shrink-0">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <span className="font-semibold text-sm">LHC Cafe</span>
        </div>
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

const queryClient = new QueryClient();

function Router() {
  const { token, isLoading, user } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }

  // Public route does not need layout
  if (location.startsWith("/order/")) {
    return (
      <Switch>
        <Route path="/order/:token" component={PublicOrder} />
      </Switch>
    );
  }

  // Login page without layout
  if (location === "/login" || !token) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route component={Login} />
      </Switch>
    );
  }

  // Sulimha Durbar's reception (2026-11-26) uses the Stays page only, whatever address is opened
  if ((user?.role as string | undefined) === "reception") {
    return <AppLayout><Stays /></AppLayout>;
  }

  // Protected routes
  return (
    <AppLayout>
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/pos" component={POS} />
        <Route path="/orders" component={Orders} />
        <Route path="/order-log" component={OrderLog} />
        <Route path="/menu" component={MenuPage} />
        <Route path="/inventory" component={Inventory} />
        <Route path="/expenses" component={Expenses} />
        <Route path="/accounts/conversion" component={AccountConversion} />
        {/* Monthly accounts were retired on 2026-11-24; the old address opens Receivables */}
        <Route path="/accounts"><Redirect to="/receivables" /></Route>
        <Route path="/cash-drawer" component={CashDrawer} />
        <Route path="/ledgers" component={Ledgers} />
        <Route path="/receivables" component={Receivables} />
        <Route path="/settlements" component={Settlements} />
        <Route path="/stays" component={Stays} />
        <Route path="/chart-of-accounts" component={ChartOfAccounts} />
        <Route path="/suppliers" component={Suppliers} />
        <Route path="/purchases/new" component={PurchaseBill} />
        <Route path="/tables" component={Tables} />
        <Route path="/loyalty" component={Loyalty} />
        <Route path="/users" component={Users} />
        <Route path="/settings" component={Settings} />
        <Route path="/staff" component={Staff} />
        <Route path="/" component={Dashboard} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <AuthProvider>
            <NotificationProvider>
              <Router />
            </NotificationProvider>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
