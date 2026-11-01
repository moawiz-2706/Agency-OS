"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** The public enquiry form. Each submission becomes (or joins) a lead in the CRM. */
export function ContactForm({ button }: { button: string }) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    started.current = Date.now();
    // Tell the page around the iframe how tall the form is, so it never needs a scrollbar.
    const send = () => window.parent?.postMessage({ type: "sentinel-form-height", height: document.documentElement.scrollHeight }, "*");
    const ro = new ResizeObserver(send);
    if (box.current) ro.observe(box.current);
    send();
    return () => ro.disconnect();
  }, []);

  if (state === "done") {
    return (
      <div ref={box} className="flex flex-col items-center gap-2 py-10 text-center">
        <CheckCircle2 className="size-10 text-emerald-600" />
        <p className="text-lg font-semibold">Thanks, we&apos;ve got it.</p>
        <p className="text-sm text-muted-foreground">We&apos;ll get back to you within one business day.</p>
      </div>
    );
  }

  return (
    <div ref={box}>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setState("sending");
          const data = Object.fromEntries(new FormData(e.currentTarget).entries());
          try {
            const res = await fetch("/api/forms/contact", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...data, started: started.current, page: document.referrer || window.location.href }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok && body.ok) setState("done");
            else { setError(body.error ?? "Something went wrong. Please try again."); setState("idle"); }
          } catch {
            setError("Couldn't send. Check your connection and try again.");
            setState("idle");
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="name">Your name *</Label><Input id="name" name="name" required autoComplete="name" /></div>
          <div className="grid gap-1.5"><Label htmlFor="email">Email *</Label><Input id="email" name="email" type="email" required autoComplete="email" /></div>
          <div className="grid gap-1.5"><Label htmlFor="company">Company</Label><Input id="company" name="company" autoComplete="organization" /></div>
          <div className="grid gap-1.5"><Label htmlFor="website">Website</Label><Input id="website" name="website" placeholder="yourcompany.com" autoComplete="url" /></div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tools">Which tools do you use? (e.g. HubSpot, Xero, Jobber, Google Sheets)</Label>
          <Input id="tools" name="tools" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pain">What&apos;s your biggest time-waster?</Label>
          <Textarea id="pain" name="pain" rows={4} />
        </div>
        {/* Hidden from people; bots fill it in. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>Leave this empty<input name="company_url" tabIndex={-1} autoComplete="off" /></label>
        </div>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <Button type="submit" size="lg" disabled={state === "sending"} className="w-full sm:w-auto sm:justify-self-start">
          {state === "sending" && <Loader2 className="animate-spin" />}{button}
        </Button>
      </form>
    </div>
  );
}
