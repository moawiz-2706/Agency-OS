import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { BRAND } from "@/components/brand";
import { OFFER_TITLE } from "@/lib/offers";
import { toCsv } from "@/lib/csv";
import { EXPORT_COLUMNS, buildPrompt } from "@/lib/ai-emails";
import { exportRow, researchedLeads } from "@/lib/ai-emails-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Downloads for the AI email workflow (team members only, through RLS):
 * ?file=leads  -> researched-leads.csv   ?file=prompt -> ai-email-prompt.md
 * Options: emails (2-6), days ("1,4,8,14"), emailed=1 to include leads that were already emailed.
 */
export async function GET(req: NextRequest) {
  const { member } = await currentMember();
  if (!member) return new NextResponse("Not signed in", { status: 401 });
  const p = req.nextUrl.searchParams;
  const emails = Math.max(1, Math.min(6, Number(p.get("emails")) || 4));
  const days = (p.get("days") ?? "1,4,8,14").split(",").map((d) => Number(d.trim())).filter((d) => Number.isInteger(d) && d >= 1 && d <= 90);
  const stamp = new Date().toISOString().slice(0, 10);

  if (p.get("file") === "prompt") {
    const text = buildPrompt({
      emails, days: days.length >= emails ? days : [1, 4, 8, 14, 21, 28], senderName: member.full_name?.split(/\s+/)[0] || "us",
      agency: BRAND, offers: OFFER_TITLE,
    });
    return new NextResponse(text, { headers: {
      "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="ai-email-prompt-${stamp}.md"`, "Cache-Control": "no-store",
    } });
  }

  const leads = (await researchedLeads(await supabaseServer())).filter((l) => !l.waiting && (p.get("emailed") === "1" || !l.emailed));
  return new NextResponse(toCsv([...EXPORT_COLUMNS], leads.map(exportRow)), { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="researched-leads-${stamp}.csv"`, "Cache-Control": "no-store",
  } });
}
