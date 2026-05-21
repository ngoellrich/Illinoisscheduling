import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { weekStart, fmt } from "@/lib/time";
import { saveMyAvailability, disconnectGoogle } from "./actions";
import TopBar from "@/components/TopBar";
import AvailabilityEditor, { Window } from "@/components/AvailabilityEditor";
import NotificationsPanel from "@/components/NotificationsPanel";

export const dynamic = "force-dynamic";

export default async function RepPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "ADMIN") redirect("/admin");

  const thisWeek = weekStart(new Date());
  const [availability, weekCount, upcoming] = await Promise.all([
    prisma.availability.findMany({ where: { repId: user.id } }),
    prisma.appointment.count({
      where: { repId: user.id, weekStart: thisWeek, status: { in: ["ASSIGNED", "COMPLETED"] } },
    }),
    prisma.appointment.findMany({
      where: { repId: user.id, status: "ASSIGNED", startsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
      take: 30,
    }),
  ]);

  const windows: Window[] = availability.map((a) => ({
    dayOfWeek: a.dayOfWeek,
    startMin: a.startMin,
    endMin: a.endMin,
  }));
  const pct = user.weeklyCap ? Math.min(100, Math.round((weekCount / user.weeklyCap) * 100)) : 0;
  const full = weekCount >= user.weeklyCap;

  return (
    <div>
      <TopBar title="Solar Scheduler" email={user.email} />
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-bold">Hi{user.name ? `, ${user.name}` : ""} 👋</h1>
        </div>

        {/* Google connection */}
        <section className="card">
          <h2 className="font-semibold">Google Calendar</h2>
          {!env.googleConfigured() ? (
            <p className="mt-2 text-sm text-amber-700">
              Google integration isn't configured yet. Ask your admin to set it up.
            </p>
          ) : user.googleConnected ? (
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-sm text-green-700">
                Connected{user.googleEmail ? ` as ${user.googleEmail}` : ""}. New appointments will
                appear on your calendar automatically.
              </p>
              <form action={disconnectGoogle}>
                <button className="btn-ghost px-3 py-1.5 text-sm">Disconnect</button>
              </form>
            </div>
          ) : (
            <div className="mt-2">
              <p className="text-sm text-slate-600">
                Connect your Google Calendar so assigned appointments land on it (and you get
                Google's reminders).
              </p>
              <a href="/api/google/connect" className="btn-primary mt-3">
                Connect Google Calendar
              </a>
            </div>
          )}
        </section>

        {/* Weekly load */}
        <section className="card">
          <h2 className="font-semibold">This week</h2>
          <p className="mt-1 text-sm text-slate-600">
            <b>{weekCount}</b> / {user.weeklyCap} appointments
            {full && <span className="pill ml-2 bg-red-100 text-red-700">at cap</span>}
          </p>
          <div className="mt-2 h-2.5 w-full rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full ${full ? "bg-red-500" : "bg-green-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Your weekly cap is set by your admin.
          </p>
        </section>

        {/* Notifications */}
        <section className="card">
          <h2 className="mb-2 font-semibold">Notifications</h2>
          <NotificationsPanel />
        </section>

        {/* Upcoming */}
        <section className="card">
          <h2 className="mb-3 font-semibold">Upcoming appointments</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing scheduled yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{a.title}</div>
                    {a.location && <div className="text-xs text-slate-400">{a.location}</div>}
                  </div>
                  <div className="text-slate-500">{fmt(a.startsAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Availability */}
        <section className="card">
          <h2 className="mb-3 font-semibold">My availability</h2>
          <p className="mb-3 text-sm text-slate-500">
            Set the hours you can take appointments each day. The scheduler only books you inside
            these windows.
          </p>
          <AvailabilityEditor windows={windows} action={saveMyAvailability} />
        </section>
      </main>
    </div>
  );
}
