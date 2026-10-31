import { initials, memberColor, memberName, type Member } from "@/lib/crm";
import { cn } from "@/lib/utils";

/** Coloured initials for a team member; the colour is their fixed palette slot. */
export function MemberAvatar({ team, id, size = "md", className }: {
  team: Member[]; id: string | null | undefined; size?: "sm" | "md"; className?: string;
}) {
  const m = id ? team.find((t) => t.id === id) : null;
  return (
    <span
      title={memberName(m)}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white",
        size === "sm" ? "size-5 text-[10px]" : "size-7 text-xs",
        className,
      )}
      style={{ background: memberColor(team, id) }}
    >
      {m ? initials(m) : "–"}
    </span>
  );
}

export function MemberLabel({ team, id }: { team: Member[]; id: string | null | undefined }) {
  const m = id ? team.find((t) => t.id === id) : null;
  return (
    <span className="inline-flex items-center gap-2">
      <MemberAvatar team={team} id={id} size="sm" />
      <span className={m ? "" : "text-muted-foreground"}>{memberName(m)}</span>
    </span>
  );
}
