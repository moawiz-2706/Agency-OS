"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Eye, Monitor, Pencil, Search, Smartphone, Sparkles, Wand2 } from "lucide-react";
import {
  renderEmail, renderMarketing, STYLES,
  type EmailDesign, type EmailFont, type EmailKind, type MarketingDesign,
} from "@/lib/mail/design";
import { previewMerge } from "@/lib/sequences";
import { SAMPLE_LEAD, type LibrarySequence } from "@/lib/email-library";
import { dateTime } from "@/lib/format";
import { saveEmailDesign, saveMarketingDesign, setScheduledDesign, updateScheduledEmail } from "@/app/(app)/templates/actions";
import { createSequenceFromLibrary } from "@/app/(app)/sequences/actions";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const ACCENTS = ["#1d4ed8", "#1e3a8a", "#0f766e", "#15803d", "#b45309", "#334155"];
const SIGN_OFFS = ["Best regards,", "Best,", "Thanks,", "Cheers,", "Talk soon,"];
const KIND_LABEL: Record<EmailKind, string> = { outreach: "Cold outreach", marketing: "Marketing" };

type Vars = Partial<Record<"first_name" | "full_name" | "company" | "city" | "trade" | "website" | "personal_line" | "my_name", string | null>>;
export type ScheduledEmail = {
  id: string; subject: string; body: string; step: number; status: string; scheduled_for: string | null; design: EmailKind;
  mine: boolean; author: string; company_id: string; company: string; to: string; to_name: string | null; vars: Vars;
};

type Props = {
  initial: EmailDesign; initialMarketing: MarketingDesign; canEdit: boolean; canEditMarketing: boolean; hasDesigns: boolean;
  signature: string; fromName: string; fromEmail: string; isOwner: boolean;
  library: LibrarySequence[]; rules: string[]; scheduled: ScheduledEmail[];
};

type Look = { design: EmailDesign; marketing: MarketingDesign };

/** The email exactly as it would go out, as an HTML document for the preview frame. */
function emailDoc(kind: EmailKind, body: string, signature: string, look: Look, fromEmail: string) {
  const r = kind === "marketing"
    ? renderMarketing(body, signature, look.marketing, {
      sign_off: look.design.sign_off, booking_url: look.marketing.cta_url ?? "https://thesentinelsystems.com", from_email: fromEmail, unsubscribe_url: "#",
    })
    : renderEmail(body, signature, look.design);
  const doc = r.html ?? `<!DOCTYPE html><html><body><pre style="white-space:pre-wrap;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;margin:0">${
    r.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></body></html>`;
  // The app may be in dark mode; the preview always shows the email as a light mail app would.
  const css = `<style>html,body{background:${kind === "marketing" ? "#f4f5f7" : "#fff"}!important;color-scheme:light;margin:0!important;padding:${kind === "marketing" ? 0 : "8px 10px"}!important}a{pointer-events:none}</style>`;
  return doc.includes("<head>") ? doc.replace("<head>", `<head>${css}`) : doc.replace("<body", `<head>${css}</head><body`);
}

function EmailFrame({ doc, subject, from, to, phone, height = 520 }: { doc: string; subject: string; from: string; to: string; phone: boolean; height?: number }) {
  return (
    <div className={cn("mx-auto overflow-hidden rounded-lg border bg-white text-neutral-900 shadow-sm transition-all", phone ? "max-w-[375px]" : "max-w-full")}>
      <div className="grid gap-0.5 border-b bg-neutral-50 px-4 py-3 text-xs text-neutral-600">
        <div className="truncate"><span className="text-neutral-400">From</span> {from}</div>
        <div className="truncate"><span className="text-neutral-400">To</span> {to}</div>
        <div className="pt-1 text-sm font-semibold text-neutral-900">{subject}</div>
      </div>
      <iframe title="Email preview" sandbox="allow-same-origin" srcDoc={doc} className="block w-full bg-white" style={{ height }} />
    </div>
  );
}

