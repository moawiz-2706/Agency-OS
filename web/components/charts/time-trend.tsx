"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { minutes } from "@/lib/format";

export type TrendSeries = { key: string; name: string; color: string };
export type TrendPoint = { label: string } & Record<string, number | string>;

type TipProps = { active?: boolean; payload?: readonly { dataKey?: unknown; value?: unknown }[]; label?: unknown; series: TrendSeries[] };

function TrendTooltip({ active, payload, label, series }: TipProps) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((n, p) => n + (Number(p.value) || 0), 0);
  return (
    <div className="min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{String(label ?? "")}</div>
      {series.map((s) => {
        const v = Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0);
        return (
          <div key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-sm" style={{ background: s.color }} />{s.name}
            </span>
            <span className="font-medium tabular-nums text-foreground">{minutes(v)}</span>
          </div>
        );
      })}
      {series.length > 1 && (
        <div className="mt-1 flex justify-between border-t pt-1"><span className="text-muted-foreground">Total</span><span className="font-medium tabular-nums">{minutes(total)}</span></div>
      )}
    </div>
  );
}

/** Minutes logged per day, stacked by team member. Colours are each member's fixed slot. */
export function TimeTrendChart({ data, series }: { data: TrendPoint[]; series: TrendSeries[] }) {
  const empty = data.every((d) => series.every((s) => !Number(d[s.key])));
  return (
    <div className="space-y-3">
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.name}
            </li>
          ))}
        </ul>
      )}
      <div className="relative h-56">
        {empty && (
          <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
            No time logged in this period yet.
          </p>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              interval="preserveStartEnd" minTickGap={24} />
            <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`)} />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(p) => <TrendTooltip active={p.active} payload={p.payload} label={p.label} series={series} />} />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} stackId="t" fill={s.color}
                stroke="var(--card)" strokeWidth={series.length > 1 ? 2 : 0}
                radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
