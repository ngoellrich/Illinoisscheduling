import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

// Landing: route signed-in users to their dashboard, show entry points otherwise.
export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/rep");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <div className="text-5xl">☀️</div>
        <h1 className="mt-4 text-3xl font-bold">Solar Scheduler</h1>
        <p className="mt-2 text-slate-600">
          Appointments on your Google Calendar are assigned to the right rep automatically —
          by availability and weekly workload — and pushed to that rep's calendar.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/login" className="btn-primary">
          Sign in
        </Link>
      </div>
    </main>
  );
}
