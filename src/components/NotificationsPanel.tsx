"use client";

import { useCallback, useEffect, useState } from "react";

interface Notif {
  id: string;
  message: string;
  createdAt: string;
}

export default function NotificationsPanel() {
  const [notifs, setNotifs] = useState<Notif[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/notifications", { cache: "no-store" });
    if (res.ok) setNotifs((await res.json()).notifications || []);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // poll for new assignments
    return () => clearInterval(t);
  }, [load]);

  async function dismiss(id?: string) {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: id ? JSON.stringify({ id }) : undefined,
    });
    load();
  }

  if (notifs.length === 0) {
    return <p className="text-sm text-slate-500">No new notifications.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button onClick={() => dismiss()} className="text-xs text-slate-500 hover:underline">
          Mark all read
        </button>
      </div>
      {notifs.map((n) => (
        <div
          key={n.id}
          className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm"
        >
          <div>
            <div className="text-slate-800">{n.message}</div>
            <div className="text-xs text-slate-400">
              {new Date(n.createdAt).toLocaleString()}
            </div>
          </div>
          <button onClick={() => dismiss(n.id)} className="btn-ghost px-2 py-1 text-xs">
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
