import crypto from "crypto";
import { prisma } from "./prisma";
import { env } from "./env";
import { stopChannel, watchCalendar } from "./google";

// Manages the connection to the admin's intake Google Calendar: which calendar
// is the source, and the Google push channel that notifies us of new events.

/** Token Google echoes back in webhook headers so we can verify authenticity. */
export function channelToken(): string {
  return crypto.createHmac("sha256", env.authSecret()).update("intake-channel").digest("hex");
}

/**
 * Point intake at a calendar owned by `ownerUserId` and (re)start the push
 * channel. Resets the sync token so the next sync re-reads upcoming events.
 * Returns whether the push watch was successfully established (it can't be on
 * localhost, where you rely on the cron / "Sync now" instead).
 */
export async function configureIntake(
  ownerUserId: string,
  calendarId: string
): Promise<{ watching: boolean; error?: string }> {
  await stopExistingChannel();
  await prisma.intakeState.upsert({
    where: { id: "intake" },
    update: { ownerUserId, calendarId, syncToken: null, channelId: null, resourceId: null, channelExpiration: null },
    create: { id: "intake", ownerUserId, calendarId },
  });
  return startIntakeWatch();
}

/** (Re)start the push channel for the currently configured intake calendar. */
export async function startIntakeWatch(): Promise<{ watching: boolean; error?: string }> {
  const state = await prisma.intakeState.findUnique({ where: { id: "intake" } });
  if (!state?.ownerUserId || !state.calendarId) return { watching: false, error: "Intake not configured." };
  const owner = await prisma.user.findUnique({ where: { id: state.ownerUserId } });
  if (!owner) return { watching: false, error: "Intake owner not found." };

  await stopExistingChannel();
  const webhookUrl = `${env.appUrl()}/api/google/notifications`;
  try {
    const watch = await watchCalendar(owner, state.calendarId, webhookUrl, channelToken());
    await prisma.intakeState.update({
      where: { id: "intake" },
      data: {
        channelId: watch.channelId,
        resourceId: watch.resourceId,
        channelExpiration: watch.expiration,
      },
    });
    return { watching: true };
  } catch (e) {
    // Common locally: Google rejects non-HTTPS / unreachable webhook addresses.
    return { watching: false, error: e instanceof Error ? e.message : "watch failed" };
  }
}

async function stopExistingChannel() {
  const state = await prisma.intakeState.findUnique({ where: { id: "intake" } });
  if (state?.ownerUserId && state.channelId && state.resourceId) {
    const owner = await prisma.user.findUnique({ where: { id: state.ownerUserId } });
    if (owner) await stopChannel(owner, state.channelId, state.resourceId);
  }
}

/** Renew the push channel if it's expired or close to expiring (run by cron). */
export async function renewWatchIfNeeded(): Promise<boolean> {
  const state = await prisma.intakeState.findUnique({ where: { id: "intake" } });
  if (!state?.calendarId) return false;
  const soon = Date.now() + 24 * 60 * 60 * 1000; // within 24h of expiry
  if (!state.channelExpiration || state.channelExpiration.getTime() < soon) {
    const r = await startIntakeWatch();
    return r.watching;
  }
  return true;
}
