import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runMail } from "@/lib/mail/worker";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Called every 5 minutes by pg_cron (Authorization: Bearer CRON_SECRET): sync every inbox, send what's due. */
async function tick(request: NextRequest) {
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  const got = request.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const reports = await runMail();
  // Addresses stay out of the response (pg_net keeps responses in a table).
  return NextResponse.json({
    inboxes: reports.length,
    sent: reports.filter((r) => r.sent).length,
    errors: reports.filter((r) => r.error).length,
  });
}

export const GET = tick;
export const POST = tick;
