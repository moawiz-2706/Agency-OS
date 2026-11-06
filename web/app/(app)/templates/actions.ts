"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { normalizeDesign, normalizeMarketing, type EmailDesign, type EmailKind, type MarketingDesign } from "@/lib/mail/design";
import type { ActionResult } from "@/lib/action-result";

const KINDS: EmailKind[] = ["outreach", "marketing"];

/** Save the cold-outreach email design (owners only; the database checks it too). */
export async function saveEmailDesign(design: EmailDesign): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_email_design", { p_design: normalizeDesign(design) });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/templates");
  return { ok: true, message: "Saved. Every outreach email from now on (including the ones already scheduled) goes out in this design." };
}

/** Save the marketing design (header, tagline, button). Needs migration 0015. */
export async function saveMarketingDesign(design: MarketingDesign): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_email_marketing", { p: normalizeMarketing(design) });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/templates");
  return { ok: true, message: "Saved the marketing design." };
}

/** Fix one waiting email: its text and design. Its author or an owner. */
export async function updateScheduledEmail(id: string, subject: string, body: string, design: EmailKind): Promise<ActionResult> {
  if (!KINDS.includes(design)) return { ok: false, error: "Pick a design" };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("team_update_email", { p_id: id, p_subject: subject, p_body: body, p_design: design });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/templates");
  return {
    ok: true,
    message: data === "needs_approval"
      ? "Saved. It's from a teammate's inbox, so it now waits for their approval again (Inbox → Approve all)."
      : "Saved. It goes out at its scheduled time.",
  };
}

/** One design for many waiting emails. */
export async function setScheduledDesign(ids: string[], design: EmailKind): Promise<ActionResult> {
  if (!KINDS.includes(design)) return { ok: false, error: "Pick a design" };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_emails_design", { p_ids: ids, p_design: design });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/templates");
  const n = data as number;
  return { ok: true, message: `${n} email${n === 1 ? "" : "s"} set to the ${design === "marketing" ? "marketing" : "cold outreach"} design.${n < ids.length ? ` ${ids.length - n} you can't change (a teammate's).` : ""}` };
}
