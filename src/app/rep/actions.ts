"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/** A rep edits their own weekly availability. */
export async function saveMyAvailability(
  windows: { dayOfWeek: number; startMin: number; endMin: number }[]
) {
  const user = await requireUser();
  await prisma.$transaction([
    prisma.availability.deleteMany({ where: { repId: user.id } }),
    prisma.availability.createMany({
      data: windows.filter((w) => w.endMin > w.startMin).map((w) => ({ repId: user.id, ...w })),
    }),
  ]);
  revalidatePath("/rep");
}

export async function markNotificationRead(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  await prisma.notification.updateMany({
    where: { id, repId: user.id },
    data: { read: true },
  });
  revalidatePath("/rep");
}

export async function disconnectGoogle() {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      googleConnected: false,
      googleRefreshToken: null,
      googleCalendarId: null,
      googleEmail: null,
      googleConnectedAt: null,
    },
  });
  revalidatePath("/rep");
}
