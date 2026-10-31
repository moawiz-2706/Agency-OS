import Link from "next/link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type BarListItem = { key: string; label: string; value: number; display: string; detail?: string; href?: string };

/**
 * Horizontal bars with the label and value written beside each one (one series,
 * one hue), plus a hover tooltip with the detail. Bars start at zero.
 */
export function BarList({ items, color = "#2a78d6", empty = "Nothing yet." }: {
  items: BarListItem[]; color?: string; empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length || items.every((i) => !i.value)) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((it) => {
        const row = (
          <div className="group grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-muted-foreground group-hover:text-foreground">{it.label}</span>
            <span className="h-2 rounded-full bg-muted">
              <span className="block h-2 rounded-full transition-[width]" style={{ width: `${(it.value / max) * 100}%`, background: color, minWidth: it.value ? 4 : 0 }} />
            </span>
            <span className="min-w-14 text-right font-medium tabular-nums">{it.display}</span>
          </div>
        );
        return (
          <li key={it.key}>
            <Tooltip>
              <TooltipTrigger asChild>
                {it.href ? <Link href={it.href} className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">{row}</Link> : <div tabIndex={0} className="rounded-md outline-none">{row}</div>}
              </TooltipTrigger>
              {it.detail && <TooltipContent side="top">{it.detail}</TooltipContent>}
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
