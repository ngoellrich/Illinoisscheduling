import { NextResponse } from "next/server";
import { renewWatchIfNeeded } from "@/lib/intake";
import { syncIntake } from "@/lib/scheduling";

// Safety net for push notifications: renews the watch channel before it
// expires and runs a sync to catch anything the webhook missed (or to cover
// environments where the webhook can't reach us, e.g. localhost).
//
// Protect with a secret: call as /api/cron?key=CRON_SECRET (or Bearer header).
// Render Cron Job hits this on a schedule.
export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse("forbidden", { status: 403 });
  const renewed = await renewWatchIfNeeded();
  const created = await syncIntake();
  return NextResponse.json({ ok: true, renewed, created });
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // must be configured to enable the cron endpoint
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return key === secret || bearer === secret;
}
