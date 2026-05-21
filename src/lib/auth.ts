import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { env } from "./env";
import { randomToken } from "./crypto";
import { sendEmail } from "./mailer";
import type { Role, User } from "@prisma/client";

const SESSION_COOKIE = "solar_session";
const SESSION_DAYS = 30;
const MAGIC_LINK_MINUTES = 20;

// ---- Magic-link login --------------------------------------------------------

/**
 * Create (or find) a user by email and email them a one-time login link.
 * First-time emails listed in ADMIN_EMAILS become ADMIN; everyone else is REP.
 */
export async function requestMagicLink(rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Enter a valid email.");

  const isAdmin = env.adminEmails().includes(email);
  const user = await prisma.user.upsert({
    where: { email },
    update: isAdmin ? { role: "ADMIN" } : {},
    create: { email, role: isAdmin ? "ADMIN" : "REP" },
  });

  const token = randomToken();
  await prisma.magicLink.create({
    data: {
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + MAGIC_LINK_MINUTES * 60 * 1000),
    },
  });

  const url = `${env.appUrl()}/auth/verify?token=${token}`;
  await sendEmail(
    email,
    "Your Solar Scheduler login link",
    `<p>Click to sign in (valid ${MAGIC_LINK_MINUTES} minutes):</p>
     <p><a href="${url}">Sign in to Solar Scheduler</a></p>
     <p>If you didn't request this, ignore this email.</p>`,
    `Sign in: ${url}`
  );
}

/** Consume a magic-link token and start a session. Returns the user or null. */
export async function consumeMagicLink(token: string): Promise<User | null> {
  const link = await prisma.magicLink.findUnique({ where: { token } });
  if (!link || link.usedAt || link.expiresAt < new Date()) return null;

  await prisma.magicLink.update({ where: { id: link.id }, data: { usedAt: new Date() } });
  const user = await prisma.user.findUnique({ where: { id: link.userId } });
  if (!user || !user.active) return null;

  await startSession(user.id);
  return user;
}

// ---- Sessions ----------------------------------------------------------------

export async function startSession(userId: string): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user.active ? session.user : null;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export async function requireRole(role: Role): Promise<User> {
  const user = await requireUser();
  if (user.role !== role) throw new Error("FORBIDDEN");
  return user;
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { token } });
  jar.delete(SESSION_COOKIE);
}
