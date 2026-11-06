import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bookingByToken } from "@/lib/calendar/bookings";
import { ManageBooking } from "@/components/manage-booking";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your booking · The Sentinel Systems", robots: { index: false, follow: false } };

/** The client's own link: see the booking, cancel it, or book another time. */
const isPast = (iso: string) => Date.parse(iso) < Date.now();

export default async function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await bookingByToken(token).catch(() => null);
  if (!b) notFound();
  return <ManageBooking token={token} booking={b} past={isPast(b.end)} />;
}
