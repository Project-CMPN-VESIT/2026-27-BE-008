"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

type Mode = "sign-in" | "sign-up" | "forgot-password";

export function AuthForm({ mode }: { mode: Mode }) {
  const { signIn, signUp, signInWithGoogle, sendPasswordReset } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isReset = mode === "forgot-password";
  const isSignup = mode === "sign-up";

  const complete = () => {
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (isReset) {
        await sendPasswordReset(email);
        setNotice("If an account exists for that email, a reset link has been sent.");
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
    try { await signInWithGoogle(); complete(); }
    catch (e) { setError(e instanceof Error ? e.message : "Google sign-in failed."); }
    finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-slate-50 p-4 sm:p-6 dark:bg-slate-950">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 shadow-md shadow-blue-500/20">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                FinPilot
              </span>
              <span className="text-[10px] font-semibold tracking-wider text-slate-400 dark:text-slate-500 uppercase">
                Equity Research
              </span>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {isReset ? "Reset your password" : isSignup ? "Create your account" : "Sign in to FinPilot"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">Your research, preferences, and paper portfolio stay with your account.</p>
        </div>
        {!isReset && <button type="button" onClick={google} disabled={busy} className="mb-5 w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">Continue with Google</button>}
        {!isReset && <div className="mb-5 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />OR EMAIL<span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /></div>}
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2.5 outline-none focus:border-blue-500 dark:border-slate-700" /></label>
          {!isReset && <label className="block text-sm font-medium">Password<input required minLength={8} type="password" autoComplete={isSignup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2.5 outline-none focus:border-blue-500 dark:border-slate-700" /></label>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
          <button disabled={busy} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? "Please wait…" : isReset ? "Send reset link" : isSignup ? "Create account" : "Sign in"}</button>
        </form>
        <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm text-slate-500">
          {mode !== "sign-in" ? <Link href="/sign-in" className="hover:text-blue-600">Sign in</Link> : <Link href="/forgot-password" className="hover:text-blue-600">Forgot password?</Link>}
          {mode !== "sign-up" && <Link href="/sign-up" className="hover:text-blue-600">Create account</Link>}
        </div>
      </section>
    </main>
  );
}
