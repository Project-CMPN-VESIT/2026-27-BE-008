import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FinPilot — AI Equity Research Platform",
  description:
    "Institutional-grade, AI-driven equity research grounded in primary regulatory filings (NSE/BSE).",
};

import { AuthProvider } from "@/lib/auth-context";
import { AuthGate } from "@/components/auth-gate";
import { UserPreferenceSync } from "@/components/user-preference-sync";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100`}
      >
        <ThemeProvider>
          <AuthProvider>
            <UserPreferenceSync />
            <AuthGate>
              {children}
            </AuthGate>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
