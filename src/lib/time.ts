import { DateTime } from "luxon";
import { env } from "./env";

// All scheduling math happens in the business timezone, then converts to/from
// JS Date (UTC instants) for storage. Day-of-week uses JS convention: 0=Sun..6=Sat.

export function tz(): string {
  return env.timezone();
}

export function toBiz(date: Date): DateTime {
  return DateTime.fromJSDate(date, { zone: tz() });
}

/** JS weekday 0=Sun..6=Sat for an instant, in business tz. */
export function dayOfWeek(date: Date): number {
  return toBiz(date).weekday % 7; // luxon weekday: 1=Mon..7=Sun → 0=Sun..6=Sat
}

/** Minutes since midnight (business tz). */
export function minutesOfDay(date: Date): number {
  const d = toBiz(date);
  return d.hour * 60 + d.minute;
}

/** Monday 00:00 of the week containing `date`, as a UTC instant. */
export function weekStart(date: Date): Date {
  return toBiz(date).startOf("week").toJSDate(); // luxon weeks start Monday
}

/** Build an instant from a calendar day + minutes-since-midnight (business tz). */
export function atMinutes(day: DateTime, minutes: number): Date {
  return day
    .startOf("day")
    .plus({ minutes })
    .toJSDate();
}

/** A DateTime for "now" in business tz. */
export function nowBiz(): DateTime {
  return DateTime.now().setZone(tz());
}

export function fmt(date: Date, fmtStr = "EEE MMM d, h:mm a"): string {
  return toBiz(date).toFormat(fmtStr);
}

export function fmtTime(date: Date): string {
  return toBiz(date).toFormat("h:mm a");
}

/** "09:00" <-> minutes helpers for the availability UI. */
export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
