import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { channelToken } from "@/lib/intake";
import { syncIntake } from "@/lib/scheduling";
import { handleRepCalendarChange } from "@/lib/repwatch";

// Google Calendar push webhook for BOTH the intake calendar and rep calendars.
// Google POSTs here (no event body) when a watched calendar changes; we use the
// channel id to tell which calendar it was and react accordingly.
export async function POST(req: Request) {
  const token = req.headers.get("x-goog-channel-token");
  const state = req.headers.get("x-goog-resource-state");
  const channelId = req.headers.get("x-goog-channel-id") || "";

  // Verify the channel token we set when creating the watch.
  if (token !== channelToken()) {
    return new NextResponse("forbidden", { status: 403 });
  }
  // "sync" is the initial handshake ping; ignore. "exists" = something changed.
  if (state === "exists") {
    try {
      const intake = await prisma.intakeState.findUnique({ where: { id: "intake" } });
      if (intake?.channelId && intake.channelId === channelId) {
        await syncIntake(); // new appointment(s) on the intake calendar
      } else {
        await handleRepCalendarChange(channelId); // a rep's calendar changed
      }
    } catch (e) {
      console.error("notification handling failed:", e);
    }
  }
  return new NextResponse(null, { status: 200 });
}
