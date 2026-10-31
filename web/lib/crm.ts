// Stages, channels and outcomes: the same values as the crm_stage enum and the
// touches check constraints in supabase/migrations/0003_crm.sql.

export const STAGES = [
  "new", "researching", "ready", "contacted", "replied", "interested",
  "meeting_booked", "proposal_sent", "won", "lost", "nurture", "disqualified",
] as const;
export type Stage = (typeof STAGES)[number];

/** Stages shown as pipeline columns. */
export const OPEN_STAGES: Stage[] = [
  "new", "researching", "ready", "contacted", "replied", "interested", "meeting_booked", "proposal_sent", "nurture",
];

export const STAGE_LABEL: Record<Stage, string> = {
  new: "New", researching: "Researching", ready: "Ready", contacted: "Contacted", replied: "Replied",
  interested: "Interested", meeting_booked: "Meeting booked", proposal_sent: "Proposal sent", won: "Won",
  lost: "Lost", nurture: "Nurture", disqualified: "Disqualified",
};

/** Badge tint per stage: neutral for early stages, warmer as a lead gets closer to won. */
export const STAGE_COLOR: Record<Stage, string> = {
  new: "bg-muted text-muted-foreground border-transparent",
  researching: "bg-sky-50 text-sky-700 border-sky-200",
  ready: "bg-cyan-50 text-cyan-700 border-cyan-200",
  contacted: "bg-indigo-50 text-indigo-700 border-indigo-200",
  replied: "bg-violet-50 text-violet-700 border-violet-200",
  interested: "bg-amber-50 text-amber-700 border-amber-200",
  meeting_booked: "bg-orange-50 text-orange-700 border-orange-200",
  proposal_sent: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
  won: "bg-emerald-50 text-emerald-700 border-emerald-200",
  lost: "bg-rose-50 text-rose-700 border-rose-200",
  nurture: "bg-lime-50 text-lime-700 border-lime-200",
  disqualified: "bg-zinc-100 text-zinc-500 border-zinc-200",
};

export const CHANNELS = ["call", "email", "loom", "sms", "linkedin", "research", "meeting", "proposal", "other"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = {
  call: "Call", email: "Email", loom: "Loom", sms: "SMS", linkedin: "LinkedIn", research: "Research",
  meeting: "Meeting", proposal: "Proposal", other: "Other",
};

export const OUTCOMES = [
  "done", "sent", "no_answer", "left_voicemail", "replied", "interested", "not_interested",
  "meeting_booked", "won", "lost", "other",
] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABEL: Record<Outcome, string> = {
  done: "Done", sent: "Sent", no_answer: "No answer", left_voicemail: "Left voicemail", replied: "Replied",
  interested: "Interested", not_interested: "Not interested", meeting_booked: "Meeting booked", won: "Won",
  lost: "Lost", other: "Other",
};

/** Outcomes that count as a lead moving our way. */
export const POSITIVE: Outcome[] = ["replied", "interested", "meeting_booked", "won"];
/** Channels that reach the prospect (research and internal work don't count as contact). */
export const OUTREACH: Channel[] = ["call", "email", "loom", "sms", "linkedin", "meeting", "proposal"];

export type Member = { id: string; full_name: string | null; email: string; role: "owner" | "partner"; color: string };

export const memberName = (m?: Pick<Member, "full_name" | "email"> | null) =>
  m ? m.full_name || m.email.split("@")[0] : "Unassigned";

export const initials = (m?: Pick<Member, "full_name" | "email"> | null) =>
  memberName(m).split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/**
 * Categorical palette (validated for colour-blind separation, in this fixed order).
 * Each team member keeps their slot everywhere: charts, avatars, pipeline cards.
 */
export const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const UNASSIGNED_COLOR = "#a8a29e";

/** Colour for a member by their position in the team list (oldest first), never by rank in a chart. */
export function memberColor(team: Pick<Member, "id">[], id: string | null | undefined) {
  if (!id) return UNASSIGNED_COLOR;
  const i = team.findIndex((m) => m.id === id);
  return i < 0 ? UNASSIGNED_COLOR : PALETTE[i % PALETTE.length];
}
