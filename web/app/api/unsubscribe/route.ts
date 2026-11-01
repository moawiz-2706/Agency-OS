import { NextResponse, type NextRequest } from "next/server";
import { verifyUnsubscribe } from "@/lib/mail/unsubscribe";
import { unsubscribeAddress } from "@/lib/mail/worker";

export const dynamic = "force-dynamic";

// The link in every outreach email's List-Unsubscribe header.
// POST is the one-click unsubscribe that Gmail/Yahoo send (RFC 8058); a person who
// opens the link gets the confirmation page instead, so link scanners can't unsubscribe anyone.

export function GET(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/unsubscribe";
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  const email = verifyUnsubscribe(req.nextUrl.searchParams.get("e"), req.nextUrl.searchParams.get("t"));
  if (!email) return new NextResponse("This unsubscribe link isn't valid.", { status: 400 });
  try {
    await unsubscribeAddress(email);
    return new NextResponse("You're unsubscribed.", { status: 200 });
  } catch {
    return new NextResponse("Something went wrong. Reply to the email with \"unsubscribe\" instead.", { status: 500 });
  }
}
