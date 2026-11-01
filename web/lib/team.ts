import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import type { Member } from "@/lib/crm";

/** "active" (full CRM), "pending" (signed in, waiting for the owner's approval) or null (not on the team). */
export type MemberStatus = "active" | "pending" | null;

type TeamRow = Member & { user_id: string | null };

/**
 * The whole active team, read once per request. RLS only shows it to active members,
 * so a signed-in person who sees nothing isn't (yet) on the team.
 */
const activeTeam = cache(async () => {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("team_members").select("id,full_name,email,role,color,user_id").eq("active", true).order("created_at");
  return (data ?? []) as TeamRow[];
});

/**
 * The signed-in user, their team_members row (only when active) and their status. Cached per request.
 * The sign-in check and the team read run at the same time: every page waits on this.
 */
export const currentMember = cache(async () => {
  const supabase = await supabaseServer();
  const [{ data: claims }, team] = await Promise.all([supabase.auth.getClaims(), activeTeam()]);
  const sub = claims?.claims?.sub;
  if (!sub) return { user: null, member: null, status: null as MemberStatus };
  const email = typeof claims.claims.email === "string" ? claims.claims.email : "";
  const user = { id: sub, email };
  // Same rule as current_member_id(): linked by user id, or by email before the first sign-in links it.
  const row = team.find((m) => m.user_id === sub) ?? team.find((m) => !m.user_id && email && m.email?.toLowerCase() === email.toLowerCase());
  if (row) {
    const { user_id: _linked, ...member } = row;
    void _linked;
    return { user, member: member as Member, status: "active" as MemberStatus };
  }
  const { data: status } = await supabase.rpc("my_member_status");
  return { user, member: null, status: (status as MemberStatus) ?? null };
});

export const teamMembers = cache(async () =>
  (await activeTeam()).map(({ user_id: _linked, ...m }) => { void _linked; return m as Member; }));
