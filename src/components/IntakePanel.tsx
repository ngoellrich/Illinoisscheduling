"use client";

import { useEffect, useState, useTransition } from "react";
import { setIntakeCalendar, syncNow } from "@/app/admin/actions";

interface Cal {
  id: string;
  summary: string;
  primary: boolean;
}

export default function IntakePanel({
  connected,
  googleEmail,
  currentCalendarId,
  watching,
  expiration,
}: {
  connected: boolean;
  googleEmail: string | null;
  currentCalendarId: string | null;
  watching: boolean;
  expiration: string | null;
}) {
  const [cals, setCals] = useState<Cal[]>([]);
  const [loadingCals, setLoadingCals] = useState(false);
  const [syncing, startSync] = useTransition();
  const [syncMsg, setSyncMsg] = useState("");

  useEffect(() => {
    if (!connected) return;
    setLoadingCals(true);
    fetch("/api/google/calendars")
      .then((r) => r.json())
      .then((d) => setCals(d.calendars || []))
      .finally(() => setLoadingCals(false));
  }, [connected]);

  if (!connected) {
    return (
      <div className="card">
        <h2 className="font-semibold">Intake calendar</h2>
        <p className="mt-1 text-sm text-slate-600">
          Connect the Google account whose calendar your appointments land on. New events there
          get auto-assigned to a rep.
        </p>
        <a href="/api/google/connect" className="btn-primary mt-3">
          Connect Google Calendar
        </a>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Intake calendar</h2>
        <span className="text-xs text-slate-500">connected as {googleEmail}</span>
      </div>

      <form action={setIntakeCalendar} className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="label">Source calendar</label>
          <select name="calendarId" className="input" defaultValue={currentCalendarId || ""} required>
            <option value="" disabled>
              {loadingCals ? "Loading calendars…" : "Select a calendar"}
            </option>
            {cals.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
                {c.primary ? " (primary)" : ""}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary" type="submit">
          Use this calendar
        </button>
      </form>

      {currentCalendarId && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <span
            className={`pill ${watching ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}
          >
            {watching ? "Live (push enabled)" : "Manual / cron sync"}
          </span>
          {expiration && watching && (
            <span className="text-xs text-slate-400">push renews by {expiration}</span>
          )}
          <button
            type="button"
            className="btn-ghost"
            disabled={syncing}
            onClick={() =>
              startSync(async () => {
                const created = await syncNow();
                setSyncMsg(created > 0 ? `Imported ${created} new appointment(s).` : "No new events.");
              })
            }
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          {syncMsg && <span className="text-sm text-slate-600">{syncMsg}</span>}
        </div>
      )}
      {!watching && currentCalendarId && (
        <p className="mt-2 text-xs text-slate-400">
          Live push isn't active (normal on localhost or before deploy). Appointments still import
          via the scheduled sync and the “Sync now” button.
        </p>
      )}
    </div>
  );
}
