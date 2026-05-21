"use client";

import { useState, useTransition } from "react";
import { runReassign } from "@/app/admin/actions";

export default function ReassignButton({ pendingCount }: { pendingCount: number }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  return (
    <div className="flex items-center gap-3">
      <button
        className="btn-ghost"
        disabled={pending || pendingCount === 0}
        onClick={() =>
          startTransition(async () => {
            const n = await runReassign();
            setMsg(n > 0 ? `Assigned ${n} pending appointment(s).` : "Still no capacity for pending.");
          })
        }
      >
        {pending ? "Reassigning…" : `Reassign pending (${pendingCount})`}
      </button>
      {msg && <span className="text-sm text-slate-600">{msg}</span>}
    </div>
  );
}
