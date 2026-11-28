// A new version is ready (owner, 2026-11-28): every build writes its id to /version.json (vite.config.ts). An open page
// checks it when the person comes back to the tab and every 5 minutes, and offers a Refresh. It never reloads by itself,
// so nobody loses a bill or a form they are typing.
import { useEffect, useState } from "react";

declare const __BUILD_ID__: string;
const CHECK_EVERY_MS = 5 * 60_000;

export function UpdateNotice() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store" });
        if (r.ok) { const d = await r.json(); if (d?.buildId && d.buildId !== __BUILD_ID__) setReady(true); }
      } catch { /* offline: try again later */ } finally { busy = false; }
    };
    const t = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", check); window.removeEventListener("focus", check); };
  }, []);
  if (!ready) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-lg border bg-white px-4 py-3 text-sm text-neutral-900 shadow-lg">
      <span className="flex-1">A new version of the app is ready. Refresh when you have finished what you are doing.</span>
      <button className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white" onClick={() => window.location.reload()}>Refresh</button>
      <button className="text-neutral-500 underline" onClick={() => setReady(false)}>Later</button>
    </div>
  );
}
