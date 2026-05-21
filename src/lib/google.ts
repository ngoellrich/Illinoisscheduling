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

// =============================================================================
// Calendars: read intake + write appointments to reps' calendars, all through
// the single connected admin account (the "owner").
// =============================================================================

/** An authorized client for the connected owner account. */
export function clientForUser(user: User): OAuth2Client | null {
  if (!user.googleRefreshToken) return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(user.googleRefreshToken) });
  return client;
}

/**
 * Create the appointment on the given calendar, using the owner account's
 * access (the rep's calendar must be shared to the owner with edit rights).
 * Returns the Google event id, or null if it couldn't be created.
 */
export async function createEvent(
  owner: User,
  calendarId: string,
  appt: {
    title: string;
    location?: string | null;
    notes?: string | null;
    startsAt: Date;
    endsAt: Date;
  }
): Promise<string | null> {
  const client = clientForUser(owner);
  if (!client || !calendarId) return null;

  const calendar = google.calendar({ version: "v3", auth: client });
  const res = await calendar.events.insert({
    calendarId,
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

/** Delete an event from a calendar (best-effort). */
export async function deleteEvent(owner: User, calendarId: string, eventId: string): Promise<void> {
  const client = clientForUser(owner);
  if (!client || !calendarId) return;
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    await calendar.events.delete({ calendarId, eventId, sendUpdates: "all" });
  } catch {
    // ignore: event may already be gone
  }
}

export interface CalendarOption {
  id: string;
  summary: string;
  primary: boolean;
  canWrite: boolean; // owner/writer access — required for rep destinations
}

/** List the connected account's calendars (intake source + rep destinations). */
export async function listCalendars(user: User): Promise<CalendarOption[]> {
  const client = clientForUser(user);
  if (!client) return [];
  const calendar = google.calendar({ version: "v3", auth: client });
  const res = await calendar.calendarList.list({ maxResults: 250 });
  return (res.data.items || [])
    .filter((c) => c.id)
    .map((c) => ({
      id: c.id!,
      summary: c.summary || c.id!,
      primary: !!c.primary,
      canWrite: c.accessRole === "owner" || c.accessRole === "writer",
    }));
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
