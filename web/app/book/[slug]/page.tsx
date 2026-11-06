import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicCalendar } from "@/lib/calendar/bookings";
import { BookingWidget } from "@/components/booking-widget";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ embed?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = await publicCalendar(slug).catch(() => null);
  return { title: c ? `${c.name} · The Sentinel Systems` : "Book a meeting", robots: { index: false, follow: false } };
}

/** The public booking page: share the link, or put it on the website in an iframe (?embed=1). */
export default async function BookPage({ params, searchParams }: Props) {
  const [{ slug }, { embed }] = await Promise.all([params, searchParams]);
  let c: Awaited<ReturnType<typeof publicCalendar>> = null;
  try {
    c = await publicCalendar(slug);
  } catch (e) {
    console.error("booking page:", e instanceof Error ? e.message : e);
    return <p className="p-10 text-center text-sm text-muted-foreground">Booking isn&apos;t available right now. Please try again later or email us.</p>;
  }
  if (!c) notFound();
  return (
    <BookingWidget embed={embed === "1"} calendar={{
      slug: c.slug, name: c.name, description: c.description, host_name: c.host_name, duration_min: c.duration_min, timezone: c.timezone,
      location_type: c.location_type, location_detail: c.location_detail, max_days_ahead: c.max_days_ahead,
    }} />
  );
}
