"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Monitor, Smartphone, Sparkles } from "lucide-react";
import { renderEmail, STYLES, type EmailDesign, type EmailFont } from "@/lib/mail/design";
import { previewMerge } from "@/lib/sequences";
import { SAMPLE_LEAD, type LibrarySequence } from "@/lib/email-library";
import { saveEmailDesign } from "@/app/(app)/templates/actions";
import { createSequenceFromLibrary } from "@/app/(app)/sequences/actions";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ACCENTS = ["#1d4ed8", "#1e3a8a", "#0f766e", "#15803d", "#b45309", "#334155"];
const SIGN_OFFS = ["Best regards,", "Best,", "Thanks,", "Cheers,", "Talk soon,"];

type Props = {
  initial: EmailDesign; canEdit: boolean; signature: string; fromName: string; fromEmail: string;
  library: LibrarySequence[]; rules: string[];
};

export function EmailTemplates({ initial, canEdit, signature, fromName, fromEmail, library, rules }: Props) {
  const [design, setDesign] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const [seqKey, setSeqKey] = useState(library[0]?.key ?? "");
  const [step, setStep] = useState(0);
  const [phone, setPhone] = useState(false);
  const dirty = JSON.stringify(design) !== JSON.stringify(saved);
  const set = (patch: Partial<EmailDesign>) => setDesign((d) => ({ ...d, ...patch }));

  const seq = library.find((s) => s.key === seqKey) ?? library[0];
  const preview = useMemo(() => {
    const s = seq.steps[Math.min(step, seq.steps.length - 1)];
    const vars = { ...SAMPLE_LEAD, my_name: fromName.split(/\s+/)[0] };
    const subject = step === 0 || s.subject.trim() ? previewMerge(s.subject, vars) : `Re: ${previewMerge(seq.steps[0].subject, vars)}`;
    const r = renderEmail(previewMerge(s.body, vars), signature, design);
    const doc = r.html ?? `<!DOCTYPE html><html><body style="margin:0"><pre style="white-space:pre-wrap;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;margin:0">${
      r.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></body></html>`;
    // The app may be in dark mode; the preview always shows the email as a light mail app would.
    const css = "<style>html,body{background:#fff!important;color-scheme:light;margin:0!important;padding:8px 10px!important}</style>";
    return { subject, doc: doc.includes("<head>") ? doc.replace("<head>", `<head>${css}`) : doc.replace("<body", `<head>${css}</head><body`) };
  }, [seq, step, design, signature, fromName]);

  function save() {
    start(async () => {
      const res = await saveEmailDesign(design);
      if (res.ok) { setSaved(design); toast.success(res.message ?? "Saved"); } else toast.error(res.error);
    });
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Email design</CardTitle>
              <CardDescription>One look for every outreach email the team sends. The preview updates as you change it.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-2" role="radiogroup" aria-label="Style">
                {STYLES.map((s) => (
                  <button key={s.key} type="button" role="radio" aria-checked={design.style === s.key} disabled={!canEdit && design.style !== s.key}
                    onClick={() => set({ style: s.key })}
                    className={cn("rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                      design.style === s.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50")}>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {design.style === s.key && <Check className="size-4 text-primary" />}{s.label}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{s.help}</p>
                  </button>
                ))}
              </div>

              <div className={cn("grid gap-5", design.style === "plain" && "pointer-events-none opacity-50")}>
                <div className="grid gap-2">
                  <Label>Link and accent colour</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {ACCENTS.map((c) => (
                      <button key={c} type="button" aria-label={`Colour ${c}`} disabled={!canEdit} onClick={() => set({ accent: c })}
                        className={cn("size-7 rounded-full border-2", design.accent === c ? "border-foreground" : "border-transparent")} style={{ background: c }} />
                    ))}
                    <Input type="color" value={design.accent} disabled={!canEdit} onChange={(e) => set({ accent: e.target.value })}
                      className="h-8 w-14 cursor-pointer p-1" aria-label="Custom colour" />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="sign_off">Sign-off</Label>
                  <Input id="sign_off" value={design.sign_off} maxLength={60} disabled={!canEdit} onChange={(e) => set({ sign_off: e.target.value })} placeholder="Best regards," />
                  <div className="flex flex-wrap gap-1.5">
                    {SIGN_OFFS.map((s) => (
                      <button key={s} type="button" disabled={!canEdit} onClick={() => set({ sign_off: s })}
                        className={cn("rounded-full border px-2.5 py-0.5 text-xs", design.sign_off === s ? "border-primary bg-primary/5" : "hover:bg-accent/50")}>{s}</button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Added above your signature, unless the email already ends with one.</p>
                </div>

                <div className="grid gap-2">
                  <Label>Font</Label>
                  <Select value={design.font} onValueChange={(v) => set({ font: v as EmailFont })} disabled={!canEdit}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sans">Clean (Arial): looks like a normal email</SelectItem>
                      <SelectItem value="serif">Classic (Georgia): a little more formal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {canEdit ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={save} disabled={!dirty || pending}>{pending ? "Saving…" : "Save design"}</Button>
                  {dirty && <Button variant="ghost" onClick={() => setDesign(saved)} disabled={pending}>Undo changes</Button>}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Only an owner can change the design. Your signature is set per inbox on the Account page.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" />What gets replies</CardTitle>
              <CardDescription>The rules every template below follows. Keep to them when you edit.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm">
                {rules.map((r) => <li key={r} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /><span>{r}</span></li>)}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex-1">Preview</CardTitle>
              <div className="flex rounded-md border p-0.5">
                <Button size="sm" variant={phone ? "ghost" : "secondary"} className="h-7" onClick={() => setPhone(false)} aria-label="Desktop width"><Monitor /></Button>
                <Button size="sm" variant={phone ? "secondary" : "ghost"} className="h-7" onClick={() => setPhone(true)} aria-label="Phone width"><Smartphone /></Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={seq.key} onValueChange={(v) => { setSeqKey(v); setStep(0); }}>
                <SelectTrigger className="min-w-48 flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>{library.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex rounded-md border p-0.5">
                {seq.steps.map((s, i) => (
                  <Button key={i} size="sm" variant={step === i ? "secondary" : "ghost"} className="h-8 px-2.5" onClick={() => setStep(i)}>Email {i + 1}</Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className={cn("mx-auto overflow-hidden rounded-lg border bg-white text-neutral-900 shadow-sm transition-all", phone ? "max-w-[375px]" : "max-w-full")}>
              <div className="grid gap-0.5 border-b bg-neutral-50 px-4 py-3 text-xs text-neutral-600">
                <div><span className="text-neutral-400">From</span> {fromName} &lt;{fromEmail}&gt;</div>
                <div><span className="text-neutral-400">To</span> {SAMPLE_LEAD.full_name} &lt;mike@{SAMPLE_LEAD.website}&gt;</div>
                <div className="pt-1 text-sm font-semibold text-neutral-900">{preview.subject}</div>
              </div>
              <iframe title="Email preview" sandbox="allow-same-origin" srcDoc={preview.doc} className="block h-[520px] w-full bg-white" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Sample lead: {SAMPLE_LEAD.company}, {SAMPLE_LEAD.city}. Day {seq.steps[step]?.day} of the sequence. Follow-ups go in the same thread as Email 1.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Template library</h2>
          <p className="text-sm text-muted-foreground">Proven 4-email sequences, one per offer. &quot;Use this&quot; makes it a sequence you can edit, then add leads to it.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {library.map((t) => (
            <Card key={t.key} className={cn("flex flex-col", t.key === seq.key && "ring-1 ring-primary")}>
              <CardHeader>
                <CardTitle className="text-base">{t.name}</CardTitle>
                <CardDescription>{t.bestFor}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <ol className="grid gap-1 text-sm">
                  {t.steps.map((s, i) => (
                    <li key={i} className="flex items-baseline gap-2">
                      <Badge variant="outline" className="shrink-0 font-normal">Day {s.day}</Badge>
                      <span className="truncate text-muted-foreground">{i === 0 ? previewMerge(s.subject, SAMPLE_LEAD) : "Follow-up in the same thread"}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setSeqKey(t.key); setStep(0); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Preview</Button>
                  <form action={createSequenceFromLibrary.bind(null, t.key)}>
                    <SubmitButton size="sm">Use this</SubmitButton>
                  </form>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
