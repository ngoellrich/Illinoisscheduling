import { prisma } from "./prisma";
import { env } from "./env";
import { stopChannel, watchCalendar } from "./google";
import { channelToken } from "./intake";
import { getIntakeOwner, reEvaluateRep } from "./scheduling";

// Per-rep Google push channels. When a rep's calendar changes, Google pings our
// webhook; we then re-check that rep's upcoming appointments for conflicts.

function webhookUrl(): string {
  return `${env.appUrl()}/api/google/notifications`;
}

/** (Re)start the push channel watching a rep's mapped calendar. */
export async function startRepWatch(repId: string): Promise<void> {
  const owner = await getIntakeOwner();
  const rep = await prisma.user.findUnique({ where: { id: repId } });
  if (!owner || !rep?.googleCalendarId) return;

  await stopRepWatch(repId); // clear any existing channel first
  try {
    const w = await watchCalendar(owner, rep.googleCalendarId, webhookUrl(), channelToken());
    await prisma.repWatch.upsert({
      where: { repId },
      update: {
        calendarId: rep.googleCalendarId,
        channelId: w.channelId,
        resourceId: w.resourceId,
        channelExpiration: w.expiration,
      },
      create: {
        repId,
        calendarId: rep.googleCalendarId,
        channelId: w.channelId,
        resourceId: w.resourceId,
        channelExpiration: w.expiration,
      },
    });
  } catch (e) {
    // Common on localhost or if the calendar share lacks access — non-fatal;
    // the free/busy check at assignment time still protects against conflicts.
    console.error("rep watch start failed for", repId, e);
  }
}

/** Stop and forget a rep's push channel. */
export async function stopRepWatch(repId: string): Promise<void> {
  const owner = await getIntakeOwner();
  const w = await prisma.repWatch.findUnique({ where: { repId } });
  if (!w) return;
  if (owner) await stopChannel(owner, w.channelId, w.resourceId);
  await prisma.repWatch.delete({ where: { repId } }).catch(() => {});
}

/** A rep calendar pinged us — find which rep and re-evaluate them. */
export async function handleRepCalendarChange(channelId: string): Promise<boolean> {
  const w = await prisma.repWatch.findUnique({ where: { channelId } });
  if (!w) return false;
  await reEvaluateRep(w.repId);
  return true;
}

/**
 * Reconcile rep watches (run by the cron): ensure every active, mapped rep has
 * a current channel, refresh ones near expiry, and stop watches for reps that
 * are no longer active/mapped.
 */
export async function reconcileRepWatches(): Promise<void> {
  const owner = await getIntakeOwner();
  if (!owner) return;

  const reps = await prisma.user.findMany({
    where: { role: "REP", active: true, googleCalendarId: { not: null } },
  });
  const soon = Date.now() + 24 * 60 * 60 * 1000;

  for (const rep of reps) {
    const w = await prisma.repWatch.findUnique({ where: { repId: rep.id } });
    const stale =
      !w ||
      w.calendarId !== rep.googleCalendarId ||
      !w.channelExpiration ||
      w.channelExpiration.getTime() < soon;
    if (stale) await startRepWatch(rep.id);
  }

  // Stop watches for reps that no longer qualify.
  const activeIds = new Set(reps.map((r) => r.id));
  const watches = await prisma.repWatch.findMany();
  for (const w of watches) {
    if (!activeIds.has(w.repId)) await stopRepWatch(w.repId);
  }
}
