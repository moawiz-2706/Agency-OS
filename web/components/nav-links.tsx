"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/pipeline", label: "Pipeline" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href}
            className={`rounded-md px-2 py-1 ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
