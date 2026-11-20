"use client";

/**
 * alertsService.ts
 * Unified client-side service for FinPilot portfolio alerts.
 * Communicates with /api/alerts (backed by PostgreSQL) with real-time dispatch,
 * and seamlessly synchronizes with Firestore.
 */

import { authenticatedFetch } from "@/lib/authenticated-fetch";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  writeBatch,
  query,
  orderBy,
  getDocs,
  Unsubscribe,
} from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertType = "news" | "filing" | "regulatory";

export interface StockAlert {
  id: string;
  userId: string;
  stock: string;       // bare ticker e.g. "AXISBANK"
  type: AlertType;
  headline: string;
  source?: string;
  timestamp: string;   // ISO 8601
  read: boolean;
  /** Where the alert came from (filing PDF, article or in-app page). */
  url?: string;
}

const ALERTS_UPDATE_EVENT = "finpilot:alerts_updated";

// ─── Real-time subscription ───────────────────────────────────────────────────

export function subscribeToUserAlerts(
  userId: string,
  callback: (alerts: StockAlert[]) => void
): Unsubscribe {
  let active = true;

  // 1. Fetch from server API
  const fetchFromServer = async () => {
    try {
      const res = await authenticatedFetch("/api/alerts");
      if (!res.ok) return;
      const data = await res.json();
      if (active && Array.isArray(data?.alerts)) {
        callback(data.alerts);
      }
    } catch {
      // ignore
    }
  };

  void fetchFromServer();

  // 2. Poll every 8 seconds
  const interval = setInterval(() => {
    void fetchFromServer();
  }, 8_000);

  // 3. Listen for immediate local updates
  const handleLocalUpdate = () => {
    void fetchFromServer();
  };
  window.addEventListener(ALERTS_UPDATE_EVENT, handleLocalUpdate);

  // 4. Also try Firestore listener if available (gracefully catching errors)
  let firestoreUnsub: (() => void) | null = null;
  try {
    const alertsRef = collection(firebaseDb, "user_alerts", userId, "alerts");
    const q = query(alertsRef, orderBy("timestamp", "desc"));
    firestoreUnsub = onSnapshot(
      q,
      (snap) => {
        if (!active) return;
        if (!snap.empty) {
          const fsAlerts: StockAlert[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<StockAlert, "id">),
          }));
          callback(fsAlerts);
        }
      },
      () => {
        // Suppress Firestore errors (e.g. if Firestore API is disabled in project)
      }
    );
  } catch {
    // ignore
  }

  return () => {
    active = false;
    clearInterval(interval);
    window.removeEventListener(ALERTS_UPDATE_EVENT, handleLocalUpdate);
    if (firestoreUnsub) {
      firestoreUnsub();
    }
  };
}

// ─── Mark read ────────────────────────────────────────────────────────────────

export async function markAlertRead(userId: string, alertId: string): Promise<void> {
  // Update backend
  try {
    await authenticatedFetch("/api/alerts", {
      method: "POST",
      body: JSON.stringify({ alertId }),
    });
  } catch {
    // ignore
  }

  // Update Firestore if available
  try {
    const alertRef = doc(firebaseDb, "user_alerts", userId, "alerts", alertId);
    await updateDoc(alertRef, { read: true });
  } catch {
    // ignore
  }

  // Notify listeners immediately
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ALERTS_UPDATE_EVENT));
  }
}

export async function markAllAlertsRead(userId: string): Promise<void> {
  // Update backend
  try {
    await authenticatedFetch("/api/alerts", {
      method: "POST",
      body: JSON.stringify({ all: true }),
    });
  } catch {
    // ignore
  }

  // Update Firestore if available
  try {
    const alertsRef = collection(firebaseDb, "user_alerts", userId, "alerts");
    const snap = await getDocs(alertsRef);
    const batch = writeBatch(firebaseDb);
    snap.docs.forEach((d) => {
      if (!d.data().read) {
        batch.update(d.ref, { read: true });
      }
    });
    await batch.commit();
  } catch {
    // ignore
  }

  // Notify listeners immediately
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ALERTS_UPDATE_EVENT));
  }
}
