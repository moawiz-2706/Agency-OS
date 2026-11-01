import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { TEAM_TZ } from "@/lib/format";
import { researchedLeads } from "@/lib/ai-emails-data";
import { AiEmailsWorkflow } from "@/components/ai-emails";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "AI email drafts" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;   // importing a few hundred drafts

export default async function AiEmailsPage() {
  const supabase = await supabaseServer();
  const [leads, { data: inboxes }] = await Promise.all([researchedLeads(supabase), supabase.rpc("my_mail_accounts")]);
  const open = leads.filter((l) => !l.waiting);
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TZ }).format(new Date(new Date().getTime() + 86400_000));
  return (
    <>
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Leads</Link>
      <PageHeader title="AI email drafts"
        description="Give your researched leads to Claude, ChatGPT or Manus with a ready-made prompt, then upload the emails it writes. They arrive as drafts for you to approve." />
      <AiEmailsWorkflow fresh={open.filter((l) => !l.emailed).length} emailed={open.filter((l) => l.emailed).length}
        inboxes={((inboxes ?? []) as { id: string; email: string }[]).map(({ id, email }) => ({ id, email }))} startDefault={tomorrow} />
    </>
  );
}
