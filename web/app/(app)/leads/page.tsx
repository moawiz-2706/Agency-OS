import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { teamMembers } from "@/lib/team";
import { STAGE_LABEL, STAGES, memberName } from "@/lib/crm";
import { OFFER_KEYS, OFFER_TITLE, isOfferKey } from "@/lib/offers";
import { LeadsTable, type LeadRow } from "@/components/leads-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const metadata: Metadata = { title: "Leads" };

const PAGE = 50;
const SORTS: Record<string, { col: string; label: string; asc: boolean }> = {
  score: { col: "score", label: "Score", asc: false },
  name: { col: "name", label: "Name", asc: true },
  last_touch: { col: "last_touch_at", label: "Last touch", asc: false },
  next_step: { col: "next_step_at", label: "Next step", asc: true },
  time: { col: "minutes_spent", label: "Time spent", asc: false },
};
const ALL = "all";

type Params = {
  q?: string; stage?: string; owner?: string; region?: string; trade?: string; offer?: string;
  has?: string | string[]; overdue?: string; never?: string; sort?: string; dir?: string; page?: string;
};

/** Keep only characters that are safe inside a PostgREST or() filter. */
const safe = (s: string) => s.replace(/[,()"\\%*]/g, " ").trim();
const val = (v?: string) => (v && v !== ALL ? v : undefined);

function FilterSelect({ name, value, placeholder, children }: { name: string; value?: string; placeholder: string; children: React.ReactNode }) {
  return (
    <Select name={name} defaultValue={value ?? ALL}>
      <SelectTrigger className="w-full bg-background" aria-label={placeholder}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const supabase = await supabaseServer();
  const [team, facetsRes] = await Promise.all([teamMembers(), supabase.from("v_lead_facets").select("region,trade,leads")]);
  const facets = (facetsRes.data ?? []) as { region: string | null; trade: string | null; leads: number }[];
  const regions = [...new Set(facets.map((f) => f.region).filter(Boolean))].sort() as string[];
  const trades = [...new Set(facets.map((f) => f.trade).filter(Boolean))].sort() as string[];

  const stage = val(p.stage), owner = val(p.owner), region = val(p.region), trade = val(p.trade);
  const offer = isOfferKey(p.offer) ? p.offer : undefined;
  const has = ([] as string[]).concat(p.has ?? []);
  const sortKey = SORTS[p.sort ?? ""] ? p.sort! : "score";
  const sort = SORTS[sortKey];
  const asc = p.dir ? p.dir === "asc" : sort.asc;
  const page = Math.max(1, Number(p.page) || 1);

  let q = supabase.from("companies")
    .select("id,name,trade,city,region,stage,owner_id,score,tier,email,phone,website_domain,last_touch_at,next_step,next_step_at,minutes_spent,recommended_offers", { count: "exact" });
  const term = safe(p.q ?? "");
  if (term) {
    const digits = term.replace(/\D/g, "");
    q = q.or([
      `name.ilike.%${term}%`, `website_domain.ilike.%${term}%`, `email.ilike.%${term}%`, `city.ilike.%${term}%`,
      `phone.ilike.%${term}%`, ...(digits.length >= 3 ? [`phone_digits.ilike.%${digits}%`] : []),
    ].join(","));
  }
  if (stage && (STAGES as readonly string[]).includes(stage)) q = q.eq("stage", stage);
  if (owner === "none") q = q.is("owner_id", null);
  else if (owner) q = q.eq("owner_id", owner);
  if (region) q = q.eq("region", region);
  if (trade) q = q.eq("trade", trade);
  if (has.includes("email")) q = q.not("email", "is", null);
  if (has.includes("website")) q = q.not("website", "is", null);
  if (has.includes("phone")) q = q.not("phone", "is", null);
  if (p.overdue) q = q.lt("next_step_at", new Date().toISOString());
  if (p.never) q = q.is("last_touch_at", null);
  // Any of the lead's recommended offers (jsonb containment, GIN-indexed).
  if (offer) q = q.filter("recommended_offers", "cs", JSON.stringify([{ key: offer }]));
  q = q.order(sort.col, { ascending: asc, nullsFirst: false }).order("name").range((page - 1) * PAGE, page * PAGE - 1);

  const { data, count, error } = await q;
  const rows = (data ?? []) as LeadRow[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const filtered = !!(term || stage || owner || region || trade || offer || has.length || p.overdue || p.never);

  const link = (over: Partial<Params>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...p, ...over })) for (const x of ([] as string[]).concat(v ?? [])) if (x) sp.append(k, x);
    return `/leads?${sp}`;
  };

  return (
    <>
      <PageHeader title="Leads" description={`${total.toLocaleString()} ${filtered ? "matching" : "in total"}`} />

      <Card className="py-4">
        <CardContent className="px-4">
          <form action="/leads" className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            <div className="relative col-span-2">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={p.q} placeholder="Name, domain, phone, email, city" className="bg-background pl-8" />
            </div>
            <FilterSelect name="stage" value={stage} placeholder="Stage">
              <SelectItem value={ALL}>All stages</SelectItem>
              {STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>)}
            </FilterSelect>
            <FilterSelect name="owner" value={owner} placeholder="Owner">
              <SelectItem value={ALL}>All owners</SelectItem>
              <SelectItem value="none">Unassigned</SelectItem>
              {team.map((m) => <SelectItem key={m.id} value={m.id}>{memberName(m)}</SelectItem>)}
            </FilterSelect>
            <FilterSelect name="region" value={region} placeholder="Region">
              <SelectItem value={ALL}>All regions</SelectItem>
              {regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </FilterSelect>
            <FilterSelect name="trade" value={trade} placeholder="Trade">
              <SelectItem value={ALL}>All trades</SelectItem>
              {trades.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </FilterSelect>
            <FilterSelect name="sort" value={sortKey} placeholder="Sort">
              {Object.entries(SORTS).map(([k, s]) => <SelectItem key={k} value={k}>Sort: {s.label}</SelectItem>)}
            </FilterSelect>
            <FilterSelect name="dir" value={p.dir ?? (sort.asc ? "asc" : "desc")} placeholder="Order">
              <SelectItem value="desc">Descending</SelectItem>
              <SelectItem value="asc">Ascending</SelectItem>
            </FilterSelect>

            <FilterSelect name="offer" value={offer} placeholder="Offer">
              <SelectItem value={ALL}>Any offer</SelectItem>
              {OFFER_KEYS.map((k) => <SelectItem key={k} value={k}>{OFFER_TITLE[k]}</SelectItem>)}
            </FilterSelect>
            <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm md:col-span-3 xl:col-span-5">
              {(["email", "website", "phone"] as const).map((h) => (
                <label key={h} className="flex items-center gap-2"><Checkbox name="has" value={h} defaultChecked={has.includes(h)} />Has {h}</label>
              ))}
              <label className="flex items-center gap-2"><Checkbox name="overdue" value="1" defaultChecked={!!p.overdue} />Overdue</label>
              <label className="flex items-center gap-2"><Checkbox name="never" value="1" defaultChecked={!!p.never} />Never touched</label>
            </div>
            <div className="col-span-2 flex gap-2 md:col-span-1 xl:col-span-2">
              <Button type="submit" className="flex-1">Apply filters</Button>
              {filtered && <Button variant="ghost" asChild><Link href="/leads"><X />Clear</Link></Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      <LeadsTable rows={rows} team={team} />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total ? `${((page - 1) * PAGE + 1).toLocaleString()}–${Math.min(page * PAGE, total).toLocaleString()} of ${total.toLocaleString()}` : "No results"}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild={page > 1} disabled={page <= 1}>
            {page > 1 ? <Link href={link({ page: String(page - 1) })}><ChevronLeft />Previous</Link> : <span><ChevronLeft />Previous</span>}
          </Button>
          <Button variant="outline" size="sm" asChild={page < pages} disabled={page >= pages}>
            {page < pages ? <Link href={link({ page: String(page + 1) })}>Next<ChevronRight /></Link> : <span>Next<ChevronRight /></span>}
          </Button>
        </div>
      </div>
    </>
  );
}
