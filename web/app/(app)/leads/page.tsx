import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { teamMembers } from "@/lib/team";
import { STAGE_LABEL, STAGES, memberName } from "@/lib/crm";
import { LeadsTable, type LeadRow } from "@/components/leads-table";

const PAGE = 50;
const SORTS: Record<string, string> = {
  score: "score", name: "name", last_touch: "last_touch_at", next_step: "next_step_at", time: "minutes_spent",
};

type Params = {
  q?: string; stage?: string; owner?: string; region?: string; trade?: string;
  has?: string | string[]; overdue?: string; never?: string; sort?: string; dir?: string; page?: string;
};

/** Keep only characters that are safe inside a PostgREST or() filter. */
const safe = (s: string) => s.replace(/[,()"\\%*]/g, " ").trim();

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const supabase = await supabaseServer();
  const [team, facetsRes] = await Promise.all([teamMembers(), supabase.from("v_lead_facets").select("region,trade,leads")]);
  const facets = (facetsRes.data ?? []) as { region: string | null; trade: string | null; leads: number }[];
  const regions = [...new Set(facets.map((f) => f.region).filter(Boolean))].sort() as string[];
  const trades = [...new Set(facets.map((f) => f.trade).filter(Boolean))].sort() as string[];

  const has = ([] as string[]).concat(p.has ?? []);
  const sort = SORTS[p.sort ?? ""] ? p.sort! : "score";
  const asc = p.dir ? p.dir === "asc" : sort === "name" || sort === "next_step";
  const page = Math.max(1, Number(p.page) || 1);

  let q = supabase.from("companies")
    .select("id,name,trade,city,region,stage,owner_id,score,tier,email,phone,website_domain,last_touch_at,next_step,next_step_at,minutes_spent", { count: "exact" });
  const term = safe(p.q ?? "");
  if (term) {
    const digits = term.replace(/\D/g, "");
    q = q.or([
      `name.ilike.%${term}%`, `website_domain.ilike.%${term}%`, `email.ilike.%${term}%`, `city.ilike.%${term}%`,
      `phone.ilike.%${term}%`, ...(digits.length >= 3 ? [`phone_digits.ilike.%${digits}%`] : []),
    ].join(","));
  }
  if (p.stage && (STAGES as readonly string[]).includes(p.stage)) q = q.eq("stage", p.stage);
  if (p.owner === "none") q = q.is("owner_id", null);
  else if (p.owner) q = q.eq("owner_id", p.owner);
  if (p.region) q = q.eq("region", p.region);
  if (p.trade) q = q.eq("trade", p.trade);
  if (has.includes("email")) q = q.not("email", "is", null);
  if (has.includes("website")) q = q.not("website", "is", null);
  if (has.includes("phone")) q = q.not("phone", "is", null);
  if (p.overdue) q = q.lt("next_step_at", new Date().toISOString());
  if (p.never) q = q.is("last_touch_at", null);
  q = q.order(SORTS[sort], { ascending: asc, nullsFirst: false }).order("name").range((page - 1) * PAGE, page * PAGE - 1);

  const { data, count, error } = await q;
  const rows = (data ?? []) as LeadRow[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const link = (over: Partial<Params>) => {
    const sp = new URLSearchParams();
    const merged = { ...p, ...over };
    for (const [k, v] of Object.entries(merged)) {
      for (const x of ([] as string[]).concat(v ?? [])) if (x) sp.append(k, x);
    }
    return `/leads?${sp}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Leads</h1>
        <span className="text-sm text-slate-500">{total.toLocaleString()} found</span>
      </div>

      <form className="card grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8" action="/leads">
        <input name="q" defaultValue={p.q} placeholder="Search name, domain, phone, email, city" className="input col-span-2 lg:col-span-2" />
        <select name="stage" defaultValue={p.stage ?? ""} className="input">
          <option value="">Any stage</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
        <select name="owner" defaultValue={p.owner ?? ""} className="input">
          <option value="">Any owner</option>
          <option value="none">Unassigned</option>
          {team.map((m) => <option key={m.id} value={m.id}>{memberName(m)}</option>)}
        </select>
        <select name="region" defaultValue={p.region ?? ""} className="input">
          <option value="">Any region</option>
          {regions.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select name="trade" defaultValue={p.trade ?? ""} className="input">
          <option value="">Any trade</option>
          {trades.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select name="sort" defaultValue={sort} className="input">
          <option value="score">Sort: score</option>
          <option value="name">Sort: name</option>
          <option value="last_touch">Sort: last touch</option>
          <option value="next_step">Sort: next step</option>
          <option value="time">Sort: time spent</option>
        </select>
        <select name="dir" defaultValue={p.dir ?? ""} className="input">
          <option value="">Default order</option>
          <option value="desc">High → low / newest</option>
          <option value="asc">Low → high / oldest</option>
        </select>
        <div className="col-span-2 flex flex-wrap items-center gap-3 text-sm sm:col-span-4 lg:col-span-6">
          {(["email", "website", "phone"] as const).map((h) => (
            <label key={h} className="flex items-center gap-1">
              <input type="checkbox" name="has" value={h} defaultChecked={has.includes(h)} /> Has {h}
            </label>
          ))}
          <label className="flex items-center gap-1"><input type="checkbox" name="overdue" value="1" defaultChecked={!!p.overdue} /> Overdue</label>
          <label className="flex items-center gap-1"><input type="checkbox" name="never" value="1" defaultChecked={!!p.never} /> Never touched</label>
        </div>
        <div className="col-span-2 flex gap-2">
          <button className="btn-primary flex-1">Apply</button>
          <Link href="/leads" className="btn">Reset</Link>
        </div>
      </form>

      {error && <p className="text-sm text-rose-600">{error.message}</p>}
      <LeadsTable rows={rows} team={team} />

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">Page {page} of {pages}</span>
        <div className="flex gap-2">
          {page > 1 && <Link className="btn" href={link({ page: String(page - 1) })}>← Previous</Link>}
          {page < pages && <Link className="btn" href={link({ page: String(page + 1) })}>Next →</Link>}
        </div>
      </div>
    </div>
  );
}

