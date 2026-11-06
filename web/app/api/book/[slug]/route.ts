import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { checkBookingForm } from "@/lib/booking";
import { createBooking, slotsFor } from "@/lib/calendar/bookings";
import { envValue } from "@/lib/mail/env";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The public booking page (/book/<slug>, also inside an iframe on the website) asks for
// free times and saves a booking here. Same-origin only: the page itself is ours.

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const from = req.nextUrl.searchParams.get("from");
  const days = Number(req.nextUrl.searchParams.get("days") ?? 7);
  try {
    const r = await slotsFor(slug, from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null, Number.isFinite(days) ? days : 7);
    if (!r) return NextResponse.json({ error: "This calendar isn't available." }, { status: 404 });
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("booking slots:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't load times. Please try again." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  const { slug } = await params;
  let data: Record<string, unknown>;
  try { data = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Couldn't read the form." }, { status: 400 }); }
  const checked = checkBookingForm(data);
  if (checked.ok === "spam") return NextResponse.json({ ok: true, spam: true });
  if (!checked.ok) return NextResponse.json({ ok: false, error: checked.error }, { status: 400 });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ipHash = createHash("sha256").update(`${envValue("MAILER_SECRET") ?? ""}:${ip}`).digest("hex").slice(0, 32);
  try {
    const b = await createBooking(slug, checked.form, req.headers.get("referer") ?? "", ipHash);
    return NextResponse.json({ ok: true, ...b, manage: `/book/manage/${b.token}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/just taken|passed/.test(msg)) return NextResponse.json({ ok: false, error: "Sorry, that time was just taken. Please pick another.", taken: true }, { status: 409 });
    if (/too many/.test(msg)) return NextResponse.json({ ok: false, error: "Too many bookings from here. Please try again later." }, { status: 429 });
    if (/closed|valid email|your name/.test(msg)) return NextResponse.json({ ok: false, error: msg.replace(/^.*?: /, "") }, { status: 400 });
    console.error("booking:", msg);
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again or email us." }, { status: 500 });
  }
}
