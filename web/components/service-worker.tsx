"use client";

import { useEffect } from "react";

/** Registers /sw.js (installable app + offline page). Skipped in development so it never caches dev builds. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
