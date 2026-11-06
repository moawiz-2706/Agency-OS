"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { rulesProblems, slugify, DEFAULT_HOURS, type WeekHours } from "@/lib/booking";
import { afterStaffCancel, revokeCalendar } from "@/lib/calendar/bookings";
import type { ActionResult } from "@/lib/action-result";

const str = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" && v.trim() ? v.trim() : null; };
const num = (f: FormData, k: string) => Number(str(f, k) ?? NaN);

async function attempt(fn: () => Promise<string | void>): Promise<ActionResult> {
  try { const m = await fn(); return m ? { ok: true, message: m } : { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" }; }
}

/** A new calendar for me, with sensible defaults; edit it next. */
export async function createCalendar(form: FormData) {
  const name = str(form, "name") ?? "Discovery call";
  const { member } = await currentMember();
  if (!member) throw new Error("Sign in again");
  const supabase = await supabaseServer();
  const base = slugify(`${name} ${member.full_name?.split(/\s+/)[0] ?? ""}`) || "meeting";
  const { data: taken } = await supabase.from("calendars").select("slug").like("slug", `${base}%`);
  const used = new Set((taken ?? []).map((t) => t.slug));
  let slug = base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
  const { data, error } = await supabase.from("calendars").insert({
    host_member_id: member.id, name, slug, timezone: str(form, "timezone") ?? "America/New_York", availability: DEFAULT_HOURS,
    description: "A short call to see where your business loses leads today and what we'd automate first. No cost, no obligation.",
  }).select("id").single();
  if (error) throw new Error(/relation .*calendars/.test(error.message) ? "Run migration 0016 in Supabase first." : error.message);
  revalidatePath("/calendar");
  redirect(`/calendar/${data.id}`);
}

export async function saveCalendar(id: string, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    let availability: WeekHours;
    try { availability = JSON.parse(str(form, "availability") ?? "{}"); } catch { throw new Error("The weekly hours couldn't be read"); }
    const maxPerDay = str(form, "max_per_day");
    const rules = {
      timezone: str(form, "timezone") ?? "", availability, duration_min: num(form, "duration_min"), slot_interval_min: num(form, "slot_interval_min"),
      buffer_before_min: num(form, "buffer_before_min"), buffer_after_min: num(form, "buffer_after_min"),
      min_notice_hours: num(form, "min_notice_hours"), max_days_ahead: num(form, "max_days_ahead"), max_per_day: maxPerDay ? Number(maxPerDay) : null,
    };
    const problems = rulesProblems(rules);
    const name = str(form, "name");
    if (!name) problems.unshift("Give the calendar a name");
    const slug = slugify(str(form, "slug") ?? "");
    if (!slug) problems.push("Give the calendar a link name (letters, numbers and dashes)");
    const location = str(form, "location_type") ?? "google_meet";
    if (!["google_meet", "phone", "custom"].includes(location)) problems.push("Pick where the meeting happens");
    if (location === "custom" && !str(form, "location_detail")) problems.push("Say where the meeting happens (an address or a video link)");
    if (problems.length) throw new Error(problems.join(". "));
    const supabase = await supabaseServer();
    const { error } = await supabase.from("calendars").update({
      ...rules, name, slug, description: str(form, "description"), location_type: location, location_detail: str(form, "location_detail"),
      confirmation_note: str(form, "confirmation_note"), active: form.get("active") === "on", host_member_id: str(form, "host_member_id") ?? undefined,
    }).eq("id", id);
    if (error) throw new Error(/calendars_slug_key|duplicate/.test(error.message) ? "That link name is taken: pick another" : error.message);
    revalidatePath("/calendar");
    revalidatePath(`/calendar/${id}`);
    return "Saved. The booking page shows the changes straight away.";
  });
}

export async function deleteCalendar(id: string) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("calendars").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/calendar");
  redirect("/calendar");
}

/** Cancel a meeting from AgencyOS; its Google Calendar event goes too (Google tells the client). */
export async function cancelBookingAction(id: string, reason: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc("cancel_booking", { p_id: id, p_reason: reason });
    if (error) throw new Error(error.message);
    await afterStaffCancel(data as { host_member_id: string | null; google_event_id: string | null });
    revalidatePath("/calendar");
    return "Cancelled. If it was in Google Calendar, the client got a cancellation from Google.";
  });
}

export async function setCalendarOptions(checkConflicts: boolean, addEvents: boolean): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await supabaseServer();
    const { error } = await supabase.rpc("set_my_calendar_options", { p_check_conflicts: checkConflicts, p_add_events: addEvents });
    if (error) throw new Error(error.message);
    revalidatePath("/calendar");
    return "Saved";
  });
}

export async function disconnectGoogleCalendar(): Promise<ActionResult> {
  return attempt(async () => {
    const { member } = await currentMember();
    if (!member) throw new Error("Sign in again");
    await revokeCalendar(member.id);
    const supabase = await supabaseServer();
    const { error } = await supabase.rpc("disconnect_my_calendar");
    if (error) throw new Error(error.message);
    revalidatePath("/calendar");
    return "Google Calendar disconnected";
  });
}

/** Make this calendar the team's booking link (used in suggested replies and the marketing email button). */
export async function setTeamBookingLink(url: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await supabaseServer();
    const { error } = await supabase.rpc("set_booking_url", { p_url: url });
    if (error) throw new Error(error.message);
    revalidatePath("/calendar");
    revalidatePath("/account");
    return "This is now the booking link in suggested replies and the marketing email button.";
  });
}
