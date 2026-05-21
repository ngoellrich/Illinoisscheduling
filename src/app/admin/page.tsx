import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { weekStart, fmt } from "@/lib/time";
import { addRep, cancelAppointment } from "./actions";
import TopBar from "@/components/TopBar";
import RepCard, { RepCardData } from "@/components/RepCard";
import ReassignButton from "@/components/ReassignButton";
import IntakePanel from "@/components/IntakePanel";
import ReassignSelect from "@/components/ReassignSelect";
import type { Window } from "@/components/AvailabilityEditor";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/rep");

  const thisWeek = weekStart(new Date());

  const reps = await prisma.user.findMany({
    where: { role: "REP" },
    include: { availability: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  // Weekly counts per rep (ASSIGNED/COMPLETED in the current week).
  const counts = await prisma.appointment.groupBy({
    by: ["repId"],
    where: { weekStart: thisWeek, status: { in: ["ASSIGNED", "COMPLETED"] } },
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((c) => [c.repId, c._count._all]));

  const upcoming = await prisma.appointment.findMany({
    where: { status: { in: ["ASSIGNED", "PENDING"] }, startsAt: { gte: new Date() } },
    include: { rep: true },
    orderBy: { startsAt: "asc" },
    take: 50,
  });
  const pendingCount = await prisma.appointment.count({ where: { status: "PENDING" } });
  const intake = await prisma.intakeState.findUnique({ where: { id: "intake" } });

  // Active reps available as reassignment targets.
  const repOptions = reps
    .filter((r) => r.active)
    .map((r) => ({ id: r.id, label: r.name || r.email }));

  return (
    <div>
      <TopBar title="Solar Scheduler — Admin" email={user.email} />
      <main className="mx-auto max-w-5xl space-y-10 px-6 py-8">
        {/* Intake calendar */}
        <section>
          <h2 className="mb-4 text-lg font-bold">Appointment source</h2>
          <IntakePanel
            connected={user.googleConnected}
            googleEmail={user.googleEmail}
            currentCalendarId={intake?.calendarId ?? null}
            watching={!!intake?.channelId}
            expiration={intake?.channelExpiration ? fmt(intake.channelExpiration) : null}
          />
        </section>

        {/* Reps */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Reps</h2>
          </div>

          <form action={addRep} className="card mb-5 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="label">Name</label>
              <input name="name" className="input" placeholder="Jane Rep" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="label">Email *</label>
              <input name="email" type="email" required className="input" placeholder="jane@company.com" />
            </div>
            <div>
              <label className="label">Weekly cap</label>
              <input name="weeklyCap" type="number" min={0} defaultValue={10} className="input w-24" />
            </div>
            <button className="btn-primary" type="submit">
              Add rep
            </button>
          </form>

          <div className="space-y-3">
            {reps.length === 0 && <p className="text-slate-500">No reps yet. Add one above.</p>}
            {reps.map((r) => {
              const data: RepCardData = {
                id: r.id,
                name: r.name,
                email: r.email,
                weeklyCap: r.weeklyCap,
                active: r.active,
                googleConnected: r.googleConnected,
                weekCount: countMap.get(r.id) ?? 0,
              };
              const windows: Window[] = r.availability.map((a) => ({
                dayOfWeek: a.dayOfWeek,
                startMin: a.startMin,
                endMin: a.endMin,
              }));
              return <RepCard key={r.id} rep={data} windows={windows} />;
            })}
          </div>
        </section>

        {/* Appointments */}
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Upcoming appointments</h2>
            <ReassignButton pendingCount={pendingCount} />
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2">Appointment</th>
                  <th className="px-4 py-2">Rep</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {upcoming.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      No upcoming appointments.
                    </td>
                  </tr>
                )}
                {upcoming.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">{fmt(a.startsAt)}</td>
                    <td className="px-4 py-2">
                      {a.title}
                      {a.location && <div className="text-xs text-slate-400">{a.location}</div>}
                    </td>
                    <td className="px-4 py-2">
                      <ReassignSelect
                        appointmentId={a.id}
                        currentRepId={a.repId}
                        reps={repOptions}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`pill ${
                          a.status === "PENDING"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-green-100 text-green-700"
                        }`}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <form action={cancelAppointment}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="text-xs text-red-600 hover:underline">Cancel</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
