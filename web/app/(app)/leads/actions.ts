"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { CHANNELS, OUTCOMES, STAGES, type Stage } from "@/lib/crm";
import { teamLocalToIso } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";

// Every write runs as the signed-in user, so RLS decides what's allowed and the
// database triggers record who did it.

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const isStage = (v: string | null): v is Stage => !!v && (STAGES as readonly string[]).includes(v);
const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

async function check<T extends { error: { message: string } | null }>(p: PromiseLike<T>) {
  const res = await p;
  if (res.error) throw new Error(res.error.message);
  return res;
}

/** Run a write and turn any failure into a message the form can show. */
async function attempt(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export async function bulkUpdate(form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const ids = form.getAll("ids").map(String).filter((v) => uuid(v));
    const action = str(form, "bulk_action");
    if (!ids.length || !action) throw new Error("Select leads and an action");
    const supabase = await supabaseServer();
    if (action.startsWith("stage:")) {
      const stage = action.slice(6);
      if (!isStage(stage)) throw new Error("Unknown stage");
      await check(supabase.from("companies").update({ stage }).in("id", ids));
    } else if (action.startsWith("owner:")) {
      const owner = action.slice(6);
      await check(supabase.from("companies").update({ owner_id: owner === "none" ? null : uuid(owner) }).in("id", ids));
    }
    revalidatePath("/leads");
  });
}

export async function updateLead(id: string, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const stage = str(form, "stage");
    const owner = str(form, "owner_id");
    const deal = str(form, "deal_value");
    const currency = str(form, "deal_currency");
    const patch = {
      ...(isStage(stage) && { stage }),
      owner_id: owner && owner !== "none" ? uuid(owner) : null,
      next_step: str(form, "next_step"),
      next_step_at: teamLocalToIso(str(form, "next_step_at")),
      deal_value_cents: deal ? Math.round(Number(deal.replace(/[^0-9.]/g, "")) * 100) || null : null,
      deal_currency: currency === "CAD" ? "CAD" : "USD",
      lost_reason: str(form, "lost_reason"),
    };
    const supabase = await supabaseServer();
    await check(supabase.from("companies").update(patch).eq("id", id));
    revalidatePath(`/leads/${id}`);
  });
}

export async function logTouch(id: string, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const channel = str(form, "channel");
    const outcome = str(form, "outcome") ?? "done";
    if (!channel || !(CHANNELS as readonly string[]).includes(channel) || !(OUTCOMES as readonly string[]).includes(outcome)) {
      throw new Error("Pick a channel and an outcome");
    }
    const mins = Math.max(0, Math.min(600, Math.round(Number(str(form, "minutes") ?? 0)) || 0));
    const supabase = await supabaseServer();
    await check(supabase.from("touches").insert({
      company_id: id,
      contact_id: uuid(str(form, "contact_id")),
      channel,
      outcome,
      direction: outcome === "replied" ? "inbound" : channel === "research" ? "internal" : "outbound",
      minutes: mins,
      summary: str(form, "summary"),
      happened_at: teamLocalToIso(str(form, "happened_at")) ?? new Date().toISOString(),
    }));
    const nextStep = str(form, "next_step");
    const nextAt = teamLocalToIso(str(form, "next_step_at"));
    if (nextStep || nextAt) {
      await check(supabase.from("companies").update({ next_step: nextStep, next_step_at: nextAt }).eq("id", id));
    }
    revalidatePath(`/leads/${id}`);
  });
}

export async function addNote(id: string, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const body = str(form, "body");
    if (!body) throw new Error("Write something first");
    const supabase = await supabaseServer();
    await check(supabase.from("notes").insert({ company_id: id, body, pinned: form.get("pinned") === "on" }));
    revalidatePath(`/leads/${id}`);
  });
}

export async function addContact(id: string, country: string | null, form: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const email = str(form, "email")?.toLowerCase() ?? null;
    const fullName = str(form, "full_name");
    if (!email && !fullName && !str(form, "phone")) throw new Error("Add a name, email or phone");
    const supabase = await supabaseServer();
    if (email) {
      const domain = email.split("@")[1];
      const { data: sup } = await supabase.from("suppressions").select("id").or(`email.eq."${email}",domain.eq."${domain}"`).limit(1);
      if (sup?.length) throw new Error(`${email} is on the never-contact list`);
    }
    const ownSite = form.get("published_on_own_site") === "on";
    await check(supabase.from("contacts").insert({
      company_id: id,
      full_name: fullName,
      role: str(form, "role"),
      email,
      phone: str(form, "phone"),
      source_url: str(form, "source_url"),
      source: "manual",
      email_published_publicly: ownSite,
      // US: cold B2B is allowed. Canada: only with proof it's published on their own site (CASL).
      consent_basis: !email ? "unknown" : country === "US" ? "can_spam_b2b" : country === "CA" && ownSite && str(form, "source_url") ? "casl_implied_published" : "unknown",
    }));
    revalidatePath(`/leads/${id}`);
  });
}
