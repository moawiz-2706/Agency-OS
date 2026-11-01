// Sorting replies: the labels, a suggested label from the reply's words, and a suggested
// answer. Suggestions only: a person picks the label. No app imports, so `node --test`
// can load it directly.

export const REPLY_LABELS = [
  { key: "interested", label: "Interested" },
  { key: "meeting_request", label: "Wants a call" },
  { key: "question", label: "Question" },
  { key: "pricing", label: "Asked price" },
  { key: "not_now", label: "Not now" },
  { key: "not_interested", label: "Not interested" },
  { key: "unsubscribe", label: "Unsubscribe" },
] as const;
export type ReplyLabel = (typeof REPLY_LABELS)[number]["key"];

const RULES: [ReplyLabel, RegExp][] = [
  ["unsubscribe", /\b(unsubscribe|remove me|take me off|stop (emailing|contacting)|do not (email|contact))\b/i],
  ["not_interested", /\b(not interested|no thanks|no thank you|we('re| are) (good|all set|covered)|already (have|use|using)|don'?t need|not a fit|pass\b)/i],
  ["not_now", /\b(not (right )?now|maybe later|later this year|next (month|quarter|year|season)|busy season|circle back|reach out (again )?(later|in)|check back)\b/i],
  ["meeting_request", /\b(call me|give me a call|set up a call|hop on a call|(a )?quick call|meeting|zoom|calendar|book (a|some) time|schedule|what time|available (on|this|next)|let'?s talk|let'?s chat)\b/i],
  ["pricing", /\b(price|pricing|cost|how much|quote|fees?|charge|per month|budget)\b|\$\d/i],
  ["interested", /\b(interested|sounds (good|great|interesting)|tell me more|send (me )?(more|info|details|the video)|i'?m in|yes\b|sure\b|love to)/i],
];

/** The label a reply most likely needs, or null when nothing stands out. */
export function suggestLabel(text: string | null | undefined): ReplyLabel | null {
  const t = (text ?? "").slice(0, 2000);
  for (const [label, re] of RULES) if (re.test(t)) return label;
  return /\?/.test(t) ? "question" : null;
}

/** A short answer to start from. Uses the booking link when there is one. */
export function suggestedReply(label: ReplyLabel, v: { first_name?: string | null; my_name?: string | null; booking_url?: string | null }) {
  const hi = `Hi ${v.first_name?.trim() || "there"},`;
  const me = v.my_name?.trim() || "";
  const book = v.booking_url ? `Here's my calendar, pick any time that suits you: ${v.booking_url}` : "What day and time suit you this week?";
  const body: Record<ReplyLabel, string> = {
    interested: `Great to hear. The easiest next step is a quick 15-minute call where I show you exactly how it would work for you.\n\n${book}`,
    meeting_request: `Happy to. ${book}`,
    question: "Good question. [answer]\n\nIf it's easier, we can go through it on a quick call. " + book,
    pricing: "Setup is a one-off fee and then a flat monthly fee, no contract. The exact number depends on what you need switched on, "
      + `so I'd rather not guess. On a 15-minute call I can give you a firm price. ${book}`,
    not_now: "No problem at all, thanks for letting me know. I'll check back in a couple of months. If anything changes before then, just reply here.",
    not_interested: "Understood, thanks for the quick reply. I won't follow up again. All the best with the season.",
    unsubscribe: "Done, you won't hear from me again. Sorry for the interruption.",
  };
  return `${hi}\n\n${body[label]}${me ? `\n\n${me}` : ""}`;
}
