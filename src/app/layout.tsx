import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Bebas_Neue, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
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

const bebasNeue = Bebas_Neue({
  weight: "400",
  variable: "--font-bebas",
  subsets: ["latin"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  variable: "--font-ibm-mono",
  subsets: ["latin"],
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  weight: ["300", "400", "500", "600"],
  variable: "--font-ibm-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FinPilot — AI Equity Research Platform",
  description:
    "Institutional-grade, AI-driven equity research grounded in primary regulatory filings (NSE/BSE).",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.png", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
};

import { AuthProvider } from "@/lib/auth-context";
import { AdminProvider } from "@/lib/admin-context";
import { AuthGate } from "@/components/auth-gate";
import { UserPreferenceSync } from "@/components/user-preference-sync";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} ${bebasNeue.variable} ${ibmPlexMono.variable} ${ibmPlexSans.variable} antialiased bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100`}
      >
        <ThemeProvider>
          <AuthProvider>
            <AdminProvider>
            <UserPreferenceSync />
            <AuthGate>
              {children}
            </AuthGate>
            </AdminProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
