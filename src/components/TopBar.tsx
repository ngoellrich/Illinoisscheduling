import Link from "next/link";

export default function TopBar({ title, email }: { title: string; email: string }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span>☀️</span> {title}
        </Link>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span className="hidden sm:inline">{email}</span>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="btn-ghost px-3 py-1.5">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
