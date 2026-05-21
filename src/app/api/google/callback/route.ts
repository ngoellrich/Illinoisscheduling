import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { handleCallback } from "@/lib/google";
import { env } from "@/lib/env";

// Google redirects here after the rep grants access.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${env.appUrl()}/login`);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error || !code) {
    return NextResponse.redirect(`${env.appUrl()}/admin?error=google_denied`);
  }

  try {
    // Bind to the session user so the connection attaches to the signed-in admin.
    await handleCallback(code, user.id);
    return NextResponse.redirect(`${env.appUrl()}/admin?connected=1`);
  } catch (e) {
    console.error("Google callback failed:", e);
    return NextResponse.redirect(`${env.appUrl()}/admin?error=google_failed`);
  }
}
