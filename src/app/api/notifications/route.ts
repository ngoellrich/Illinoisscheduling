import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Unread notifications for the signed-in user (polled by the dashboard).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ notifications: [] }, { status: 401 });
  const notifications = await prisma.notification.findMany({
    where: { repId: user.id, read: false },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ notifications });
}

// Mark one (by id) or all (no body) notifications read.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  let id: string | undefined;
  try {
    id = (await req.json())?.id;
  } catch {
    /* no body = mark all */
  }
  await prisma.notification.updateMany({
    where: { repId: user.id, read: false, ...(id ? { id } : {}) },
    data: { read: true },
  });
  return NextResponse.json({ ok: true });
}
