"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/auth-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

export function UserPreferenceSync() {
  const { user, isLoading } = useAuth();
  const { theme, setTheme } = useTheme();
  const [readyUid, setReadyUid] = useState("");
  const applyingRemote = useRef(false);
  const currentTheme = useRef(theme);
  currentTheme.current = theme;

  useEffect(() => {
    let active = true;
    setReadyUid("");
    if (isLoading || !user) return () => { active = false; };
    (async () => {
      try {
        const response = await authenticatedFetch("/api/user/preferences");
        if (!response.ok) throw new Error("Preference load failed");
        const { preferences } = await response.json();
        if (!active) return;
        if (["light", "dark"].includes(preferences?.theme)) {
          if (preferences.theme !== currentTheme.current) {
            applyingRemote.current = true;
            setTheme(preferences.theme);
          }
        }
      } catch {
        // Keep the existing browser theme if preferences cannot be loaded.
      } finally {
        if (active) setReadyUid(user.id);
      }
    })();
    return () => { active = false; };
  }, [user?.id, isLoading, setTheme]);

  useEffect(() => {
    if (!user || readyUid !== user.id || !theme) return;
    if (applyingRemote.current) {
      applyingRemote.current = false;
      return;
    }
    void authenticatedFetch("/api/user/preferences", {
      method: "PUT", body: JSON.stringify({ preferences: { theme } }),
    }).catch(() => undefined);
  }, [theme, user?.id, readyUid]);

  return null;
}
