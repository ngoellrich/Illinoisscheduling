import { NextResponse } from "next/server";
import { channelToken } from "@/lib/intake";
import { syncIntake } from "@/lib/scheduling";

// Google Calendar push webhook. Google POSTs here when the intake calendar
// changes; it carries no event body, so we run an incremental sync to fetch
// what changed and assign any new appointments.
export async function POST(req: Request) {
  const token = req.headers.get("x-goog-channel-token");
  const state = req.headers.get("x-goog-resource-state");

  // Verify the channel token we set when creating the watch.
  if (token !== channelToken()) {
    return new NextResponse("forbidden", { status: 403 });
  }
  // "sync" is the initial handshake ping; ignore. "exists" = something changed.
  if (state === "exists") {
    try {
      await syncIntake();
    } catch (e) {
      console.error("syncIntake (webhook) failed:", e);
    }
  }
  return new NextResponse(null, { status: 200 });
}
