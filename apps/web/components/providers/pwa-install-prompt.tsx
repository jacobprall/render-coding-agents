"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/**
 * BeforeInstallPromptEvent — non-standard, Chromium-only.
 * Safari/iOS install via "Add to Home Screen" only; this banner stays hidden there.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  prompt(): Promise<void>;
}

const DISMISSED_KEY = "pwa:install-dismissed";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    return Number.isFinite(ts) && Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // ignore quota errors
  }
}

/**
 * Floating banner that asks the user to install the PWA.
 *
 * Only shown when:
 *   - browser fires the `beforeinstallprompt` event (Chromium-based)
 *   - user has not dismissed in the past week
 *   - app is not already running in standalone mode
 *
 * Anchored to the bottom-right thumb zone above the mobile nav.
 */
export function PwaInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isRecentlyDismissed()) return;
    if (
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone
    ) {
      return;
    }

    function handleBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    }

    function handleInstalled() {
      setVisible(false);
      setDeferred(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (!visible || !deferred) return null;

  async function handleInstall() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setVisible(false);
    setDeferred(null);
  }

  function handleDismiss() {
    markDismissed();
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Install Coding Agents"
      className="fixed inset-x-3 bottom-3 z-40 flex items-center gap-3 border border-border bg-card p-3 shadow-2xl md:bottom-4 md:left-auto md:right-4 md:max-w-sm"
      style={{ bottom: "calc(56px + var(--safe-area-bottom, 0px) + 12px)" }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-primary/15 text-primary">
        <Download className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Install Coding Agents</p>
        <p className="text-[12px] text-muted-foreground">
          Faster launches, full-screen, and home-screen access.
        </p>
      </div>
      <button
        type="button"
        onClick={handleInstall}
        className="inline-flex h-10 shrink-0 items-center justify-center bg-primary px-3 text-xs font-semibold text-white transition-colors active:bg-primary/80"
      >
        Install
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
        className="flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
