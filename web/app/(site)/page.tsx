import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, BellRing, CalendarCheck, CheckCircle2, Globe, Link2, MessageSquareText, PhoneMissed, Settings2, ShieldCheck,
  Star, Timer, Wrench, Zap,
} from "lucide-react";
import { AUDIT_MAILTO, BRAND } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: { absolute: `${BRAND}: GoHighLevel automation for home-service businesses` },
  alternates: { canonical: "/" },
};

const SERVICES = [
  { icon: PhoneMissed, title: "Missed-call text-back", text: "Every missed call gets a text within seconds, so the homeowner waits for you instead of calling the next company." },
  { icon: CalendarCheck, title: "Online booking + reminders", text: "Customers pick an estimate or service slot on your site. Confirmations and reminders go out automatically." },
  { icon: Zap, title: "Speed-to-lead", text: "Form, ad and Google leads get an instant reply and your team gets an alert, while the lead is still deciding." },
  { icon: Star, title: "Review automation", text: "A review request goes out after every finished job, so your Google rating keeps growing without anyone remembering to ask." },
  { icon: Globe, title: "Website + Google Business Profile", text: "Fix what costs you calls: wrong numbers, broken forms, missing hours and an incomplete Google profile." },
  { icon: Settings2, title: "GoHighLevel optimisation", text: "Already on GoHighLevel? We audit and fix your workflows, pipelines, calendars and follow-ups." },
  { icon: Link2, title: "Field-service integration", text: "Connect GoHighLevel to Housecall Pro, Jobber or ServiceTitan, so leads and jobs stay in sync." },
];

const STEPS = [
  { title: "Free audit", text: "We review your website, Google profile and how fast leads hear back, and show you exactly where calls and jobs slip away." },
  { title: "Setup", text: "We build the fixes in GoHighLevel (text-back, booking, follow-ups, reviews) and test every path with you before it goes live." },
  { title: "Ongoing care", text: "We watch the numbers, keep automations working, and tune them as your season and services change." },
];

const INDUSTRIES = ["HVAC", "Plumbing", "Roofing", "Electrical", "Landscaping", "Garage doors", "Gutters", "Water & fire restoration", "Pest control", "Remodeling"];

const WHY = [
  { icon: Wrench, title: "Built for the trades", text: "We only work with home-service businesses, so the automations match how you actually book and run jobs." },
  { icon: ShieldCheck, title: "Consent and opt-outs built in", text: "Texting and email are set up with consent and opt-out handling for the US and Canada." },
  { icon: CheckCircle2, title: "You own everything", text: "Your contacts, conversations and automations live in your account. No lock-in." },
  { icon: Timer, title: "Fast to launch", text: "Most fixes are live within days, starting with the ones that win back the most missed calls." },
];

const FAQ = [
  { q: "Do I need to be on GoHighLevel already?", a: "No. If you're not, we set it up for you. If you are, we start with an audit of your existing account and fix what's leaking leads." },
  { q: "Will this replace my field-service software?", a: "No. GoHighLevel handles the lead side (calls, texts, booking, follow-up, reviews). We connect it to the software you already use for jobs and invoices." },
  { q: "How long does setup take?", a: "Most businesses have missed-call text-back and instant lead replies live in the first week. Booking, reviews and integrations follow." },
  { q: "Do you work in Canada?", a: "Yes. We work with home-service businesses across the United States and Canada, and set up messaging with CASL and CAN-SPAM rules in mind." },
  { q: "What does the free audit include?", a: "A short review of your website, Google Business Profile and how quickly a new lead hears back, with the top fixes in order of impact. No obligation." },
];

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/25 via-primary/5 to-transparent blur-2xl" />
      <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-xl">
        <div className="flex items-center gap-3 rounded-xl border bg-background p-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-red-50 text-red-600"><PhoneMissed className="size-4" /></span>
          <div className="text-sm"><div className="font-medium">Missed call</div><div className="text-xs text-muted-foreground">(512) 555-0142 · 7:58 AM</div></div>
        </div>
        <div className="ml-6 flex items-start gap-3 rounded-xl border bg-background p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><MessageSquareText className="size-4" /></span>
          <div className="text-sm"><div className="font-medium">Auto-text sent in 8 seconds</div><div className="text-xs text-muted-foreground">&ldquo;Sorry we missed you! What can we help with today?&rdquo;</div></div>
        </div>
        <div className="ml-12 flex items-center gap-3 rounded-xl border bg-background p-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><CalendarCheck className="size-4" /></span>
          <div className="text-sm"><div className="font-medium">Estimate booked</div><div className="text-xs text-muted-foreground">Thu 10:00 AM · reminder scheduled</div></div>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground"><BellRing className="size-3.5" />Your team gets an alert for every new lead</div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden border-b">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_60%)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" />GoHighLevel automation for home-service businesses
            </span>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Never lose a job because a call went unanswered.
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground text-pretty">
              {BRAND} sets up missed-call text-back, online booking, instant lead follow-up and review requests for HVAC, plumbing,
              roofing and other home-service companies in the US and Canada.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg"><a href={AUDIT_MAILTO}>Get a free audit <ArrowRight /></a></Button>
              <Button asChild size="lg" variant="outline"><Link href="#services">See what we set up</Link></Button>
            </div>
            <p className="text-sm text-muted-foreground">Free, no obligation. We show you where leads slip away, in order of impact.</p>
          </div>
          <HeroVisual />
        </div>
      </section>

      <section id="services" className="scroll-mt-20 border-b">
        <div className="mx-auto max-w-6xl space-y-10 px-4 py-16 sm:px-6 md:py-20">
          <div className="max-w-2xl space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight">What we set up</h2>
            <p className="text-muted-foreground">Each one closes a gap where calls, leads or reviews get lost. We start with the one that matters most for your business.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-xl border bg-card p-5 transition-shadow hover:shadow-md">
                <span className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="scroll-mt-20 border-b bg-muted/30">
        <div className="mx-auto max-w-6xl space-y-10 px-4 py-16 sm:px-6 md:py-20">
          <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-xl border bg-card p-6">
                <span className="text-sm font-semibold text-primary">Step {i + 1}</span>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="industries" className="scroll-mt-20 border-b">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:py-20 lg:grid-cols-2">
          <div className="space-y-4">
            <h2 className="text-3xl font-semibold tracking-tight">Made for home-service teams</h2>
            <p className="text-muted-foreground">Owner-operators and growing crews whose phones ring while they&apos;re on the job.</p>
            <div className="flex flex-wrap gap-2">
              {INDUSTRIES.map((t) => <span key={t} className="rounded-full border bg-background px-3 py-1 text-sm">{t}</span>)}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {WHY.map(({ icon: Icon, title, text }) => (
              <div key={title} className="space-y-1.5">
                <Icon className="size-5 text-primary" />
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="scroll-mt-20 border-b bg-muted/30">
        <div className="mx-auto max-w-3xl space-y-8 px-4 py-16 sm:px-6 md:py-20">
          <h2 className="text-3xl font-semibold tracking-tight">Questions</h2>
          <div className="divide-y rounded-xl border bg-card">
            {FAQ.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {f.q}<span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-primary px-6 py-10 text-primary-foreground sm:px-10 md:flex-row md:items-center">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">Find out where your leads are slipping away</h2>
              <p className="text-primary-foreground/80">Email us and we&apos;ll send a free audit of your website, Google profile and lead follow-up.</p>
            </div>
            <Button asChild size="lg" variant="secondary"><a href={AUDIT_MAILTO}>Request your free audit <ArrowRight /></a></Button>
          </div>
        </div>
      </section>
    </>
  );
}
