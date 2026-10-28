"use client";

import { useState } from "react";

export function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function onSync() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResult(data.error ?? "Sync failed");
      } else {
        setResult(
          [data.gmail?.message, data.forms?.message].filter(Boolean).join(" · "),
        );
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onSync}
        disabled={busy}
        className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
      {result && (
        <p className="text-xs text-stone-500" role="status">
          {result}
        </p>
      )}
    </div>
  );
}
