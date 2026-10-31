"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { KanbanSquare, LayoutDashboard, LogOut, Menu, UserCog, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
];

type Me = { name: string; email: string; initials: string; color: string; role: string };

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-2 font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">A</span>
      AgencyOS
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
              active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}>
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserCard({ me }: { me: Me }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-background p-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white" style={{ background: me.color }}>
        {me.initials}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-medium">{me.name}</div>
        <div className="truncate text-xs text-muted-foreground capitalize">{me.role}</div>
      </div>
      <Button variant="ghost" size="icon" asChild aria-label="Account" title="Account">
        <Link href="/account"><UserCog /></Link>
      </Button>
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
          <LogOut />
        </Button>
      </form>
    </div>
  );
}

export function AppShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-muted/40">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-6 border-r bg-background p-3 lg:flex">
        <div className="pt-2"><Brand /></div>
        <NavList />
        <div className="mt-auto"><UserCard me={me} /></div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu"><Menu /></Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-64 flex-col gap-6 p-3">
            <SheetHeader className="p-0 pt-2"><SheetTitle asChild><div><Brand /></div></SheetTitle></SheetHeader>
            <NavList onNavigate={() => setOpen(false)} />
            <div className="mt-auto"><UserCard me={me} /></div>
          </SheetContent>
        </Sheet>
        <Brand />
      </header>

      <main className="lg:pl-60">
        <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
