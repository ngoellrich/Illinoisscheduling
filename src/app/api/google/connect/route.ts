import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { consentUrl } from "@/lib/google";
import { env } from "@/lib/env";

// Start the per-rep Google OAuth flow.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${env.appUrl()}/login`);
  if (!env.googleConfigured()) {
    return NextResponse.redirect(`${env.appUrl()}/rep?error=google_not_configured`);
  }
  // Identity is taken from the session in the callback; state carries the id
  // only as a sanity check / CSRF hint.
  return NextResponse.redirect(consentUrl(user.id));
}
