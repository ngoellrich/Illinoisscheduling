import nodemailer from "nodemailer";
import { env } from "./env";

// Sends email via SMTP when configured; otherwise logs to the server console
// (handy in local dev — the magic link is printed so you can click it).

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!env.smtpConfigured()) return null;
  if (!transporter) {
    const s = env.smtp();
    transporter = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.port === 465,
      auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string, text?: string) {
  const t = getTransporter();
  if (!t) {
    console.log("\n──────── EMAIL (SMTP not configured) ────────");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log(text || html.replace(/<[^>]+>/g, ""));
    console.log("─────────────────────────────────────────────\n");
    return;
  }
  await t.sendMail({ from: env.smtp().from, to, subject, html, text });
}
