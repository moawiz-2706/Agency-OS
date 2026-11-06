import type { Metadata } from "next";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember, teamMembers } from "@/lib/team";
import { memberName } from "@/lib/crm";
import { appOrigin } from "@/lib/mail/env";
import { PageHeader } from "@/components/page-header";
import { CalendarHome, type CalendarRow, type MeetingRow } from "@/components/calendar-home";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

/** Meetings from yesterday on (also keeps today's earlier ones on screen). */
const sinceYesterday = () => new Date(Date.now() - 86400_000).toISOString();
const nowMs = () => Date.now();

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ gcal?: string; reason?: string }> }) {
  const { gcal, reason } = await searchParams;
  const supabase = await supabaseServer();
  const since = sinceYesterday();
  const [{ member }, team, calRes, bookRes, mine, others, booking, h] = await Promise.all([
    currentMember(),
    teamMembers(),
    supabase.from("calendars").select("id,name,slug,duration_min,host_member_id,active,timezone").order("created_at"),
    supabase.from("bookings").select("id,name,email,phone,company_name,notes,start_at,end_at,status,meet_url,company_id,host_member_id,calendar_id,cancel_reason")
      .gte("end_at", since).order("start_at").limit(300),
    supabase.rpc("my_calendar_account"),
    supabase.rpc("team_calendar_accounts"),
    supabase.rpc("booking_url"),
    headers(),
  ]);
  const nameOf = new Map(team.map((t) => [t.id, memberName(t)]));
  const calendars = (calRes.data ?? []) as CalendarRow[];
  const calName = new Map(calendars.map((c) => [c.id, c.name]));
  const meetings: MeetingRow[] = ((bookRes.data ?? []) as Omit<MeetingRow, "host" | "calendar" | "mine">[]).map((b) => ({
    ...b, host: (b.host_member_id && nameOf.get(b.host_member_id)) || "?", calendar: calName.get(b.calendar_id) ?? "", mine: b.host_member_id === member?.id,
  }));
  const google = ((mine.data ?? []) as { email: string; check_conflicts: boolean; add_events: boolean; last_error: string | null; needs_reconnect: boolean }[])[0] ?? null;
  const connected = new Map(((others.data ?? []) as { member_id: string; email: string; needs_reconnect: boolean }[]).map((a) => [a.member_id, a]));

  return (
    <>
      <PageHeader title="Calendar" description="Booking pages clients can use, the meetings they book, and your Google Calendar." />
      {calRes.error && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          The calendar needs migration 0016: run it in Supabase (SQL Editor), then reload. ({calRes.error.message})
        </p>
      )}
      <CalendarHome
        origin={appOrigin(h)} calendars={calendars.map((c) => ({ ...c, host: nameOf.get(c.host_member_id) ?? "?", google: connected.has(c.host_member_id) }))}
        meetings={meetings} google={google} isOwner={member?.role === "owner"} bookingUrl={(booking.data as string | null) ?? null}
        gcal={gcal ?? null} reason={reason ?? null} ready={!calRes.error} now={nowMs()}
        team={team.map((t) => ({ name: memberName(t), google: connected.get(t.id)?.email ?? null, reconnect: connected.get(t.id)?.needs_reconnect ?? false }))}
      />
    </>
  );
}
