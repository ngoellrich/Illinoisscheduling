import { prisma } from "./prisma";
import { env } from "./env";
import {
  createRepEvent,
  deleteRepEvent,
  fetchChangedEvents,
  markIntakeAssigned,
} from "./google";
import { dayOfWeek, minutesOfDay, weekStart } from "./time";
import type { Availability, User } from "@prisma/client";
import type { calendar_v3 } from "googleapis";

// =============================================================================
// The scheduling brain.
//
// Two rules, exactly as specified:
//   1. AVAILABILITY  — the appointment must fit inside one of the rep's
//                      working windows for that weekday.
//   2. WEEKLY LOAD   — the rep must be under their weekly cap, and among
//                      eligible reps we pick the one with the FEWEST
//                      appointments that week (load balancing).
// Plus a hard constraint: no double-booking the same rep.
// =============================================================================

type RepWithAvail = User & { availability: Availability[] };

const COUNTED = ["ASSIGNED", "COMPLETED"] as const;

function apptMinutes(): number {
  return env.appointmentMinutes();
}

// ---- Data loading ------------------------------------------------------------

async function loadActiveReps(): Promise<RepWithAvail[]> {
  return prisma.user.findMany({
    where: { role: "REP", active: true },
    include: { availability: true },
  });
}

/** Per-rep busy intervals (non-cancelled appts) within a date range. */
async function loadBusy(rangeStart: Date, rangeEnd: Date) {
  const appts = await prisma.appointment.findMany({
    where: {
      status: { not: "CANCELLED" },
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
      repId: { not: null },
    },
    select: { repId: true, startsAt: true, endsAt: true },
  });
  const byRep = new Map<string, { start: number; end: number }[]>();
  for (const a of appts) {
    if (!a.repId) continue;
    const arr = byRep.get(a.repId) ?? [];
    arr.push({ start: a.startsAt.getTime(), end: a.endsAt.getTime() });
    byRep.set(a.repId, arr);
  }
  return byRep;
}

