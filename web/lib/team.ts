import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import type { Member } from "@/lib/crm";

/** The signed-in user and their team_members row (null when they're not on the team). Cached per request. */
export const currentMember = cache(async () => {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, member: null };
  const { data: id } = await supabase.rpc("current_member_id");
  if (!id) return { user, member: null };
  const { data } = await supabase.from("team_members").select("id,full_name,email,role,color").eq("id", id).single();
  return { user, member: (data as Member | null) ?? null };
});

export const teamMembers = cache(async () => {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("team_members").select("id,full_name,email,role,color").eq("active", true).order("created_at");
  return (data ?? []) as Member[];
});
