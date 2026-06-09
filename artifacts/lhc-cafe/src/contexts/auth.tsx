import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useGetMe, useLogin, useLogout } from "@workspace/api-client-react";
import type { LoginInput, User } from "@workspace/api-client-react";
import { useLocation } from "wouter";

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (data: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem("lhc_token"));
  const [, setLocation] = useLocation();

  const { data: user, isLoading: isUserLoading } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
    },
  });

  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  const login = async (data: LoginInput) => {
    const result = await loginMutation.mutateAsync({ data });
    localStorage.setItem("lhc_token", result.token);
    setToken(result.token);
    setLocation("/dashboard");
  };

  const logout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } finally {
      localStorage.removeItem("lhc_token");
      setToken(null);
      setLocation("/login");
    }
  };

  useEffect(() => {
    // If token is missing, but user tries to access a protected route, redirect to login
    // Note: Public routes like /order/:tableId don't use this layout, so they are safe.
    if (!token && window.location.pathname !== "/login" && !window.location.pathname.startsWith("/order/")) {
      setLocation("/login");
    }
  }, [token, setLocation]);

  return (
    <AuthContext.Provider value={{ user: user ?? null, token, login, logout, isLoading: isUserLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
