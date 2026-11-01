import type { Metadata } from "next";
import { CheckCircle2, MailX } from "lucide-react";
import { BRAND, CONTACT_EMAIL } from "@/components/brand";
import { SubmitButton } from "@/components/submit-button";
import { verifyUnsubscribe } from "@/lib/mail/unsubscribe";
import { confirmUnsubscribe } from "./actions";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Where an outreach email's unsubscribe link lands: one button, then never another email. */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ e?: string; t?: string; done?: string; failed?: string }> }) {
  const sp = await searchParams;
  const email = verifyUnsubscribe(sp.e ?? null, sp.t ?? null);

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
      {!email ? (
        <>
          <MailX className="mx-auto size-10 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-semibold">This link isn&apos;t valid</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Reply to the email with &quot;unsubscribe&quot;, or write to <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, and we&apos;ll stop.
          </p>
        </>
      ) : sp.done ? (
        <>
          <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
          <h1 className="mt-4 text-xl font-semibold">You&apos;re unsubscribed</h1>
          <p className="mt-2 text-sm text-muted-foreground">{BRAND} won&apos;t email {email} again.</p>
        </>
      ) : (
        <>
          <MailX className="mx-auto size-10 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-semibold">Unsubscribe {email}?</h1>
          <p className="mt-2 text-sm text-muted-foreground">You won&apos;t get any more emails from {BRAND}.</p>
          {sp.failed && <p className="mt-3 text-sm text-red-600">That didn&apos;t work. Try again, or reply to the email with &quot;unsubscribe&quot;.</p>}
          <form action={confirmUnsubscribe.bind(null, sp.e!, sp.t!)} className="mt-6">
            <SubmitButton>Unsubscribe</SubmitButton>
          </form>
        </>
      )}
    </div>
  );
}
