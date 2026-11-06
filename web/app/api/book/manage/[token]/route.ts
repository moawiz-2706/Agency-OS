import { NextResponse, type NextRequest } from "next/server";
import { cancelByToken } from "@/lib/calendar/bookings";

export const dynamic = "force-dynamic";

/** The client cancels from the link in their confirmation. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  const { token } = await params;
  if (!/^[a-f0-9]{32,80}$/.test(token)) return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 });
  const body = await req.json().catch(() => ({})) as { reason?: unknown };
  try {
    await cancelByToken(token, typeof body.reason === "string" ? body.reason.slice(0, 500) : "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/can't be cancelled|not found/.test(msg)) return NextResponse.json({ ok: false, error: "This booking was already cancelled or has passed." }, { status: 400 });
    console.error("booking cancel:", msg);
    return NextResponse.json({ ok: false, error: "Something went wrong. Please email us to cancel." }, { status: 500 });
  }
}
