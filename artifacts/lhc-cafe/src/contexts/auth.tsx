import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { useGetMe, useLogin, useLogout } from "@workspace/api-client-react";
import type { LoginInput, User } from "@workspace/api-client-react";
import { useLocation } from "wouter";

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (data: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: (newToken: string) => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Decode the exp claim from a JWT without a library (base64 decode only).
function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const exp = getTokenExpiry(token);
  return exp !== null && Date.now() >= exp;
}

function getValidToken(): string | null {
  const stored = localStorage.getItem("lhc_token");
  if (!stored || isTokenExpired(stored)) {
    if (stored) localStorage.removeItem("lhc_token");
    return null;
  }
  return stored;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(getValidToken);
  const [, setLocation] = useLocation();

  const { data: user, isLoading: isUserLoading, isError } = useGetMe({
    query: {
      queryKey: ["auth", "me"],
      enabled: !!token,
      retry: false,
    },
  });

  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  const doLogout = useCallback(async (silent = false) => {
    if (!silent) {
      try { await logoutMutation.mutateAsync(); } catch { /* ignore */ }
    }
    localStorage.removeItem("lhc_token");
    setToken(null);
    setLocation("/login");
  }, [logoutMutation, setLocation]);

  // If the token is rejected by the server (e.g. invalidated by a password
  // change), log out immediately instead of leaving the app in a broken
  // half-authenticated state with a stale token and no user data.
  useEffect(() => {
    if (isError && token) {
      doLogout(true);
    }
  }, [isError, token, doLogout]);

  const login = async (data: LoginInput) => {
    const result = await loginMutation.mutateAsync({ data });
    localStorage.setItem("lhc_token", result.token);
    setToken(result.token);
    setLocation("/dashboard");
  };

  const logout = () => doLogout(false);

  // Called after the logged-in user changes their own password. The backend
  // increments tokenVersion (invalidating the old token) and returns a fresh
  // one in the same response — this swaps it in without forcing a re-login.
  const refreshToken = (newToken: string) => {
    localStorage.setItem("lhc_token", newToken);
    setToken(newToken);
  };

  // Check token expiry every 60 s so the session auto-expires in the browser
  // without needing a page reload.
  useEffect(() => {
    if (!token) return;
    const check = () => {
      if (isTokenExpired(token)) doLogout(true);
    };
    check(); // run immediately in case token was already expired
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [token, doLogout]);

  useEffect(() => {
    if (!token && window.location.pathname !== "/login" && !window.location.pathname.startsWith("/order/")) {
      setLocation("/login");
    }
  }, [token, setLocation]);

  return (
    <AuthContext.Provider value={{ user: user ?? null, token, login, logout, refreshToken, isLoading: isUserLoading }}>
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
