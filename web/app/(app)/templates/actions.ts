"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { normalizeDesign, type EmailDesign } from "@/lib/mail/design";
import type { ActionResult } from "@/lib/action-result";

/** Save the team's email design (owners only; the database checks it too). */
export async function saveEmailDesign(design: EmailDesign): Promise<ActionResult> {
  const d = normalizeDesign(design);
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_email_design", { p_design: d });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/templates");
  return { ok: true, message: "Saved. Every email from now on (including the ones already scheduled) goes out in this design." };
}
