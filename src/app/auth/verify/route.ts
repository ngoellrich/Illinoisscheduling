import { NextResponse } from "next/server";
import { consumeMagicLink } from "@/lib/auth";
import { env } from "@/lib/env";

// Magic-link landing. Validates token, starts a session, redirects to dashboard.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const user = await consumeMagicLink(token);

  if (!user) {
    return NextResponse.redirect(`${env.appUrl()}/login?error=expired`);
  }
  const dest = user.role === "ADMIN" ? "/admin" : "/rep";
  return NextResponse.redirect(`${env.appUrl()}${dest}`);
}
