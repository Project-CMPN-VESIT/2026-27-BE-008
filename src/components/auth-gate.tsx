"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";

const PUBLIC_PATHS = new Set(["/sign-in", "/sign-up", "/forgot-password"]);

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (!isLoading && !user && !isPublic) {
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
    } else if (!isLoading && user && isPublic) {
      const requested = new URLSearchParams(window.location.search).get("next");
      router.replace(requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/");
    }
  }, [isLoading, user, isPublic, pathname, router]);

  if (isLoading || (!user && !isPublic)) {
    return <div className="min-h-screen bg-gray-50 dark:bg-slate-950" aria-busy="true" />;
  }
  if (!user) return <>{children}</>;
  return <><Sidebar /><div className="app-shell min-h-screen"><TopBar /><main>{children}</main></div></>;
}
