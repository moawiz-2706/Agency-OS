import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { teamMembers } from "@/lib/team";
import { memberName } from "@/lib/crm";
import { appOrigin } from "@/lib/mail/env";
import { PageHeader } from "@/components/page-header";
import { CalendarEditor, type EditableCalendar } from "@/components/calendar-editor";

export const metadata: Metadata = { title: "Edit calendar" };
export const dynamic = "force-dynamic";

export default async function EditCalendarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const [{ data }, team, h] = await Promise.all([
    supabase.from("calendars").select("*").eq("id", id).maybeSingle(),
    teamMembers(),
    headers(),
  ]);
  if (!data) notFound();
  const c = data as EditableCalendar;
  return (
    <>
      <Link href="/calendar" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Calendar</Link>
      <PageHeader title={c.name} description="Set when clients can book you. Changes show on the booking page straight away." />
      <CalendarEditor calendar={c} origin={appOrigin(h)} team={team.map((t) => ({ id: t.id, name: memberName(t) }))} />
    </>
  );
}
