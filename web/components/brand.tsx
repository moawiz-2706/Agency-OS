import Link from "next/link";
import { cn } from "@/lib/utils";

export const BRAND = "The Sentinel Systems";
export const BRAND_SHORT = "Sentinel";
export const CONTACT_EMAIL = "moawiz@thesentinelsystems.com";

/** The shield mark: a sentinel's shield with a check, in the brand colour. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7 shrink-0", className)}>
      <rect width="32" height="32" rx="7" className="fill-primary" />
      <path d="M16 6.5 8.5 9.3v6.1c0 4.8 3.2 8.6 7.5 10.1 4.3-1.5 7.5-5.3 7.5-10.1V9.3L16 6.5Z" className="fill-primary-foreground/15 stroke-primary-foreground" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m12.6 15.9 2.4 2.4 4.6-4.9" fill="none" className="stroke-primary-foreground" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Brand({ href = "/", className, compact = false }: { href?: string; className?: string; compact?: boolean }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 font-semibold tracking-tight", className)} aria-label={BRAND}>
      <BrandMark />
      <span className={cn("leading-none", compact && "text-sm")}>
        {compact ? BRAND_SHORT : <><span className="text-muted-foreground font-normal">The </span>Sentinel Systems</>}
      </span>
    </Link>
  );
}
