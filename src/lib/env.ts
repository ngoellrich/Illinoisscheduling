// Centralized, validated environment access. Throws early with clear messages.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const env = {
  databaseUrl: () => required("DATABASE_URL"),
  appUrl: () => optional("APP_URL", "http://localhost:3000").replace(/\/$/, ""),
  authSecret: () => required("AUTH_SECRET"),
  adminEmails: () =>
    optional("ADMIN_EMAILS", "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  timezone: () => optional("BUSINESS_TIMEZONE", "America/Chicago"),
  appointmentMinutes: () => parseInt(optional("APPOINTMENT_MINUTES", "60"), 10),

  google: () => ({
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: `${optional("APP_URL", "http://localhost:3000").replace(/\/$/, "")}/api/google/callback`,
  }),
  googleConfigured: () =>
    !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,

  smtp: () => ({
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.EMAIL_FROM || "Solar Scheduler <noreply@example.com>",
  }),
  smtpConfigured: () => !!process.env.SMTP_HOST,
};
