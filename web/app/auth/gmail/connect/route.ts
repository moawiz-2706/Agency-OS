import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { currentMember } from "@/lib/team";
import { STATE_COOKIE, authUrl } from "@/lib/mail/google";

/** Start connecting the signed-in member's Gmail: off to Google's consent screen. */
export async function GET(request: NextRequest) {
  const { member } = await currentMember();
  if (!member) return NextResponse.redirect(new URL("/login", request.url));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(`${request.nextUrl.origin}/auth/gmail/callback`, state, member.email));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/auth/gmail", maxAge: 600 });
  return res;
}
