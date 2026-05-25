"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker on the client.
 *
 * Disabled in development to avoid stale caches during HMR.
 * The SW caches the app shell + static assets and serves them on repeat visits.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          if (process.env.NODE_ENV !== "production") {
            console.warn("[sw] registration failed", err);
          }
        });
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
