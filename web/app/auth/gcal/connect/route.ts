import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { currentMember } from "@/lib/team";
import { STATE_COOKIE, authUrl } from "@/lib/mail/google";
import { CALENDAR_SCOPES } from "@/lib/calendar/google-calendar";
import { gmailRedirectUri } from "@/lib/mail/env";

/**
 * Connect the signed-in member's Google Calendar. It reuses the Gmail return address
 * (/auth/gmail/callback, already allowed in Google Cloud); the "cal." state tells the
 * callback it's the calendar.
 */
export async function GET(request: NextRequest) {
  const { member } = await currentMember();
  if (!member) return NextResponse.redirect(new URL("/login", request.url));
  const state = `cal.${randomBytes(24).toString("base64url")}`;
  const res = NextResponse.redirect(authUrl(gmailRedirectUri(request.headers), state, member.email, CALENDAR_SCOPES));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/auth/gmail", maxAge: 600 });
  return res;
}
