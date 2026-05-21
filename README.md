# Solar Scheduler

Appointments land on **your Google Calendar** (you/your setters create them). This app watches that calendar, **auto-assigns each new appointment to an available rep**, and pushes it onto that rep's own Google Calendar — and you can reassign anyone at any time.

## How it works

```
You add an event to your    →   App detects it (Google push      →   App assigns the best rep,
intake Google Calendar           webhook, ~instant) + safety cron      pushes the event to that
                                                                       rep's Google Calendar,
                                                                       notifies the rep
```

**Assignment uses two rules** ([src/lib/scheduling.ts](src/lib/scheduling.ts)):

1. **Availability** — the appointment must fall inside one of the rep's working windows for that weekday.
2. **Weekly load** — among available reps, the one with the **fewest appointments that week** wins, and nobody goes past their **weekly cap**.

Plus a hard rule: a rep is never double-booked. If nobody qualifies, the appointment is saved **PENDING** and you're alerted — free up capacity and click **Reassign pending**. Every assignment is auto, but you can **override** it from the admin dashboard.

**Roles**
- **Admin (you):** connect the intake calendar, manage reps, set each rep's **weekly cap** + **availability**, view/reassign/cancel appointments.
- **Rep:** connect their own Google Calendar (so assignments land on it), see this week's load vs. cap, upcoming appointments, in-app notifications, and edit their availability.

Built with Next.js (App Router) + TypeScript + Prisma + Postgres + Tailwind. Deploys to **Render**.

---

## 1. Run locally

**Prerequisites:** Node 18+ and Postgres. Quick local Postgres via Docker:

```bash
docker run --name solar-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=solar -p 5432:5432 -d postgres:16
```

Then:

```bash
cp .env.example .env          # edit values (see below)
npm install
npm run db:push               # create tables
npm run db:seed               # optional: admin + 2 sample reps
npm run dev                   # http://localhost:3000
```

**Minimum `.env` to start:**

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/solar?schema=public"
APP_URL="http://localhost:3000"
AUTH_SECRET="<openssl rand -base64 32>"
ADMIN_EMAILS="you@yourcompany.com"
BUSINESS_TIMEZONE="America/Chicago"
APPOINTMENT_MINUTES="60"
CRON_SECRET="<openssl rand -base64 32>"
```

With no SMTP set, **magic-link login URLs print to the terminal** — paste to sign in. Sign in with an email in `ADMIN_EMAILS` for the admin view.

> **Local note on detection:** Google's push webhook can't reach `localhost`, so locally you import appointments with the **“Sync now”** button on the admin dashboard (or by hitting `/api/cron?key=$CRON_SECRET`). Push goes live automatically once deployed with a public HTTPS URL.

---

## 2. Email (magic-link login)

Login uses one-time email links. For real email set SMTP in `.env` — easiest is [Resend](https://resend.com):

```
SMTP_HOST="smtp.resend.com"
SMTP_PORT="587"
SMTP_USER="resend"
SMTP_PASS="re_xxxxxxxx"
EMAIL_FROM="Solar Scheduler <noreply@yourdomain.com>"
```

---

## 3. Google setup

Both the admin (intake calendar) and each rep (destination calendar) connect Google through **one** OAuth client.

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **OAuth consent screen** → External → app name + support email → add scopes `.../auth/calendar.events` and `userinfo.email`. While in "Testing", add each user's Google email as a **Test user** (or publish).
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   - **Authorized redirect URIs:** add both
     `http://localhost:3000/api/google/callback` and
     `https://YOUR-APP.onrender.com/api/google/callback`.
5. Put the client id/secret in `.env`:

```
GOOGLE_CLIENT_ID="...apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="..."
```

**For push notifications (production):** Google only sends webhooks to a **verified domain**. In Google Cloud → **APIs & Services → Domain verification**, verify your Render domain (or a custom domain) and add it. Without verification, the live webhook won't start — the app falls back to the 5-minute cron sync, which still works fine (just not instant).

Refresh tokens are encrypted at rest (AES-256-GCM, keyed off `AUTH_SECRET`).

---

## 4. Deploy to Render

[render.yaml](render.yaml) provisions the web service, a Postgres database, **and** a cron job (renews the push channel + safety sync every 5 min).

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo → apply. Creates `solar-scheduler` (web), `solar-cron`, and `solar-db`. `DATABASE_URL`, `AUTH_SECRET`, and `CRON_SECRET` are wired automatically.
3. Set the `sync: false` env vars in the dashboard:
   - `APP_URL` = `https://YOUR-APP.onrender.com` (in the **solar-shared** env group)
   - `ADMIN_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, SMTP vars.
4. Add the production redirect URI to your Google OAuth client (step 3.4) and verify the domain (step 3, push section).
5. Build runs `prisma db push`. To seed sample reps once, open the service **Shell** and run `npm run db:seed`.

---

## 5. First-run checklist

1. Sign in at `/login` as an admin.
2. **Appointment source** → **Connect Google Calendar** → pick the calendar your appointments land on → **Use this calendar**.
3. **Reps** → add each rep (name, email, weekly cap). They sign in at `/login` and connect their own Google Calendar.
4. Set each rep's **availability** (admin can do it, or reps self-serve).
5. Create a test event on your intake calendar → click **Sync now** (locally) or wait for the push (deployed). It should appear assigned, on a rep's calendar, with the rep notified.

---

## Day-to-day

- **Change how many appointments someone gets:** edit their **Weekly cap** (admin dashboard).
- **Change availability:** admin edits any rep's; reps edit their own.
- **Reassign:** use the rep dropdown on each appointment row — it moves the event between Google calendars and re-notifies.
- **Couldn't auto-assign:** appears **PENDING**; free capacity, then **Reassign pending**.

## Project map

| Path | Purpose |
|------|---------|
| [src/lib/scheduling.ts](src/lib/scheduling.ts) | Assignment engine (two rules) + intake sync + reassign |
| [src/lib/intake.ts](src/lib/intake.ts) | Intake calendar config + Google push channel lifecycle |
| [src/lib/google.ts](src/lib/google.ts) | OAuth, calendar list, watch, incremental sync, event push |
| [src/lib/auth.ts](src/lib/auth.ts) | Magic-link login + sessions |
| [src/app/api/google/notifications](src/app/api/google/notifications/route.ts) | Push webhook |
| [src/app/api/cron](src/app/api/cron/route.ts) | Channel renewal + safety sync |
| [src/app/admin](src/app/admin) | Admin dashboard |
| [src/app/rep](src/app/rep) | Rep dashboard |

## Notes & limits

- Detection is near-instant via push, with a 5-min cron backstop. Time **changes** to an already-imported event aren't re-evaluated (cancellations are); reassign manually if a time moves.
- One availability window per day per rep in the UI (schema supports multiple if you extend the editor).
- For SMS alerts later, add a Twilio call in the notification step of `scheduling.ts`.
