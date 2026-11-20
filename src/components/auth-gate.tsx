"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useAdmin } from "@/lib/admin-context";
import { GlobalNav } from "@/components/global-nav";
import { isAdminSectionPath, postLoginTarget } from "@/lib/post-login-target";

const PUBLIC_PATHS = new Set(["/sign-in", "/sign-up", "/forgot-password"]);

/**
 * What a signed-in user sees while Firebase restores the session (a few hundred ms on a cold load). It has the same
 * header and ticker heights as the real navigation, so the page no longer pops from an empty grey screen into a
 * fully drawn one and nothing below it moves when the real navigation replaces it.
 */
function ShellSkeleton() {
  return (
    <div className="w-full min-h-screen flex flex-col bg-gray-50 dark:bg-slate-950" aria-busy="true" aria-label="Loading">
      <div className="h-[70px] shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 sm:px-6 lg:px-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/finpilot-brand-logo-transparent.webp" alt="FinPilot" width={139} height={34} style={{ height: "34px", width: "auto" }} />
      </div>
      <div className="h-[36px] shrink-0 bg-[#0a0f1d] border-b border-slate-800" />
      <div className="h-0.5 w-full overflow-hidden bg-transparent">
        <div className="h-full w-1/3 bg-blue-500/70 animate-pulse" />
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { isAdmin, isLoading: isAdminLoading } = useAdmin();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.has(pathname);
  const isLoading = isAuthLoading || isAdminLoading;
  const isAuthenticated = Boolean(user) || isAdmin;

  useEffect(() => {
    if (isLoading) return;

    // The admin-section pages are for administrators: a signed-in normal user goes Home, a visitor goes to sign-in
    if (isAdminSectionPath(pathname) && !isAdmin) {
      router.replace(isAuthenticated ? "/home" : "/sign-in");
      return;
    }

    // Direct access to home/root by an authenticated admin automatically routes to Admin Dashboard
    if (
      isAdmin &&
      (pathname === "/" ||
        (pathname === "/home" &&
          typeof window !== "undefined" &&
          !window.location.search.includes("preview=user")))
    ) {
      router.replace("/admin");
      return;
    }

    if (!isAuthenticated && !isPublic) {
      // remember where the visitor was going, except admin-section pages: whoever signs in next may not be an admin
      const nextPath = pathname === "/" ? "/home" : pathname;
      router.replace(isAdminSectionPath(nextPath) ? "/sign-in" : `/sign-in?next=${encodeURIComponent(nextPath)}`);
    } else if (isAuthenticated && isPublic) {
      const target = postLoginTarget(new URLSearchParams(window.location.search).get("next"), isAdmin);
      router.replace(target);
    }
  }, [isLoading, isAuthenticated, isAdmin, isPublic, pathname, router]);

  // Warm up the page the visitor is about to land on, so the hop after sign-in does not wait for its code to download.
  useEffect(() => {
    if (isLoading) return;
    if (isPublic && !isAuthenticated) {
      router.prefetch("/home");
      router.prefetch("/admin");
    }
  }, [isLoading, isPublic, isAuthenticated, router]);

  // The effect above redirects in these cases. Until the new page has taken over, show the loading shell rather than
  // drawing the navigation around a page the visitor is leaving (this was the half-loaded sign-in page behind a full
  // navbar right after signing in with Google).
  const previewingUser = typeof window !== "undefined" && window.location.search.includes("preview=user");
  const redirecting =
    !isLoading &&
    ((isAuthenticated && isPublic) ||
      (isAdminSectionPath(pathname) && !isAdmin) ||
      (isAdmin && (pathname === "/" || (pathname === "/home" && !previewingUser))));

  if (isLoading || (!isAuthenticated && !isPublic) || redirecting) {
    return isPublic && !redirecting ? <div className="min-h-screen bg-gray-50 dark:bg-slate-950" aria-busy="true" /> : <ShellSkeleton />;
  }
  if (!isAuthenticated) return <>{children}</>;

  return (
    <div className="w-full min-h-screen flex flex-col bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <GlobalNav />
      <main className="w-full flex-1 min-h-0 flex flex-col">{children}</main>
    </div>
  );
}
