"use client";

import Link from "next/link";
import { useState } from "react";
import { bulkUpdate } from "@/app/(app)/leads/actions";
import { STAGE_COLOR, STAGE_LABEL, STAGES, memberName, type Member, type Stage } from "@/lib/crm";
import { ago, minutes } from "@/lib/format";

export type LeadRow = {
  id: string; name: string; trade: string | null; city: string | null; region: string | null; stage: Stage;
  owner_id: string | null; score: number | null; tier: string | null; email: string | null; phone: string | null;
  website_domain: string | null; last_touch_at: string | null; next_step: string | null; next_step_at: string | null;
  minutes_spent: number;
};

export function LeadsTable({ rows, team }: { rows: LeadRow[]; team: Member[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const byId = new Map(team.map((m) => [m.id, m]));
  const all = rows.length > 0 && picked.size === rows.length;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <form action={async (f) => { await bulkUpdate(f); setPicked(new Set()); }} className="card overflow-x-auto p-0">
      {[...picked].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 text-sm">
        <span className="text-slate-500">{picked.size} selected</span>
        <select name="bulk_action" className="input py-1" defaultValue="" disabled={!picked.size}>
          <option value="" disabled>Bulk action…</option>
          <optgroup label="Assign owner">
            {team.map((m) => <option key={m.id} value={`owner:${m.id}`}>{memberName(m)}</option>)}
            <option value="owner:none">Unassigned</option>
          </optgroup>
          <optgroup label="Change stage">
            {STAGES.map((s) => <option key={s} value={`stage:${s}`}>{STAGE_LABEL[s]}</option>)}
          </optgroup>
        </select>
        <button className="btn py-1" disabled={!picked.size}>Apply</button>
      </div>
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="w-8 p-2">
              <input type="checkbox" checked={all} aria-label="Select all on this page"
                onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.id)))} />
            </th>
            <th className="p-2">Lead</th><th>Stage</th><th>Owner</th><th>Score</th>
            <th>Contact</th><th>Last touch</th><th>Next step</th><th className="pr-3 text-right">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const owner = r.owner_id ? byId.get(r.owner_id) : null;
            const overdue = r.next_step_at && new Date(r.next_step_at) < new Date();
            return (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-2"><input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /></td>
                <td className="p-2">
                  <Link href={`/leads/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                  <div className="text-xs text-slate-500">{[r.trade, r.city, r.region].filter(Boolean).join(" · ")}</div>
                </td>
                <td><span className={`chip ${STAGE_COLOR[r.stage]}`}>{STAGE_LABEL[r.stage]}</span></td>
                <td>
                  {owner ? <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: owner.color }} />{memberName(owner)}</span>
                    : <span className="text-slate-400">—</span>}
                </td>
                <td>{r.score ?? "—"}{r.tier && <span className="ml-1 text-xs text-slate-400">{r.tier}</span>}</td>
                <td className="text-xs">
                  <div className="max-w-[14rem] truncate">{r.email ?? <span className="text-slate-400">no email</span>}</div>
                  <div className="text-slate-500">{r.phone ?? ""}</div>
                </td>
                <td className="text-xs text-slate-500">{ago(r.last_touch_at)}</td>
                <td className="text-xs">
                  <div className="max-w-[12rem] truncate">{r.next_step ?? ""}</div>
                  {r.next_step_at && <div className={overdue ? "text-rose-600" : "text-slate-500"}>{ago(r.next_step_at)}</div>}
                </td>
                <td className="pr-3 text-right">{minutes(r.minutes_spent)}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-slate-500">No leads match these filters.</td></tr>}
        </tbody>
      </table>
    </form>
  );
}
