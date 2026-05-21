import { NextResponse } from "next/server";
import { logout } from "@/lib/auth";
import { env } from "@/lib/env";

export async function POST() {
  await logout();
  return NextResponse.redirect(`${env.appUrl()}/login`, { status: 303 });
}
