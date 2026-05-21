"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const res = await fetch("/api/auth/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (res.ok) {
      setStatus("sent");
    } else {
      setStatus("error");
      setMessage(data.error || "Something went wrong.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="card">
        <h1 className="text-xl font-bold">Sign in</h1>
        <p className="mt-1 text-sm text-slate-600">
          Enter your email and we'll send you a one-time login link.
        </p>

        {status === "sent" ? (
          <div className="mt-5 rounded-lg bg-green-50 p-4 text-sm text-green-800">
            Check your email for a sign-in link. (In local dev with no SMTP set,
            the link is printed in the server console.)
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            {status === "error" && <p className="text-sm text-red-600">{message}</p>}
            <button type="submit" className="btn-primary w-full" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Send login link"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
