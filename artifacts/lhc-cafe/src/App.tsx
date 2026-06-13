import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/auth";
import NotFound from "@/pages/not-found";
import { Sidebar } from "@/components/layout/Sidebar";

import Dashboard from "@/pages/dashboard";
import POS from "@/pages/pos";
import Orders from "@/pages/orders";
import OrderLog from "@/pages/order-log";
import Menu from "@/pages/menu";
import Inventory from "@/pages/inventory";
import Tables from "@/pages/tables";
import Loyalty from "@/pages/loyalty";
import Settings from "@/pages/settings";
import Users from "@/pages/users";
import Login from "@/pages/login";
import PublicOrder from "@/pages/public-order";

function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return null; // Will redirect to login

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

const queryClient = new QueryClient();

function Router() {
  const { token, isLoading } = useAuth();
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

  // Protected routes
  return (
    <AppLayout>
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/pos" component={POS} />
        <Route path="/orders" component={Orders} />
        <Route path="/order-log" component={OrderLog} />
        <Route path="/menu" component={Menu} />
        <Route path="/inventory" component={Inventory} />
        <Route path="/tables" component={Tables} />
        <Route path="/loyalty" component={Loyalty} />
        <Route path="/users" component={Users} />
        <Route path="/settings" component={Settings} />
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
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