function WidthToggle({ phone, setPhone }: { phone: boolean; setPhone: (v: boolean) => void }) {
  return (
    <div className="flex rounded-md border p-0.5">
      <Button size="sm" variant={phone ? "ghost" : "secondary"} className="h-7" onClick={() => setPhone(false)} aria-label="Desktop width"><Monitor /></Button>
      <Button size="sm" variant={phone ? "secondary" : "ghost"} className="h-7" onClick={() => setPhone(true)} aria-label="Phone width"><Smartphone /></Button>
    </div>
  );
}

export function EmailTemplates(p: Props) {
  const [design, setDesign] = useState(p.initial);
  const [marketing, setMarketing] = useState(p.initialMarketing);
  const look = { design, marketing };
  return (
    <Tabs defaultValue={p.scheduled.length ? "scheduled" : "designs"} className="gap-4">
      <TabsList>
        <TabsTrigger value="scheduled">Scheduled emails ({p.scheduled.length})</TabsTrigger>
        <TabsTrigger value="designs">Designs</TabsTrigger>
        <TabsTrigger value="library">Library</TabsTrigger>
      </TabsList>
      <TabsContent value="scheduled"><ScheduledTab {...p} look={look} /></TabsContent>
      <TabsContent value="designs">
        <DesignsTab {...p} design={design} setDesign={setDesign} marketing={marketing} setMarketing={setMarketing} />
      </TabsContent>
      <TabsContent value="library"><LibraryTab library={p.library} rules={p.rules} look={look} signature={p.signature} fromName={p.fromName} fromEmail={p.fromEmail} /></TabsContent>
    </Tabs>
  );
}

// ---------- Designs ----------

