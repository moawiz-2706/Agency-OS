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

export const STAGE_COLOR: Record<Stage, string> = {
  new: "bg-slate-100 text-slate-700", researching: "bg-sky-100 text-sky-800", ready: "bg-cyan-100 text-cyan-800",
  contacted: "bg-indigo-100 text-indigo-800", replied: "bg-violet-100 text-violet-800",
  interested: "bg-amber-100 text-amber-800", meeting_booked: "bg-orange-100 text-orange-800",
  proposal_sent: "bg-fuchsia-100 text-fuchsia-800", won: "bg-emerald-100 text-emerald-800",
  lost: "bg-rose-100 text-rose-800", nurture: "bg-lime-100 text-lime-800", disqualified: "bg-zinc-200 text-zinc-600",
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
