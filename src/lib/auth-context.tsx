"use client";

import React, { createContext, useContext, useState } from "react";

// Mock User Type
export type User = {
  id: string;
  name: string;
  email: string;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Mock logged-in state. This will be replaced with real auth (e.g., NextAuth/Clerk) later.
  const [user] = useState<User | null>({
    id: "usr_mock_123456",
    name: "FinPilot Alpha User",
    email: "alpha@finpilot.io",
  });

  return (
    <AuthContext.Provider value={{ user, isLoading: false }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
