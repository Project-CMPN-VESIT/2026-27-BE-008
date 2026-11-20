"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  User as FirebaseUser,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";

export type User = { id: string; name: string; email: string; photoURL?: string; emailVerified: boolean };

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string>;
};

const AuthContext = createContext<AuthContextType | null>(null);

function toUser(user: FirebaseUser): User {
  return {
    id: user.uid,
    email: user.email ?? "",
    name: user.displayName ?? user.email?.split("@")[0] ?? "FinPilot user",
    photoURL: user.photoURL ?? undefined,
    emailVerified: user.emailVerified,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(firebaseAuth, (firebaseUser) => {
      setUser(firebaseUser ? toUser(firebaseUser) : null);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => { await signInWithEmailAndPassword(firebaseAuth, email, password); }, []);
  const signUp = useCallback(async (email: string, password: string) => { await createUserWithEmailAndPassword(firebaseAuth, email, password); }, []);
  const signInWithGoogle = useCallback(async () => { await signInWithPopup(firebaseAuth, new GoogleAuthProvider()); }, []);
  const sendPasswordReset = useCallback(async (email: string) => { await sendPasswordResetEmail(firebaseAuth, email); }, []);
  const signOut = useCallback(async () => { await firebaseSignOut(firebaseAuth); }, []);
  const getIdToken = useCallback(async () => {
    if (!firebaseAuth.currentUser) throw new Error("Sign in is required");
    return firebaseAuth.currentUser.getIdToken();
  }, []);

  const value = useMemo<AuthContextType>(() => ({
    user,
    isLoading,
    signIn, signUp, signInWithGoogle, sendPasswordReset, signOut, getIdToken,
  }), [user, isLoading, signIn, signUp, signInWithGoogle, sendPasswordReset, signOut, getIdToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