function DesignsTab(p: Props & { design: EmailDesign; setDesign: (d: EmailDesign) => void; marketing: MarketingDesign; setMarketing: (m: MarketingDesign) => void }) {
  const { design, marketing } = p;
  const [saved, setSaved] = useState(p.initial);
  const [savedMk, setSavedMk] = useState(p.initialMarketing);
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<EmailKind>("outreach");
  const [phone, setPhone] = useState(false);
  const set = (patch: Partial<EmailDesign>) => p.setDesign({ ...design, ...patch });
  const setMk = (patch: Partial<MarketingDesign>) => p.setMarketing({ ...marketing, ...patch });
  const dirty = JSON.stringify(design) !== JSON.stringify(saved);
  const dirtyMk = JSON.stringify(marketing) !== JSON.stringify(savedMk);

  const sample = p.library.find((t) => t.design === kind) ?? p.library[0];
  const vars = { ...SAMPLE_LEAD, my_name: p.fromName.split(/\s+/)[0] };
  const doc = useMemo(() => emailDoc(kind, previewMerge(sample.steps[0].body, vars), p.signature, { design, marketing }, p.fromEmail),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, sample, design, marketing, p.signature, p.fromEmail]);

  const save = () => start(async () => {
    const res = await saveEmailDesign(design);
    if (res.ok) { setSaved(design); toast.success(res.message ?? "Saved"); } else toast.error(res.error);
  });
  const saveMk = () => start(async () => {
    const res = await saveMarketingDesign(marketing);
    if (res.ok) { setSavedMk(marketing); toast.success(res.message ?? "Saved"); } else toast.error(res.error);
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="grid content-start gap-6">
        <Card className={cn(kind === "outreach" && "ring-1 ring-primary")} onFocusCapture={() => setKind("outreach")} onClick={() => setKind("outreach")}>
          <CardHeader>
            <CardTitle>Cold outreach design</CardTitle>
            <CardDescription>For first emails to new leads: looks like a personal email, which is what gets replies and lands in the inbox.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2" role="radiogroup" aria-label="Style">
              {STYLES.map((s) => (
                <button key={s.key} type="button" role="radio" aria-checked={design.style === s.key} disabled={!p.canEdit && design.style !== s.key}
                  onClick={() => set({ style: s.key })}
                  className={cn("rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                    design.style === s.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50")}>
                  <div className="flex items-center gap-2 text-sm font-medium">{design.style === s.key && <Check className="size-4 text-primary" />}{s.label}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{s.help}</p>
                </button>
              ))}
            </div>
            <div className={cn("grid gap-5", design.style === "plain" && "pointer-events-none opacity-50")}>
              <ColourPicker value={design.accent} disabled={!p.canEdit} onChange={(accent) => set({ accent })} label="Link and accent colour" />
              <div className="grid gap-2">
                <Label htmlFor="sign_off">Sign-off</Label>
                <Input id="sign_off" value={design.sign_off} maxLength={60} disabled={!p.canEdit} onChange={(e) => set({ sign_off: e.target.value })} placeholder="Best regards," />
                <div className="flex flex-wrap gap-1.5">
                  {SIGN_OFFS.map((s) => (
                    <button key={s} type="button" disabled={!p.canEdit} onClick={() => set({ sign_off: s })}
                      className={cn("rounded-full border px-2.5 py-0.5 text-xs", design.sign_off === s ? "border-primary bg-primary/5" : "hover:bg-accent/50")}>{s}</button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Added above your signature, unless the email already ends with one. Used by both designs.</p>
              </div>
              <div className="grid gap-2">
                <Label>Font</Label>
                <Select value={design.font} onValueChange={(v) => set({ font: v as EmailFont })} disabled={!p.canEdit}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sans">Clean (Arial): looks like a normal email</SelectItem>
                    <SelectItem value="serif">Classic (Georgia): a little more formal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {p.canEdit ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={save} disabled={!dirty || pending}>{pending ? "Saving…" : "Save outreach design"}</Button>
                {dirty && <Button variant="ghost" onClick={() => p.setDesign(saved)} disabled={pending}>Undo</Button>}
              </div>
            ) : <p className="text-xs text-muted-foreground">Only an owner can change the designs.</p>}
          </CardContent>
        </Card>

        <Card className={cn(kind === "marketing" && "ring-1 ring-primary")} onFocusCapture={() => setKind("marketing")} onClick={() => setKind("marketing")}>
          <CardHeader>
            <CardTitle>Marketing design</CardTitle>
            <CardDescription>
              For people who already know you (replied, &quot;not now&quot;, past clients): branded header, one button, a footer. Don&apos;t use it for first cold emails.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2"><Label htmlFor="mk_header">Header</Label>
              <Input id="mk_header" value={marketing.header} maxLength={60} disabled={!p.canEditMarketing} onChange={(e) => setMk({ header: e.target.value })} /></div>
            <div className="grid gap-2"><Label htmlFor="mk_tagline">Tagline</Label>
              <Input id="mk_tagline" value={marketing.tagline} maxLength={100} disabled={!p.canEditMarketing} onChange={(e) => setMk({ tagline: e.target.value })} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="mk_cta">Button text</Label>
                <Input id="mk_cta" value={marketing.cta_text} maxLength={40} disabled={!p.canEditMarketing} onChange={(e) => setMk({ cta_text: e.target.value })} /></div>
              <div className="grid gap-2"><Label htmlFor="mk_url">Button link</Label>
                <Input id="mk_url" type="url" value={marketing.cta_url ?? ""} disabled={!p.canEditMarketing} placeholder="Booking link from Account"
                  onChange={(e) => setMk({ cta_url: e.target.value.trim() || null })} /></div>
            </div>
            <ColourPicker value={marketing.accent} disabled={!p.canEditMarketing} onChange={(accent) => setMk({ accent })} label="Brand colour" />
            {p.canEditMarketing ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={saveMk} disabled={!dirtyMk || pending}>{pending ? "Saving…" : "Save marketing design"}</Button>
                {dirtyMk && <Button variant="ghost" onClick={() => p.setMarketing(savedMk)} disabled={pending}>Undo</Button>}
              </div>
            ) : <p className="text-xs text-muted-foreground">{p.hasDesigns ? "Only an owner can change the designs." : "Needs migration 0015."}</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="lg:sticky lg:top-4 lg:self-start">
        <CardHeader className="flex-row flex-wrap items-center gap-2">
          <CardTitle className="flex-1">Preview</CardTitle>
          <div className="flex rounded-md border p-0.5">
            {(["outreach", "marketing"] as const).map((k) => (
              <Button key={k} size="sm" variant={kind === k ? "secondary" : "ghost"} className="h-7" onClick={() => setKind(k)}>{KIND_LABEL[k]}</Button>
            ))}
          </div>
          <WidthToggle phone={phone} setPhone={setPhone} />
        </CardHeader>
        <CardContent>
          <EmailFrame doc={doc} subject={previewMerge(sample.steps[0].subject, vars)} from={`${p.fromName} <${p.fromEmail}>`}
            to={`${SAMPLE_LEAD.full_name} <mike@${SAMPLE_LEAD.website}>`} phone={phone} height={kind === "marketing" ? 640 : 520} />
          <p className="mt-2 text-xs text-muted-foreground">Sample: &quot;{sample.name}&quot; for {SAMPLE_LEAD.company}, {SAMPLE_LEAD.city}.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function ColourPicker({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled: boolean; label: string }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {ACCENTS.map((c) => (
          <button key={c} type="button" aria-label={`Colour ${c}`} disabled={disabled} onClick={() => onChange(c)}
            className={cn("size-7 rounded-full border-2", value === c ? "border-foreground" : "border-transparent")} style={{ background: c }} />
        ))}
        <Input type="color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-8 w-14 cursor-pointer p-1" aria-label="Custom colour" />
      </div>
    </div>
  );
}

// ---------- Scheduled emails ----------

const STATUS: Record<string, { label: string; cls: string }> = {
  approved: { label: "Scheduled", cls: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" },
  pending_approval: { label: "Needs approval", cls: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" },
  failed: { label: "Failed", cls: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" },
  draft: { label: "Draft", cls: "" },
};

function ScheduledTab(p: Props & { look: Look }) {
  const [q, setQ] = useState("");
  const [who, setWho] = useState<"all" | "mine">("all");
  const [step, setStep] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const list = p.scheduled.filter((e) =>
    (who === "all" || e.mine) && (step === "all" || String(e.step) === step)
    && (!q || `${e.company} ${e.to} ${e.subject}`.toLowerCase().includes(q.toLowerCase())));
  const editable = (e: ScheduledEmail) => e.mine || p.isOwner;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = (design: EmailKind) => start(async () => {
    const res = await setScheduledDesign([...picked], design);
    if (res.ok) { toast.success(res.message ?? "Saved"); setPicked(new Set()); } else toast.error(res.error);
  });

  if (!p.scheduled.length) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No emails are waiting to go out.</CardContent></Card>;
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, email or subject" className="pl-8" />
        </div>
        <Select value={who} onValueChange={(v) => setWho(v as "all" | "mine")}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Everyone&apos;s</SelectItem><SelectItem value="mine">Mine</SelectItem></SelectContent>
        </Select>
        <Select value={step} onValueChange={setStep}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All emails</SelectItem>
            {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>Email {n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {picked.size > 0 && p.hasDesigns && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="flex-1">{picked.size} selected</span>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => bulk("outreach")}>Use cold outreach design</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => bulk("marketing")}>Use marketing design</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{list.length} email{list.length === 1 ? "" : "s"}, soonest first. Times are Pakistan time.</p>
      <Card className="gap-0 py-0">
        {list.map((e) => (
          <div key={e.id} className="border-b last:border-b-0">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Checkbox checked={picked.has(e.id)} onCheckedChange={() => toggle(e.id)} disabled={!editable(e)} aria-label={`Select email to ${e.company}`} />
              <button type="button" className="grid min-w-0 flex-1 gap-0.5 text-left" onClick={() => setOpen(open === e.id ? null : e.id)}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="truncate font-medium">{e.company}</span>
                  <span className="text-xs text-muted-foreground">Email {e.step}</span>
                  <Badge variant="outline" className={cn("font-normal", STATUS[e.status]?.cls)}>{STATUS[e.status]?.label ?? e.status}</Badge>
                  {e.design === "marketing" && <Badge variant="secondary" className="font-normal">Marketing</Badge>}
                </div>
                <div className="truncate text-sm text-muted-foreground">{e.subject}</div>
              </button>
              <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                <div>{dateTime(e.scheduled_for)}</div><div>from {e.author}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpen(open === e.id ? null : e.id)} aria-label="Open">
                {editable(e) ? <Pencil /> : <Eye />}
              </Button>
            </div>
            {open === e.id && <EmailEditor key={e.id} email={e} {...p} canEdit={editable(e)} onDone={() => setOpen(null)} />}
          </div>
        ))}
      </Card>
    </div>
  );
}

function EmailEditor({ email, look, library, signature, fromEmail, canEdit, hasDesigns, onDone }: Props & { email: ScheduledEmail; look: Look; canEdit: boolean; onDone: () => void }) {
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const [kind, setKind] = useState<EmailKind>(email.design);
  const [phone, setPhone] = useState(false);
  const [tpl, setTpl] = useState("");
  const [pending, start] = useTransition();
  const doc = useMemo(() => emailDoc(kind, body, signature, look, fromEmail), [kind, body, signature, look, fromEmail]);

  function applyTemplate(value: string) {
    setTpl(value);
    const [key, i] = value.split(":");
    const t = library.find((x) => x.key === key);
    const s = t?.steps[Number(i)];
    if (!t || !s) return;
    setBody(previewMerge(s.body, email.vars));
    // Follow-ups keep their "Re:" subject so they stay in the same thread.
    if (s.subject.trim() && email.step === 1) setSubject(previewMerge(s.subject, email.vars));
    if (hasDesigns) setKind(t.design);
    toast.message(`Filled in from "${t.name}", email ${Number(i) + 1}. Check it, then save.`);
  }
  const save = () => start(async () => {
    const res = await updateScheduledEmail(email.id, subject, body, kind);
    if (res.ok) { toast.success(res.message ?? "Saved"); onDone(); } else toast.error(res.error);
  });

  return (
    <div className="grid gap-4 border-t bg-muted/20 p-3 lg:grid-cols-2">
      <div className="grid content-start gap-3">
        <div className="text-xs text-muted-foreground">To {email.to_name ? `${email.to_name} <${email.to}>` : email.to} · from {email.author}&apos;s inbox</div>
        {canEdit && (
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5"><Wand2 className="size-3.5" />Use a template</Label>
            <Select value={tpl} onValueChange={applyTemplate}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Replace the text with a library email…" /></SelectTrigger>
              <SelectContent>
                {library.map((t) => t.steps.map((s, i) => (
                  <SelectItem key={`${t.key}:${i}`} value={`${t.key}:${i}`}>{t.name} · email {i + 1}{i + 1 === email.step ? " (matches)" : ""}</SelectItem>
                )))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-1.5"><Label htmlFor={`s-${email.id}`}>Subject</Label>
          <Input id={`s-${email.id}`} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit} /></div>
        <div className="grid gap-1.5"><Label htmlFor={`b-${email.id}`}>Message</Label>
          <Textarea id={`b-${email.id}`} value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit} rows={12} className="font-mono text-sm" />
          <p className="text-xs text-muted-foreground">Blank line = new paragraph. Lines starting with &quot;- &quot; become a list. The signature and opt-out line are added when it&apos;s sent.</p>
        </div>
        {hasDesigns && (
          <div className="grid gap-1.5">
            <Label>Design</Label>
            <div className="flex rounded-md border p-0.5">
              {(["outreach", "marketing"] as const).map((k) => (
                <Button key={k} size="sm" variant={kind === k ? "secondary" : "ghost"} className="h-8 flex-1" disabled={!canEdit} onClick={() => setKind(k)}>{KIND_LABEL[k]}</Button>
              ))}
            </div>
          </div>
        )}
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save email"}</Button>
            <Button variant="ghost" onClick={onDone} disabled={pending}>Close</Button>
          </div>
        ) : <p className="text-xs text-muted-foreground">Only {email.author} or an owner can change this email.</p>}
      </div>
      <div className="grid content-start gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">How it will look</span>
          <WidthToggle phone={phone} setPhone={setPhone} />
        </div>
        <EmailFrame doc={doc} subject={subject} from={`${email.author}`} to={email.to} phone={phone} height={kind === "marketing" ? 600 : 460} />
        <p className="text-xs text-muted-foreground">Shown with your signature; it goes out with the sender&apos;s.</p>
      </div>
    </div>
  );
}

// ---------- Library ----------

function LibraryTab({ library, rules, look, signature, fromName, fromEmail }: {
  library: LibrarySequence[]; rules: string[]; look: Look; signature: string; fromName: string; fromEmail: string;
}) {
  const [seqKey, setSeqKey] = useState(library[0]?.key ?? "");
  const [step, setStep] = useState(0);
  const [phone, setPhone] = useState(false);
  const seq = library.find((s) => s.key === seqKey) ?? library[0];
  const vars = { ...SAMPLE_LEAD, my_name: fromName.split(/\s+/)[0] };
  const s = seq.steps[Math.min(step, seq.steps.length - 1)];
  const subject = step === 0 || s.subject.trim() ? previewMerge(s.subject, vars) : `Re: ${previewMerge(seq.steps[0].subject, vars)}`;
  const doc = emailDoc(seq.design, previewMerge(s.body, vars), signature, look, fromEmail);

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="grid content-start gap-3">
          {library.map((t) => (
            <Card key={t.key} className={cn("gap-3 py-4", t.key === seq.key && "ring-1 ring-primary")}>
              <CardHeader className="px-4">
                <div className="flex items-center gap-2">
                  <CardTitle className="flex-1 text-base">{t.name}</CardTitle>
                  <Badge variant={t.design === "marketing" ? "secondary" : "outline"} className="font-normal">{KIND_LABEL[t.design]}</Badge>
                </div>
                <CardDescription>{t.bestFor} · {t.steps.length} email{t.steps.length === 1 ? "" : "s"}, days {t.steps.map((x) => x.day).join(", ")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 px-4">
                <Button variant="outline" size="sm" onClick={() => { setSeqKey(t.key); setStep(0); }}><Eye />Preview</Button>
                <form action={createSequenceFromLibrary.bind(null, t.key)}><SubmitButton size="sm">Use as a sequence</SubmitButton></form>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex-1">{seq.name}</CardTitle>
              <WidthToggle phone={phone} setPhone={setPhone} />
            </div>
            <div className="flex flex-wrap rounded-md border p-0.5">
              {seq.steps.map((x, i) => (
                <Button key={i} size="sm" variant={step === i ? "secondary" : "ghost"} className="h-8 px-2.5" onClick={() => setStep(i)}>Email {i + 1} · day {x.day}</Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <EmailFrame doc={doc} subject={subject} from={`${fromName} <${fromEmail}>`} to={`${SAMPLE_LEAD.full_name} <mike@${SAMPLE_LEAD.website}>`}
              phone={phone} height={seq.design === "marketing" ? 640 : 520} />
            <p className="mt-2 text-xs text-muted-foreground">Sample lead: {SAMPLE_LEAD.company}, {SAMPLE_LEAD.city}. Follow-ups go in the same thread as email 1.</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" />What gets replies</CardTitle>
          <CardDescription>The rules the cold-outreach templates follow. Keep to them when you edit.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm md:grid-cols-2">
            {rules.map((r) => <li key={r} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /><span>{r}</span></li>)}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
