"use client";

import { reassign } from "@/app/admin/actions";

export default function ReassignSelect({
  appointmentId,
  currentRepId,
  reps,
}: {
  appointmentId: string;
  currentRepId: string | null;
  reps: { id: string; label: string }[];
}) {
  return (
    <form action={reassign} className="flex items-center gap-1">
      <input type="hidden" name="id" value={appointmentId} />
      <select
        name="repId"
        defaultValue={currentRepId || ""}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
      >
        <option value="" disabled>
          Assign…
        </option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      <button type="submit" className="text-xs text-brand-dark hover:underline">
        Set
      </button>
    </form>
  );
}
