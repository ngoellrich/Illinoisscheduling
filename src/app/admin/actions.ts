"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { applyTimeOff, reassignAppointment, reassignPending, syncIntake } from "@/lib/scheduling";
import { deleteEvent } from "@/lib/google";
import { configureIntake } from "@/lib/intake";
import { startRepWatch, stopRepWatch } from "@/lib/repwatch";
import { bizLocalToDate } from "@/lib/time";

// All actions here are admin-only.

export async function addRep(formData: FormData) {
  await requireRole("ADMIN");
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const name = String(formData.get("name") || "").trim();
  const weeklyCap = parseInt(String(formData.get("weeklyCap") || "10"), 10) || 10;
  // A pasted Calendar ID wins over the dropdown selection.
  const calendarId =
    String(formData.get("calendarIdManual") || "").trim() ||
    String(formData.get("calendarId") || "").trim() ||
    null;
  if (!email.includes("@")) throw new Error("Valid email required.");

  const rep = await prisma.user.upsert({
    where: { email },
    update: { name: name || undefined, weeklyCap, role: "REP", active: true, googleCalendarId: calendarId },
    create: { email, name: name || null, weeklyCap, role: "REP", googleCalendarId: calendarId },
  });
  if (calendarId) await startRepWatch(rep.id);
  revalidatePath("/admin");
}

export async function updateRep(formData: FormData) {
  await requireRole("ADMIN");
  const id = String(formData.get("id"));
  const weeklyCap = parseInt(String(formData.get("weeklyCap")), 10);
  const active = formData.get("active") === "on";
  const calendarId =
    String(formData.get("calendarIdManual") || "").trim() ||
    String(formData.get("calendarId") || "").trim() ||
    null;
  await prisma.user.update({
    where: { id },
    data: {
      weeklyCap: isNaN(weeklyCap) ? undefined : weeklyCap,
      active,
      googleCalendarId: calendarId,
    },
  });
  // Keep the calendar watch in sync with the mapping.
  if (calendarId && active) await startRepWatch(id);
  else await stopRepWatch(id);
  revalidatePath("/admin");
}

export async function removeRep(formData: FormData) {
  await requireRole("ADMIN");
  const id = String(formData.get("id"));
  await stopRepWatch(id); // tear down the calendar watch first
  // Keep history: deactivate rather than hard-delete if they have appointments.
  const apptCount = await prisma.appointment.count({ where: { repId: id } });
  if (apptCount > 0) {
    await prisma.user.update({ where: { id }, data: { active: false } });
  } else {
    await prisma.user.delete({ where: { id } });
  }
  revalidatePath("/admin");
}

/** Add a time-off block for a rep, then re-home anything it now covers. */
export async function addTimeOff(formData: FormData) {
  await requireRole("ADMIN");
  const repId = String(formData.get("repId"));
  const reason = String(formData.get("reason") || "").trim() || null;
  const startsAt = bizLocalToDate(String(formData.get("start") || ""));
  const endsAt = bizLocalToDate(String(formData.get("end") || ""));
  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw new Error("Enter a valid start and end (end must be after start).");
  }
  await prisma.timeOff.create({ data: { repId, startsAt, endsAt, reason } });
  await applyTimeOff(repId); // move any now-conflicting appointments off this rep
  revalidatePath("/admin");
}

export async function removeTimeOff(formData: FormData) {
  await requireRole("ADMIN");
  const id = String(formData.get("id"));
  await prisma.timeOff.delete({ where: { id } });
  revalidatePath("/admin");
}

/** Replace a rep's weekly availability with the provided windows. */
export async function saveAvailability(
  repId: string,
  windows: { dayOfWeek: number; startMin: number; endMin: number }[]
) {
  await requireRole("ADMIN");
  await prisma.$transaction([
    prisma.availability.deleteMany({ where: { repId } }),
    prisma.availability.createMany({
      data: windows
        .filter((w) => w.endMin > w.startMin)
        .map((w) => ({ repId, ...w })),
    }),
  ]);
  revalidatePath("/admin");
}

export async function runReassign() {
  await requireRole("ADMIN");
  const n = await reassignPending();
  revalidatePath("/admin");
  return n;
}

export async function cancelAppointment(formData: FormData) {
  await requireRole("ADMIN");
  const id = String(formData.get("id"));
  const appt = await prisma.appointment.findUnique({ where: { id }, include: { rep: true } });
  if (appt?.rep?.googleCalendarId && appt.googleEventId) {
    const state = await prisma.intakeState.findUnique({ where: { id: "intake" } });
    const owner = state?.ownerUserId
      ? await prisma.user.findUnique({ where: { id: state.ownerUserId } })
      : null;
    if (owner) await deleteEvent(owner, appt.rep.googleCalendarId, appt.googleEventId);
  }
  await prisma.appointment.update({ where: { id }, data: { status: "CANCELLED" } });
  revalidatePath("/admin");
}

// ---- Intake calendar + assignment overrides ---------------------------------

/** Choose which of the admin's Google calendars is the intake source. */
export async function setIntakeCalendar(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const calendarId = String(formData.get("calendarId") || "");
  if (!calendarId) throw new Error("Pick a calendar.");
  await configureIntake(admin.id, calendarId);
  revalidatePath("/admin");
}

/** Pull from the intake calendar now (manual trigger / works on localhost). */
export async function syncNow() {
  await requireRole("ADMIN");
  const created = await syncIntake();
  revalidatePath("/admin");
  return created;
}

/** Manually move an appointment to a specific rep. */
export async function reassign(formData: FormData) {
  await requireRole("ADMIN");
  const id = String(formData.get("id"));
  const repId = String(formData.get("repId"));
  if (!repId) return;
  await reassignAppointment(id, repId);
  revalidatePath("/admin");
}
