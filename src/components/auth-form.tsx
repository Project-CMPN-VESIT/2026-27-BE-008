"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AdminLoginModal } from "@/components/admin/AdminLoginModal";
import { postLoginTarget } from "@/lib/post-login-target";

type Mode = "sign-in" | "sign-up" | "forgot-password";

export function AuthForm({ mode }: { mode: Mode }) {
  const { signIn, signUp, signInWithGoogle, sendPasswordReset } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"sign-in" | "sign-up">(
    mode === "sign-up" ? "sign-up" : "sign-in"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAdminModal, setShowAdminModal] = useState(false);

  const isReset = mode === "forgot-password";
  const isSignup = activeTab === "sign-up";

  const complete = () => {
    router.replace(postLoginTarget(new URLSearchParams(window.location.search).get("next"), false));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (isReset) {
        await sendPasswordReset(email);
        setNotice("If an account exists for that email, a password reset link has been sent.");
      } else {
        if (isSignup) await signUp(email, password);
        else await signIn(email, password);
        complete();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    setError("");
    try {
      await signInWithGoogle();
      complete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen w-full flex items-center justify-center lg:justify-end px-4 sm:px-8 md:px-14 lg:pr-28 xl:pr-36 py-8 overflow-hidden font-sans">
      {/* Top Left: Login as Admin Link (Dark Blue) */}
      <div className="absolute top-6 left-6 sm:top-8 sm:left-10 z-20">
        <button
          type="button"
          onClick={() => setShowAdminModal(true)}
          className="text-[#1E3A8A] hover:text-[#172554] dark:text-blue-400 dark:hover:text-blue-300 font-bold text-sm tracking-tight transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <span>Login as Admin</span>
        </button>
      </div>
      {/* Crystal Clear High-Definition Background (2560x1440) */}
      <div className="absolute inset-0 pointer-events-none select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/auth-bg-hd.webp"
          alt="FinPilot"
          className="w-full h-full object-cover object-left md:object-center"
          style={{
            transform: "translateZ(0)",
            backfaceVisibility: "hidden",
          }}
        />
        {/* the slogan is part of the photo; on a phone it is cropped into stray letters beside the card, so soften it */}
        <div className="absolute inset-0 bg-white/35 backdrop-blur-[3px] md:hidden" />
      </div>

      <div className="relative z-10 w-full max-w-[410px] lg:-translate-x-10 xl:-translate-x-14" style={{ zoom: 1.05 }}>
        {/* Clean Box Container with increased height & comfortable spacing */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl py-8 sm:py-9 px-7 sm:px-8">
          {/* 1. FinPilot Logo Inside Box */}
          <div className="flex justify-center mb-4">
            <Link href="/home" className="inline-block transition-transform hover:scale-[1.02]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/finpilot-brand-logo-transparent.webp"
                alt="FinPilot"
                className="h-9 w-auto object-contain"
              />
            </Link>
          </div>

          {/* 2. Welcome Message */}
          <div className="text-center mb-5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              {isReset ? "Reset Password" : "Welcome to FinPilot"}
            </h1>
          </div>

          {/* 3. Two Options: Sign In and Sign Up (Default Chosen: Sign In) */}
          {!isReset && (
            <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl mb-5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setActiveTab("sign-in");
                  setError("");
                }}
                className={`py-2.5 text-center rounded-lg transition-all cursor-pointer ${
                  activeTab === "sign-in"
                    ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs font-bold"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("sign-up");
                  setError("");
                }}
                className={`py-2.5 text-center rounded-lg transition-all cursor-pointer ${
                  activeTab === "sign-up"
                    ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs font-bold"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                Sign Up
              </button>
            </div>
          )}

          {!isReset && (
            <>
              {/* Google SSO Button */}
              <button
                type="button"
                onClick={google}
                disabled={busy}
                className="w-full flex items-center justify-center space-x-2.5 py-3 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-sm font-medium transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>

              {/* Minimal Divider */}
              <div className="relative my-4.5 text-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                </div>
                <span className="relative bg-white dark:bg-slate-900 px-3 text-xs text-slate-400">
                  or
                </span>
              </div>
            </>
          )}

          {/* Form with increased field height and spacing */}
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-10 pr-3.5 py-2.5 sm:py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 text-sm outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                />
              </div>
            </div>

            {!isReset && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Password
                  </label>
                  {!isSignup && (
                    <Link
                      href="/forgot-password"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Forgot?
                    </Link>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    required
                    minLength={8}
                    type={showPassword ? "text" : "password"}
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-2.5 sm:py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 text-sm outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs"
              >
                {error}
              </div>
            )}
            {notice && (
              <div
                role="status"
                className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-xs"
              >
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 px-4 rounded-xl font-semibold text-sm text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.99] transition-all shadow-sm flex items-center justify-center disabled:opacity-60 cursor-pointer mt-2"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  <span>Please wait…</span>
                </>
              ) : (
                <span>{isReset ? "Send reset link" : isSignup ? "Sign Up" : "Sign In"}</span>
              )}
            </button>
          </form>

          {isReset && (
            <div className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
              <Link href="/sign-in" className="text-blue-600 hover:underline font-medium">
                ← Back to Sign In
              </Link>
            </div>
          )}
        </div>
      </div>
      {/* Admin Login Modal */}
      <AdminLoginModal isOpen={showAdminModal} onClose={() => setShowAdminModal(false)} />
    </main>
  );
}
