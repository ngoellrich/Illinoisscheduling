import crypto from "crypto";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { env } from "./env";
import { prisma } from "./prisma";
import { decrypt, encrypt } from "./crypto";
import type { User } from "@prisma/client";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function oauthClient(): OAuth2Client {
  const g = env.google();
  return new google.auth.OAuth2(g.clientId, g.clientSecret, g.redirectUri);
}

/** URL to send a rep to so they grant calendar access. `state` carries the userId. */
export function consentUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force refresh_token even on re-auth
    scope: SCOPES,
    state,
  });
}

/** Exchange the OAuth code, store the refresh token (encrypted) on the user. */
export async function handleCallback(code: string, userId: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("No refresh token returned. Re-connect and approve access.");
  }
  client.setCredentials(tokens);

  // Identify which Google account was connected.
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const me = await oauth2.userinfo.get();

  await prisma.user.update({
    where: { id: userId },
    data: {
      googleConnected: true,
      googleRefreshToken: encrypt(tokens.refresh_token),
      googleCalendarId: "primary",
      googleEmail: me.data.email || null,
      googleConnectedAt: new Date(),
    },
  });
}

/** An authorized client for a rep, using their stored refresh token. */
export function clientForRep(rep: User): OAuth2Client | null {
  if (!rep.googleRefreshToken) return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(rep.googleRefreshToken) });
  return client;
}

/**
 * Create the appointment on the rep's own calendar.
 * Returns the Google event id, or null if the rep isn't connected.
 */
export async function createRepEvent(
  rep: User,
  appt: {
    title: string;
    location?: string | null;
    notes?: string | null;
    startsAt: Date;
    endsAt: Date;
  }
): Promise<string | null> {
  const client = clientForRep(rep);
  if (!client) return null;

  const calendar = google.calendar({ version: "v3", auth: client });
  const res = await calendar.events.insert({
    calendarId: rep.googleCalendarId || "primary",
    requestBody: {
      summary: appt.title,
      location: appt.location || undefined,
      description: appt.notes || undefined,
      start: { dateTime: appt.startsAt.toISOString() },
      end: { dateTime: appt.endsAt.toISOString() },
      reminders: { useDefault: true },
    },
  });
  return res.data.id || null;
}

/** Cancel a previously created rep event (best-effort). */
export async function deleteRepEvent(rep: User, eventId: string): Promise<void> {
  const client = clientForRep(rep);
  if (!client) return;
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    await calendar.events.delete({
      calendarId: rep.googleCalendarId || "primary",
      eventId,
      sendUpdates: "all",
    });
  } catch {
    // ignore: event may already be gone
  }
}

// =============================================================================
// Intake calendar (the admin's Google Calendar that appointments land on)
// =============================================================================

/** An authorized client for any connected user (admin or rep). */
export function clientForUser(user: User): OAuth2Client | null {
  if (!user.googleRefreshToken) return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(user.googleRefreshToken) });
  return client;
}

/** List the connected account's calendars (for the intake-calendar picker). */
export async function listCalendars(
  user: User
): Promise<{ id: string; summary: string; primary: boolean }[]> {
  const client = clientForUser(user);
  if (!client) return [];
  const calendar = google.calendar({ version: "v3", auth: client });
  const res = await calendar.calendarList.list({ maxResults: 250 });
  return (res.data.items || [])
    .filter((c) => c.id)
    .map((c) => ({ id: c.id!, summary: c.summary || c.id!, primary: !!c.primary }));
}

export interface WatchResult {
  channelId: string;
  resourceId: string;
  expiration: Date | null;
}

/** Start a Google push channel on the intake calendar. */
export async function watchCalendar(
  owner: User,
  calendarId: string,
  webhookUrl: string,
  channelToken: string
): Promise<WatchResult> {
  const client = clientForUser(owner);
  if (!client) throw new Error("Intake account is not connected to Google.");
  const calendar = google.calendar({ version: "v3", auth: client });
  const channelId = crypto.randomUUID();
  const res = await calendar.events.watch({
    calendarId,
    requestBody: { id: channelId, type: "web_hook", address: webhookUrl, token: channelToken },
  });
  return {
    channelId,
    resourceId: res.data.resourceId || "",
    expiration: res.data.expiration ? new Date(Number(res.data.expiration)) : null,
  };
}

/** Stop a push channel (best-effort). */
export async function stopChannel(owner: User, channelId: string, resourceId: string) {
  const client = clientForUser(owner);
  if (!client) return;
  try {
    await google.calendar({ version: "v3", auth: client }).channels.stop({
      requestBody: { id: channelId, resourceId },
    });
  } catch {
    /* already stopped/expired */
  }
}

export interface ChangedEvents {
  items: import("googleapis").calendar_v3.Schema$Event[];
  nextSyncToken: string | null;
  fullResyncNeeded: boolean;
}

/**
 * Pull events changed since `syncToken`. With no token, does an initial sync of
 * upcoming events and returns a fresh token. A 410 (expired token) signals the
 * caller to clear the token and resync.
 */
export async function fetchChangedEvents(
  owner: User,
  calendarId: string,
  syncToken: string | null
): Promise<ChangedEvents> {
  const client = clientForUser(owner);
  if (!client) throw new Error("Intake account is not connected to Google.");
  const calendar = google.calendar({ version: "v3", auth: client });

  const items: import("googleapis").calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  try {
    do {
      const res = await calendar.events.list(
        syncToken
          ? { calendarId, syncToken, pageToken, showDeleted: true }
          : {
              // Initial sync: upcoming events only. timeMin is "sticky" for the
              // returned sync token, so the window rolls forward over time.
              calendarId,
              singleEvents: true,
              showDeleted: false,
              timeMin: new Date().toISOString(),
              pageToken,
            }
      );
      for (const ev of res.data.items || []) items.push(ev);
      pageToken = res.data.nextPageToken || undefined;
      nextSyncToken = res.data.nextSyncToken || nextSyncToken;
    } while (pageToken);
  } catch (e: unknown) {
    const code = (e as { code?: number; response?: { status?: number } })?.code ||
      (e as { response?: { status?: number } })?.response?.status;
    if (code === 410) return { items: [], nextSyncToken: null, fullResyncNeeded: true };
    throw e;
  }

  return { items, nextSyncToken, fullResyncNeeded: false };
}

/** Annotate the intake event to show who it was assigned to. */
export async function markIntakeAssigned(
  owner: User,
  calendarId: string,
  eventId: string,
  repName: string,
  appointmentId: string,
  originalSummary: string
) {
  const client = clientForUser(owner);
  if (!client) return;
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    await calendar.events.patch({
      calendarId,
      eventId,
      requestBody: {
        summary: `[${repName}] ${originalSummary}`.slice(0, 1024),
        colorId: "2", // sage/green
        extendedProperties: { private: { assignedRepName: repName, appointmentId } },
      },
    });
  } catch {
    /* non-fatal */
  }
}
