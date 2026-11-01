"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Eye, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { saveSequence } from "@/app/(app)/sequences/actions";
import { MERGE_FIELDS, previewMerge, stepProblems, type Step } from "@/lib/sequences";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type EditStep = Step & { template_id: string | null; key: number };
type Sample = Parameters<typeof previewMerge>[1] & { label: string };

/** A sequence's name, timing and steps. Saving affects leads added afterwards. */
export function SequenceEditor({ id, name, description, sendTime, skipWeekends, steps: initial, sample }: {
  id: string; name: string; description: string | null; sendTime: string; skipWeekends: boolean;
  steps: (Step & { template_id: string | null })[];
  sample: Sample | null;
}) {
  const [steps, setSteps] = useState<EditStep[]>(initial.map((s, i) => ({ ...s, key: i })));
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();
  const focused = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const nextKey = useRef(initial.length);
  const problems = stepProblems(steps);

  const update = (i: number, patch: Partial<Step>) => setSteps((cur) => cur.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => setSteps((cur) => {
    const next = [...cur];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });
  /** Put a merge field where the cursor is in the last subject/message box used. */
  const insert = (tag: string) => {
    const el = focused.current;
    if (!el) { toast.message("Click into a subject or message first"); return; }
    const i = Number(el.dataset.step);
    const field = el.dataset.field as "subject" | "body";
    const at = el.selectionStart ?? el.value.length;
    const value = el.value.slice(0, at) + tag + el.value.slice(el.selectionEnd ?? at);
    update(i, { [field]: value });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at + tag.length, at + tag.length); });
  };

  return (
    <form
      className="space-y-5"
      action={(form) => start(async () => {
        const res = await saveSequence(id, form);
        if (res.ok) toast.success(res.message ?? "Saved"); else toast.error(res.error);
      })}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={name} required /></div>
        <div className="grid gap-1.5"><Label htmlFor="description">Who it&apos;s for (optional)</Label><Input id="description" name="description" defaultValue={description ?? ""} placeholder="e.g. Texas HVAC already on GHL" /></div>
        <div className="grid gap-1.5"><Label htmlFor="send_time">Send time (each lead&apos;s own time zone)</Label><Input id="send_time" name="send_time" type="time" defaultValue={sendTime.slice(0, 5)} required /></div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><Checkbox name="skip_weekends" defaultChecked={skipWeekends} />Move emails off Saturdays and Sundays</label>
      </div>

      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Merge fields: click one to insert it where your cursor is</div>
        <div className="flex flex-wrap gap-1.5">
          {MERGE_FIELDS.map((f) => (
            <button key={f.tag} type="button" title={f.help} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(f.tag)}
              className="rounded-md border bg-background px-2 py-0.5 font-mono text-xs hover:bg-accent">{f.tag}</button>
          ))}
        </div>
      </div>

      <input type="hidden" name="count" value={steps.length} />
      <ol className="space-y-4">
        {steps.map((s, i) => (
          <li key={s.key} className="space-y-3 rounded-lg border p-4">
            <input type="hidden" name={`template_${i}`} value={s.template_id ?? ""} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Step {i + 1}</span>
              <span className="text-sm text-muted-foreground">on day</span>
              <Input name={`day_${i}`} type="number" min={1} max={90} value={s.day} onChange={(e) => update(i, { day: Number(e.target.value) })} className="h-8 w-20" />
              <div className="ml-auto flex gap-1">
                <Button type="button" size="icon" variant="ghost" className="size-8" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp /></Button>
                <Button type="button" size="icon" variant="ghost" className="size-8" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown /></Button>
                <Button type="button" size="icon" variant="ghost" className="size-8" disabled={steps.length === 1} onClick={() => setSteps((cur) => cur.filter((_, j) => j !== i))} aria-label="Remove step"><Trash2 /></Button>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Subject{i > 0 && <span className="font-normal text-muted-foreground"> (leave empty to reply in the same thread)</span>}</Label>
              <Input name={`subject_${i}`} value={s.subject} data-step={i} data-field="subject" onFocus={(e) => (focused.current = e.currentTarget)}
                onChange={(e) => update(i, { subject: e.target.value })} required={i === 0} />
            </div>
            <div className="grid gap-1.5">
              <Label>Message</Label>
              <Textarea name={`body_${i}`} value={s.body} rows={7} data-step={i} data-field="body" onFocus={(e) => (focused.current = e.currentTarget)}
                onChange={(e) => update(i, { body: e.target.value })} required />
              <p className="text-xs text-muted-foreground">Your signature and the opt-out line are added when it&apos;s sent.</p>
            </div>
            {preview && sample && (
              <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm">
                <div className="mb-1 text-xs text-muted-foreground">Preview for {sample.label}</div>
                <div className="font-medium">{i === 0 || !s.subject.trim() ? (i === 0 ? previewMerge(s.subject, sample) : `Re: ${previewMerge(steps[0].subject, sample)}`) : previewMerge(s.subject, sample)}</div>
                <p className="mt-1 whitespace-pre-wrap">{previewMerge(s.body, sample)}</p>
              </div>
            )}
          </li>
        ))}
      </ol>

      {problems.length > 0 && <ul className="list-inside list-disc text-sm text-red-600 dark:text-red-400">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || problems.length > 0}>{pending ? <Loader2 className="animate-spin" /> : <Save />}Save sequence</Button>
        <Button type="button" variant="outline" disabled={steps.length >= 8} onClick={() => {
          const last = steps[steps.length - 1];
          setSteps((cur) => [...cur, { day: (last?.day ?? 0) + 4, subject: "", body: "", template_id: null, key: nextKey.current++ }]);
        }}><Plus />Add step</Button>
        {sample && <Button type="button" variant="ghost" onClick={() => setPreview((v) => !v)}><Eye />{preview ? "Hide preview" : "Preview"}</Button>}
      </div>
    </form>
  );
}
