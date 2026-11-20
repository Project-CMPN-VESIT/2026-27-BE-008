"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

export interface AdminUser {
  username: string;
  role: "super_admin" | "admin";
  displayName: string;
  email: string;
  loggedInAt: string;
}

interface AdminContextType {
  isAdmin: boolean;
  adminUser: AdminUser | null;
  isLoading: boolean;
  loginAsAdmin: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logoutAdmin: () => void;
}

const AdminContext = createContext<AdminContextType | null>(null);

const STORAGE_KEY = "finpilot_admin_session";
const COOKIE_KEY = "finpilot_admin_auth";

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const router = useRouter();

  // Restore the session on mount, but only if the server still recognises it (the cookie may have expired)
  useEffect(() => {
    let alive = true;
    const clearLocal = () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
        document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
      } catch {
        // ignore
      }
    };
    (async () => {
      try {
        const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        if (!stored) return;
        const parsed = JSON.parse(stored) as AdminUser;
        if (!parsed || parsed.username !== "admin") return;
        let valid = true; // a network blip or a restarting server must not sign the admin out
        try {
          const res = await fetch("/api/admin/session", { cache: "no-store" });
          if (res.status === 401 || res.status === 403) valid = false;
          else if (res.ok) valid = (await res.json()).ok === true;
        } catch {
          valid = true;
        }
        if (!alive) return;
        if (valid) {
          setIsAdmin(true);
          setAdminUser(parsed);
        } else {
          clearLocal();
        }
      } catch {
        // ignore parse / network errors: the visitor simply stays signed out
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loginAsAdmin = useCallback(async (username: string, password: string) => {
    // Credentials are verified on the server, which also issues the signed session cookie
    let verified = false;
    let serverError = "";
    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      verified = res.ok && data.ok === true;
      serverError = typeof data.error === "string" ? data.error : "";
    } catch {
      serverError = "Could not reach the server. Please try again.";
    }

    if (verified) {
      const userObj: AdminUser = {
        username: "admin",
        role: "super_admin",
        displayName: "System Administrator",
        email: "admin@finpilot.internal",
        loggedInAt: new Date().toISOString(),
      };

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(userObj));
        // Also set a document cookie for SSR compatibility
        document.cookie = `${COOKIE_KEY}=true; path=/; max-age=86400; SameSite=Lax`;
      } catch {
        // LocalStorage may fail in private browsing
      }

      setIsAdmin(true);
      setAdminUser(userObj);
      return { success: true };
    }

    return {
      success: false,
      error: serverError || "Invalid admin credentials. Please verify your username and password.",
    };
  }, []);

  const logoutAdmin = useCallback(() => {
    void fetch("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
    try {
      localStorage.removeItem(STORAGE_KEY);
      document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
    } catch {
      // Ignore
    }
    setIsAdmin(false);
    setAdminUser(null);
    router.push("/sign-in");
  }, [router]);

  return (
    <AdminContext.Provider
      value={{
        isAdmin,
        adminUser,
        isLoading,
        loginAsAdmin,
        logoutAdmin,
      }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error("useAdmin must be used within an AdminProvider");
  }
  return context;
}

