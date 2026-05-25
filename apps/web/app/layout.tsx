import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { RouteProgress } from "@/components/layout/route-progress";
import { AuthSessionProvider } from "@/components/providers/auth-session-provider";
import { ServiceWorkerRegistration } from "@/components/providers/service-worker-registration";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0d",
};

export const metadata: Metadata = {
  title: {
    default: "Coding Agents",
    template: "%s | Coding Agents",
  },
  description: "Self-hosted agentic forge",
  manifest: "/manifest.json",
  applicationName: "Coding Agents",
  appleWebApp: {
    capable: true,
    title: "Agents",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <RouteProgress />
        <ServiceWorkerRegistration />
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}
