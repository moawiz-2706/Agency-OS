import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { memberName } from "@/lib/crm";
import { DEFAULT_DESIGN, normalizeDesign } from "@/lib/mail/design";
import { EMAIL_RULES, LIBRARY } from "@/lib/email-library";
import { PageHeader } from "@/components/page-header";
import { EmailTemplates } from "@/components/email-templates";

export const metadata: Metadata = { title: "Templates" };
export const dynamic = "force-dynamic";

type Inbox = { email: string; signature: string | null; is_default: boolean; from_name: string | null };

export default async function TemplatesPage() {
  const supabase = await supabaseServer();
  const [{ member }, designRes, inboxRes] = await Promise.all([
    currentMember(),
    supabase.rpc("email_design"),   // missing until migration 0014 runs
    supabase.rpc("my_mail_accounts"),
  ]);
  const inboxes = (inboxRes.data as Inbox[] | null) ?? [];
  const inbox = inboxes.find((i) => i.is_default) ?? inboxes[0];
  const fallbackSig = `${memberName(member)}\nThe Sentinel Systems | https://thesentinelsystems.com\nYour postal address`;

  return (
    <>
      <PageHeader title="Templates"
        description="How your emails look, and ready-made sequences that get replies. The design applies to every outreach email when it's sent, including ones already scheduled." />
      {designRes.error && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Saving a design needs migration 0014: run it in Supabase (SQL Editor), then reload. Until then emails go out as plain text. You can still preview below.
        </p>
      )}
      <EmailTemplates
        initial={designRes.error ? DEFAULT_DESIGN : normalizeDesign(designRes.data)}
        canEdit={member?.role === "owner" && !designRes.error}
        signature={inbox?.signature?.trim() || fallbackSig}
        fromName={inbox?.from_name || memberName(member)}
        fromEmail={inbox?.email ?? "you@thesentinelsystems.com"}
        library={LIBRARY}
        rules={EMAIL_RULES}
      />
    </>
  );
}
