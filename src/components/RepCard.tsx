"use client";

import { useState } from "react";
import AvailabilityEditor, { Window } from "./AvailabilityEditor";
import {
  updateRep,
  removeRep,
  saveAvailability,
  addTimeOff,
  removeTimeOff,
} from "@/app/admin/actions";

export interface TimeOffItem {
  id: string;
  label: string;
}

export interface RepCardData {
  id: string;
  name: string | null;
  email: string;
  weeklyCap: number;
  active: boolean;
  googleCalendarId: string | null;
  weekCount: number;
}

export interface CalendarChoice {
  id: string;
  summary: string;
  canWrite: boolean;
}

export default function RepCard({
  rep,
  windows,
  calendars,
  timeOff,
}: {
  rep: RepCardData;
  windows: Window[];
  calendars: CalendarChoice[];
  timeOff: TimeOffItem[];
}) {
  const [showAvail, setShowAvail] = useState(false);
  const [showTimeOff, setShowTimeOff] = useState(false);
  const full = rep.weekCount >= rep.weeklyCap;
  const mapped = calendars.find((c) => c.id === rep.googleCalendarId);

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold">
            {rep.name || rep.email}
            {!rep.active && (
              <span className="pill ml-2 bg-slate-200 text-slate-600">inactive</span>
            )}
          </div>
          <div className="text-sm text-slate-500">{rep.email}</div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span
              className={`pill ${
                rep.googleCalendarId ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {rep.googleCalendarId
                ? `Calendar: ${mapped?.summary || rep.googleCalendarId}`
                : "No calendar mapped"}
            </span>
            <span className={`pill ${full ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
              {rep.weekCount}/{rep.weeklyCap} this week
            </span>
          </div>
        </div>
      </div>

      <form action={updateRep} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={rep.id} />
        <div className="min-w-[240px] flex-1">
          <label className="label text-xs">Rep's calendar</label>
          <select
            name="calendarId"
            defaultValue={mapped ? rep.googleCalendarId || "" : ""}
            className="input"
          >
            <option value="">— not mapped —</option>
            {calendars.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.canWrite}>
                {c.summary}
                {c.canWrite ? "" : " (read-only — need edit access)"}
              </option>
            ))}
          </select>
          <input
            name="calendarIdManual"
            className="input mt-1 text-xs"
            placeholder="…or paste Calendar ID (overrides the dropdown)"
            defaultValue={mapped ? "" : rep.googleCalendarId || ""}
          />
        </div>
        <div>
          <label className="label text-xs">Weekly cap</label>
          <input
            name="weeklyCap"
            type="number"
            min={0}
            defaultValue={rep.weeklyCap}
            className="input w-20"
          />
        </div>
        <label className="flex items-center gap-1 pb-2 text-sm text-slate-600">
          <input type="checkbox" name="active" defaultChecked={rep.active} />
          Active
        </label>
        <button className="btn-ghost" type="submit">
          Save
        </button>
      </form>

      <div className="mt-3 flex items-center gap-4">
        <button className="text-sm font-medium text-brand-dark" onClick={() => setShowAvail((s) => !s)}>
          {showAvail ? "Hide availability" : "Edit availability"}
        </button>
        <button
          className="text-sm font-medium text-brand-dark"
          onClick={() => setShowTimeOff((s) => !s)}
        >
          {showTimeOff ? "Hide time off" : `Time off${timeOff.length ? ` (${timeOff.length})` : ""}`}
        </button>
        <form action={removeRep}>
          <input type="hidden" name="id" value={rep.id} />
          <button className="text-sm text-red-600 hover:underline" type="submit">
            Remove
          </button>
        </form>
      </div>

      {showAvail && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-2 text-xs text-slate-500">
            Recurring weekly hours the rep can take appointments.
          </p>
          <AvailabilityEditor windows={windows} action={(w) => saveAvailability(rep.id, w)} />
        </div>
      )}

      {showTimeOff && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-2 text-xs text-slate-500">
            One-off blocks when this rep can&apos;t take appointments (vacation, a busy
            afternoon, etc.). The scheduler won&apos;t book them during these, and will move any
            already-assigned appointment that a new block covers.
          </p>

          {timeOff.length > 0 && (
            <ul className="mb-3 space-y-1">
              {timeOff.map((t) => (
                <li key={t.id} className="flex items-center justify-between text-sm">
                  <span>{t.label}</span>
                  <form action={removeTimeOff}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="text-xs text-red-600 hover:underline" type="submit">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={addTimeOff} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="repId" value={rep.id} />
            <div>
              <label className="label text-xs">From</label>
              <input type="datetime-local" name="start" required className="input" />
            </div>
            <div>
              <label className="label text-xs">To</label>
              <input type="datetime-local" name="end" required className="input" />
            </div>
            <div className="min-w-[140px] flex-1">
              <label className="label text-xs">Reason (optional)</label>
              <input name="reason" className="input" placeholder="Vacation, appt, etc." />
            </div>
            <button className="btn-ghost" type="submit">
              Add block
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
