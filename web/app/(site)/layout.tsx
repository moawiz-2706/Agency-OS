import Link from "next/link";
import { AUDIT_MAILTO, Brand, BRAND, CONTACT_EMAIL } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/#services", label: "Services" },
  { href: "/#how", label: "How it works" },
  { href: "/#industries", label: "Industries" },
  { href: "/#faq", label: "FAQ" },
];

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Brand />
          <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            {NAV.map((n) => <Link key={n.href} href={n.href} className="transition-colors hover:text-foreground">{n.label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><Link href="/login">Team sign in</Link></Button>
            <Button asChild size="sm"><a href={AUDIT_MAILTO}>Free audit</a></Button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t bg-muted/30">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr]">
          <div className="space-y-3">
            <Brand />
            <p className="max-w-sm text-sm text-muted-foreground">
              GoHighLevel automation for home-service businesses in the United States and Canada.
            </p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">{CONTACT_EMAIL}</a>
          </div>
          <div className="space-y-2 text-sm">
            <div className="font-medium">Company</div>
            {NAV.map((n) => <Link key={n.href} href={n.href} className="block text-muted-foreground hover:text-foreground">{n.label}</Link>)}
          </div>
          <div className="space-y-2 text-sm">
            <div className="font-medium">Legal</div>
            <Link href="/privacy" className="block text-muted-foreground hover:text-foreground">Privacy policy</Link>
            <Link href="/terms" className="block text-muted-foreground hover:text-foreground">Terms of service</Link>
            <Link href="/login" className="block text-muted-foreground hover:text-foreground">Team sign in</Link>
          </div>
        </div>
        <div className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted-foreground sm:px-6">© {new Date().getFullYear()} {BRAND}. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
