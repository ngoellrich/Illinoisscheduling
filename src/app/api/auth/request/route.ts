import { NextResponse } from "next/server";
import { requestMagicLink } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    await requestMagicLink(String(email || ""));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to send link." },
      { status: 400 }
    );
  }
}
