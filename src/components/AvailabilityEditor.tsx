"use client";

import { useState } from "react";
import { WEEKDAY_LABELS, minToHHMM, hhmmToMin } from "@/lib/time";

export interface Window {
  dayOfWeek: number;
  startMin: number;
  endMin: number;
}

interface DayState {
  enabled: boolean;
  start: string; // HH:MM
  end: string;
}

function initialDays(windows: Window[]): DayState[] {
  // One window per day in the UI (first window wins if multiple exist).
  return Array.from({ length: 7 }, (_, day) => {
    const w = windows.find((x) => x.dayOfWeek === day);
    return w
      ? { enabled: true, start: minToHHMM(w.startMin), end: minToHHMM(w.endMin) }
      : { enabled: false, start: "09:00", end: "17:00" };
  });
}

export default function AvailabilityEditor({
  windows,
  action,
}: {
  windows: Window[];
  action: (windows: Window[]) => Promise<void>;
}) {
  const [days, setDays] = useState<DayState[]>(initialDays(windows));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function update(i: number, patch: Partial<DayState>) {
    setDays((d) => d.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    const payload: Window[] = days
      .map((d, day) => ({
        dayOfWeek: day,
        startMin: hhmmToMin(d.start),
        endMin: hhmmToMin(d.end),
        enabled: d.enabled,
      }))
      .filter((d) => d.enabled && d.endMin > d.startMin)
      .map(({ dayOfWeek, startMin, endMin }) => ({ dayOfWeek, startMin, endMin }));
    await action(payload);
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="space-y-2">
      {days.map((d, i) => (
        <div key={i} className="flex items-center gap-3 text-sm">
          <label className="flex w-28 items-center gap-2">
            <input
              type="checkbox"
              checked={d.enabled}
              onChange={(e) => update(i, { enabled: e.target.checked })}
            />
            <span className="font-medium">{WEEKDAY_LABELS[i]}</span>
          </label>
          <input
            type="time"
            className="input max-w-[120px] disabled:opacity-40"
            value={d.start}
            disabled={!d.enabled}
            onChange={(e) => update(i, { start: e.target.value })}
          />
          <span className="text-slate-400">to</span>
          <input
            type="time"
            className="input max-w-[120px] disabled:opacity-40"
            value={d.end}
            disabled={!d.enabled}
            onChange={(e) => update(i, { end: e.target.value })}
          />
        </div>
      ))}
      <div className="flex items-center gap-3 pt-2">
        <button onClick={save} className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save availability"}
        </button>
        {saved && <span className="text-sm text-green-600">Saved ✓</span>}
      </div>
    </div>
  );
}
