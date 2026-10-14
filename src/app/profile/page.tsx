"use client";

import { FormEvent, useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { useAuth } from "@/lib/auth-context";

type Profile = { email: string; display_name: string | null; created_at: string };

export default function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState(user?.name ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void authenticatedFetch("/api/user/profile")
      .then((response) => response.json())
      .then(({ profile: result }) => {
        if (!active || !result) return;
        setProfile(result);
        setDisplayName(result.display_name ?? user?.name ?? "");
      })
      .catch(() => setError("Could not load your profile."));
    return () => { active = false; };
  }, [user?.id, user?.name]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await authenticatedFetch("/api/user/profile", {
        method: "PUT", body: JSON.stringify({ displayName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save profile");
      setProfile(data.profile);
      setMessage("Profile saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save profile.");
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold">Your profile</h1>
      <p className="mt-1 text-sm text-slate-500">Your account identity is managed by Firebase. Profile details and preferences are stored in PostgreSQL.</p>
      <form onSubmit={save} className="mt-8 max-w-xl space-y-5 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <label className="block text-sm font-medium">Display name
          <input value={displayName} maxLength={80} required onChange={(e) => setDisplayName(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2.5 dark:border-slate-700" />
        </label>
        <label className="block text-sm font-medium">Email
          <input value={profile?.email ?? user?.email ?? ""} readOnly className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-500 dark:border-slate-700 dark:bg-slate-800" />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
        <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save profile"}</button>
      </form>
    </div>
  );
}
