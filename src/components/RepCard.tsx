"use client";

import { useState } from "react";
import AvailabilityEditor, { Window } from "./AvailabilityEditor";
import { updateRep, removeRep, saveAvailability } from "@/app/admin/actions";

export interface RepCardData {
  id: string;
  name: string | null;
  email: string;
  weeklyCap: number;
  active: boolean;
  googleConnected: boolean;
  weekCount: number;
}

export default function RepCard({ rep, windows }: { rep: RepCardData; windows: Window[] }) {
  const [showAvail, setShowAvail] = useState(false);
  const full = rep.weekCount >= rep.weeklyCap;

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
                rep.googleConnected ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {rep.googleConnected ? "Google connected" : "Google not connected"}
            </span>
            <span className={`pill ${full ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
              {rep.weekCount}/{rep.weeklyCap} this week
            </span>
          </div>
        </div>

        <form action={updateRep} className="flex items-center gap-2">
          <input type="hidden" name="id" value={rep.id} />
          <label className="text-sm text-slate-600">
            Cap
            <input
              name="weeklyCap"
              type="number"
              min={0}
              defaultValue={rep.weeklyCap}
              className="input ml-1 inline w-16"
            />
          </label>
          <label className="flex items-center gap-1 text-sm text-slate-600">
            <input type="checkbox" name="active" defaultChecked={rep.active} />
            Active
          </label>
          <button className="btn-ghost px-3 py-1.5" type="submit">
            Save
          </button>
        </form>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button className="text-sm font-medium text-brand-dark" onClick={() => setShowAvail((s) => !s)}>
          {showAvail ? "Hide availability" : "Edit availability"}
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
          <AvailabilityEditor
            windows={windows}
            action={(w) => saveAvailability(rep.id, w)}
          />
        </div>
      )}
    </div>
  );
}
