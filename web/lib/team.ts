import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import type { Member } from "@/lib/crm";

/** "active" (full CRM), "pending" (signed in, waiting for the owner's approval) or null (not on the team). */
export type MemberStatus = "active" | "pending" | null;

/** The signed-in user, their team_members row (only when active) and their status. Cached per request. */
export const currentMember = cache(async () => {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, member: null, status: null as MemberStatus };
  const { data: status } = await supabase.rpc("my_member_status");
  const { data: id } = await supabase.rpc("current_member_id");
  if (!id) return { user, member: null, status: (status as MemberStatus) ?? null };
  const { data } = await supabase.from("team_members").select("id,full_name,email,role,color").eq("id", id).single();
  return { user, member: (data as Member | null) ?? null, status: "active" as MemberStatus };
});

export const teamMembers = cache(async () => {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("team_members").select("id,full_name,email,role,color").eq("active", true).order("created_at");
  return (data ?? []) as Member[];
});
