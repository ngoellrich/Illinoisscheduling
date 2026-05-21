import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listCalendars } from "@/lib/google";

// Admin-only: list the connected account's calendars for the intake picker.
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ calendars: [] }, { status: 403 });
  if (!user.googleConnected) return NextResponse.json({ calendars: [] });
  try {
    const calendars = await listCalendars(user);
    return NextResponse.json({ calendars });
  } catch (e) {
    return NextResponse.json(
      { calendars: [], error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}
