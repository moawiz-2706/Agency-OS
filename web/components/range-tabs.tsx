import Link from "next/link";
import { cn } from "@/lib/utils";

/** 7 / 30 / 90-day switch, as links so the range lives in the URL. */
export function RangeTabs({ days, options }: { days: number; options: number[] }) {
  return (
    <div role="tablist" className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-sm">
      {options.map((d) => (
        <Link key={d} href={`/dashboard?days=${d}`} role="tab" aria-selected={d === days}
          className={cn("rounded-md px-3 py-1 font-medium transition-colors",
            d === days ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {d} days
        </Link>
      ))}
    </div>
  );
}
