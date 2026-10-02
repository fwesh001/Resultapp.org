"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Online/offline status for the grading UI.
 *
 * WHY THE `null` TRI-STATE
 * `isOnline` is `null` until the first client-side read, so the UI can avoid
 * flashing "Offline" during SSR/hydration. Callers must treat `null` as
 * "unknown, proceed anyway" rather than "offline".
 *
 * CAVEAT — `navigator.onLine` IS LINK-LAYER ONLY. It reports whether the
 * device has a network interface, NOT whether anything is reachable: a WiFi
 * connection with no upstream, or a captive portal, both report `true`. So
 * this hook is a fast pre-check that avoids a doomed request; it is never a
 * substitute for handling a failed fetch. Every save path must still keep its
 * draft when the actual POST fails.
 */
export interface OnlineStatus {
  /** null = not yet determined on the client. */
  isOnline: boolean | null;
  /** When the current state was observed (epoch ms), for display. */
  since: number | null;
}

export function useOnlineStatus(): OnlineStatus {
  const [status, setStatus] = useState<OnlineStatus>({ isOnline: null, since: null });

  const read = useCallback(() => {
    if (typeof navigator === "undefined") return;
    setStatus({ isOnline: navigator.onLine === true, since: Date.now() });
  }, []);

  useEffect(() => {
    read();
    const goOnline = () => setStatus({ isOnline: true, since: Date.now() });
    const goOffline = () => setStatus({ isOnline: false, since: Date.now() });
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [read]);

  return status;
}

/**
 * Convenience for save handlers: returns a getter that is safe to call during
 * an event handler (not render). Returns true when we cannot prove we are
 * offline, so an undetermined state never silently blocks a save.
 */
export function useIsOffline(): () => boolean {
  const status = useOnlineStatus();
  const ref = useRef(status);
  useEffect(() => {
    ref.current = status;
  }, [status]);
  return useCallback(() => ref.current.isOnline === false, []);
}
