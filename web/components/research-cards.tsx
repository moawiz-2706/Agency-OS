import { ExternalLink, FileSearch, Lightbulb, Quote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OFFER_TITLE, SOURCE_LABEL, isOfferKey, type RecommendedOffer } from "@/lib/offers";
import { dateOnly } from "@/lib/format";

/** Ranked offers from the website audit, with the reasons behind each. */
export function WhatToSell({ offers, researched }: { offers: RecommendedOffer[]; researched: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Lightbulb className="size-4" />What to sell</CardTitle>
        <CardDescription>
          From the website check{researched && isOfferKey(researched) ? <> · research recommends <b className="text-foreground">{OFFER_TITLE[researched]}</b></> : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {offers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recommendation yet. Run the website audit (pnpm audit-leads) or research this lead.</p>
        ) : (
          <ol className="space-y-3">
            {offers.map((o, i) => (
              <li key={o.key} className="flex gap-3">
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {OFFER_TITLE[o.key]}
                    {researched === o.key && <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">Research agrees</Badge>}
                  </div>
                  <ul className="mt-0.5 text-sm text-muted-foreground">
                    {o.reasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

type Report = {
  source: string; summary: string; recommended_offer: string | null; hook: string | null;
  gaps: { gap: string; evidence_url: string; detail?: string }[]; discovery_questions: string[];
  confidence: number | null; raw: Record<string, string> | null; created_at: string; updated_at: string;
};

/** The latest research report: who/what researched it, gaps with evidence, the email hook and call questions. */
export function ResearchReportCard({ report: r, by }: { report: Report; by: string | null }) {
  const second = r.raw?.second_offer;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileSearch className="size-4" />Research</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>Researched by: <b className="text-foreground">{SOURCE_LABEL[r.source] ?? r.source}</b></span>
          {by && <span>· imported by {by}</span>}
          <span>· {dateOnly(r.updated_at ?? r.created_at)}</span>
          {r.confidence != null && <Badge variant="secondary" className="font-normal">Confidence {Math.round(r.confidence * 100)}%</Badge>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>{r.summary}</p>

        {(r.recommended_offer || second) && (
          <div className="flex flex-wrap gap-2">
            {r.recommended_offer && isOfferKey(r.recommended_offer) && <Badge>{OFFER_TITLE[r.recommended_offer]}</Badge>}
            {second && isOfferKey(second) && <Badge variant="outline">Also: {OFFER_TITLE[second]}</Badge>}
          </div>
        )}

        {r.gaps.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Gaps (with evidence)</div>
            <ul className="space-y-1.5">
              {r.gaps.map((g) => (
                <li key={g.gap + g.evidence_url} className="flex items-start justify-between gap-3">
                  <span>{g.gap}</span>
                  <a href={g.evidence_url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline">
                    Evidence<ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {r.hook && (
          <div className="flex gap-2 rounded-md border bg-muted/40 p-3">
            <Quote className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div><div className="text-xs font-medium text-muted-foreground">Email opener</div>{r.hook}</div>
          </div>
        )}

        {r.discovery_questions.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Questions for the first call</div>
            <ol className="list-decimal space-y-1 pl-5">{r.discovery_questions.map((q) => <li key={q}>{q}</li>)}</ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