/** Per-rep count of appointments per week (keyed by weekStart ISO). */
async function loadWeeklyCounts(rangeStart: Date, rangeEnd: Date) {
  const appts = await prisma.appointment.findMany({
    where: {
      status: { in: [...COUNTED] },
      weekStart: { gte: weekStart(rangeStart), lte: rangeEnd },
      repId: { not: null },
    },
    select: { repId: true, weekStart: true },
  });
  const counts = new Map<string, number>(); // key: `${repId}|${weekStartISO}`
  for (const a of appts) {
    if (!a.repId) continue;
    const key = `${a.repId}|${a.weekStart.toISOString()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function hasConflict(
  busy: { start: number; end: number }[] | undefined,
  start: Date,
  end: Date
): boolean {
  if (!busy) return false;
  const s = start.getTime();
  const e = end.getTime();
  return busy.some((b) => b.start < e && b.end > s);
}

// ---- Eligibility -------------------------------------------------------------

interface EligibleRep {
  rep: RepWithAvail;
  weekCount: number;
}

/**
 * Reps who can take an appointment at [start, end): available that weekday/time,
 * under their weekly cap, and not already booked then.
 */
function eligibleReps(
  reps: RepWithAvail[],
  start: Date,
  end: Date,
  busyByRep: Map<string, { start: number; end: number }[]>,
  weekCounts: Map<string, number>
): EligibleRep[] {
  const wd = dayOfWeek(start);
  const startMin = minutesOfDay(start);
  const endMin = startMin + apptMinutes();
  const wkKey = weekStart(start).toISOString();

  const out: EligibleRep[] = [];
  for (const rep of reps) {
    // Rule 1: availability window covers the appointment.
    const fits = rep.availability.some(
      (w) => w.dayOfWeek === wd && startMin >= w.startMin && endMin <= w.endMin
    );
    if (!fits) continue;

    // Hard constraint: no double-booking.
    if (hasConflict(busyByRep.get(rep.id), start, end)) continue;

    // Rule 2: under weekly cap.
    const count = weekCounts.get(`${rep.id}|${wkKey}`) ?? 0;
    if (count >= rep.weeklyCap) continue;

    out.push({ rep, weekCount: count });
  }
  return out;
}

/** Pick the best rep: fewest this week, then lowest utilization, then name. */
function pickBest(eligible: EligibleRep[]): EligibleRep | null {
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => {
    if (a.weekCount !== b.weekCount) return a.weekCount - b.weekCount;
    const au = a.weekCount / Math.max(a.rep.weeklyCap, 1);
    const bu = b.weekCount / Math.max(b.rep.weeklyCap, 1);
    if (au !== bu) return au - bu;
    return (a.rep.name || a.rep.email).localeCompare(b.rep.name || b.rep.email);
  })[0];
}

/** Assign the single best rep for [start, end), or null. Loads fresh data. */
async function assignBestRep(start: Date, end: Date): Promise<EligibleRep | null> {
  const [reps, busyByRep, weekCounts] = await Promise.all([
    loadActiveReps(),
    loadBusy(start, end),
    loadWeeklyCounts(start, end),
  ]);
  return pickBest(eligibleReps(reps, start, end, busyByRep, weekCounts));
}

// =============================================================================
// Intake: read appointments off the admin's Google Calendar and route them.
// =============================================================================

interface ParsedEvent {
  start: Date;
  end: Date;
  title: string;
  location: string | null;
  notes: string | null;
}

/** Pull appointment details out of a Google Calendar event. */
function parseIntakeEvent(ev: calendar_v3.Schema$Event): ParsedEvent | null {
  // Skip all-day events (date, not dateTime) — appointments need a real time.
  const startIso = ev.start?.dateTime;
  if (!startIso) return null;
  const start = new Date(startIso);
  const end = ev.end?.dateTime
    ? new Date(ev.end.dateTime)
    : new Date(start.getTime() + env.appointmentMinutes() * 60000);

  return {
    start,
    end,
    title: (ev.summary || "Appointment").trim(),
    location: ev.location || null,
    notes: ev.description || null,
  };
}

/**
 * Process one intake event: assign a rep automatically, persist, push to the
 * rep's calendar, notify the rep, and annotate the intake event. Idempotent —
 * an event already turned into an appointment is skipped.
 */
async function processIntakeEvent(
  owner: User,
  calendarId: string,
  ev: calendar_v3.Schema$Event
): Promise<void> {
  if (!ev.id) return;

  const existing = await prisma.appointment.findUnique({ where: { intakeEventId: ev.id } });

  // Handle cancellations/deletions of already-imported events.
  if (ev.status === "cancelled") {
    if (existing && existing.status !== "CANCELLED") {
      const rep = existing.repId ? await prisma.user.findUnique({ where: { id: existing.repId } }) : null;
      if (rep && existing.googleEventId) await deleteRepEvent(rep, existing.googleEventId);
      await prisma.appointment.update({ where: { id: existing.id }, data: { status: "CANCELLED" } });
    }
    return;
  }

  if (existing) return; // already imported — don't double-assign
  if (ev.extendedProperties?.private?.appointmentId) return; // our own annotation

  const parsed = parseIntakeEvent(ev);
  if (!parsed) return;
  if (parsed.start.getTime() < Date.now()) return; // ignore past events

  const best = await assignBestRep(parsed.start, parsed.end);

  const appt = await prisma.appointment.create({
    data: {
      title: parsed.title,
      location: parsed.location,
      notes: parsed.notes,
      startsAt: parsed.start,
      endsAt: parsed.end,
      weekStart: weekStart(parsed.start),
      status: best ? "ASSIGNED" : "PENDING",
      repId: best?.rep.id ?? null,
      intakeEventId: ev.id,
    },
  });

  if (!best) {
    await notifyAdmins(
      `No rep available for "${parsed.title}" on ${parsed.start.toLocaleString()}. ` +
        `Saved as PENDING — adjust availability/caps and reassign.`
    );
    return;
  }

  try {
    const eventId = await createRepEvent(best.rep, appt);
    if (eventId)
      await prisma.appointment.update({ where: { id: appt.id }, data: { googleEventId: eventId } });
  } catch (e) {
    console.error("Calendar push failed (intake):", e);
  }

  await prisma.notification.create({
    data: {
      repId: best.rep.id,
      message: `New appointment: ${parsed.title} on ${parsed.start.toLocaleString()}${
        parsed.location ? ` @ ${parsed.location}` : ""
      }`,
    },
  });

  await markIntakeAssigned(
    owner,
    calendarId,
    ev.id,
    best.rep.name || best.rep.email,
    appt.id,
    parsed.title
  );
}

/**
 * Sync the intake calendar: fetch events changed since the last sync token and
 * process them. Triggered by the Google push webhook and by the safety cron.
 * Returns the number of new appointments created.
 */
export async function syncIntake(): Promise<number> {
  const state = await prisma.intakeState.findUnique({ where: { id: "intake" } });
  if (!state?.ownerUserId || !state.calendarId) return 0;
  const owner = await prisma.user.findUnique({ where: { id: state.ownerUserId } });
  if (!owner) return 0;

  let { items, nextSyncToken, fullResyncNeeded } = await fetchChangedEvents(
    owner,
    state.calendarId,
    state.syncToken
  );
  if (fullResyncNeeded) {
    ({ items, nextSyncToken } = await fetchChangedEvents(owner, state.calendarId, null));
  }

  let created = 0;
  for (const ev of items) {
    const before = ev.id
      ? await prisma.appointment.findUnique({ where: { intakeEventId: ev.id } })
      : null;
    await processIntakeEvent(owner, state.calendarId, ev);
    if (!before && ev.id && ev.status !== "cancelled") {
      const after = await prisma.appointment.findUnique({ where: { intakeEventId: ev.id } });
      if (after) created++;
    }
  }

  if (nextSyncToken) {
    await prisma.intakeState.update({
      where: { id: "intake" },
      data: { syncToken: nextSyncToken },
    });
  }
  return created;
}

// ---- Manual override: reassign an appointment to a specific rep -------------

export async function reassignAppointment(appointmentId: string, newRepId: string): Promise<void> {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { rep: true },
  });
  if (!appt) throw new Error("Appointment not found.");
  if (appt.repId === newRepId) return;

  const newRep = await prisma.user.findUnique({ where: { id: newRepId } });
  if (!newRep || newRep.role !== "REP" || !newRep.active) throw new Error("Invalid rep.");

  // Remove the event from the previous rep's calendar.
  if (appt.rep && appt.googleEventId) await deleteRepEvent(appt.rep, appt.googleEventId);

  // Create it on the new rep's calendar.
  let newEventId: string | null = null;
  try {
    newEventId = await createRepEvent(newRep, appt);
  } catch (e) {
    console.error("Calendar push failed (reassign):", e);
  }

  await prisma.appointment.update({
    where: { id: appt.id },
    data: { repId: newRep.id, status: "ASSIGNED", googleEventId: newEventId },
  });

  await prisma.notification.create({
    data: {
      repId: newRep.id,
      message: `Appointment assigned to you: ${appt.title} on ${appt.startsAt.toLocaleString()}`,
    },
  });
}

async function notifyAdmins(message: string) {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true } });
  await prisma.notification.createMany({
    data: admins.map((a) => ({ repId: a.id, message })),
  });
}

/**
 * Try to assign any PENDING appointments (e.g. after an admin frees capacity).
 * Returns the number newly assigned.
 */
export async function reassignPending(): Promise<number> {
  const pending = await prisma.appointment.findMany({
    where: { status: "PENDING" },
    orderBy: { startsAt: "asc" },
  });
  let assigned = 0;
  for (const appt of pending) {
    const [reps, busyByRep, weekCounts] = await Promise.all([
      loadActiveReps(),
      loadBusy(appt.startsAt, appt.endsAt),
      loadWeeklyCounts(appt.startsAt, appt.endsAt),
    ]);
    const best = pickBest(eligibleReps(reps, appt.startsAt, appt.endsAt, busyByRep, weekCounts));
    if (!best) continue;

    await prisma.appointment.update({
      where: { id: appt.id },
      data: { repId: best.rep.id, status: "ASSIGNED" },
    });
    try {
      const eventId = await createRepEvent(best.rep, appt);
      if (eventId)
        await prisma.appointment.update({ where: { id: appt.id }, data: { googleEventId: eventId } });
    } catch (e) {
      console.error("Calendar push failed (reassign):", e);
    }
    await prisma.notification.create({
      data: {
        repId: best.rep.id,
        message: `New appointment: ${appt.title} on ${appt.startsAt.toLocaleString()}`,
      },
    });
    assigned++;
  }
  return assigned;
}
