"use client";

import { useEffect, useState } from "react";

type Toast = { kind: "ok" | "err"; text: string };

const TOAST_KEY = "isat-sync-toast";

export function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // Restore short summary after reload so layout never holds a long message.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(TOAST_KEY);
      if (!raw) return;
      sessionStorage.removeItem(TOAST_KEY);
      const parsed = JSON.parse(raw) as Toast;
      if (parsed?.text) setToast(parsed);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function onSync() {
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        summary?: string;
        error?: string;
      };

      if (!res.ok || data.ok === false) {
        setToast({
          kind: "err",
          text: data.summary || data.error || "Sync failed",
        });
        return;
      }

      const next: Toast = {
        kind: "ok",
        text: data.summary || "Synced",
      };
      try {
        sessionStorage.setItem(TOAST_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      window.location.reload();
    } catch (e) {
      setToast({
        kind: "err",
        text: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onSync}
        disabled={busy}
        className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
      {toast && (
        <div
          role="status"
          title={toast.text}
          className={`absolute right-0 top-full z-20 mt-2 max-w-[min(18rem,calc(100vw-2rem))] truncate rounded-md border px-3 py-1.5 text-xs shadow-sm ${
            toast.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
