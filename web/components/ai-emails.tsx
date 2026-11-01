"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, Download, FileCheck2, Loader2, Upload } from "lucide-react";
import { checkAiEmails, importAiEmails, type AiImportResult } from "@/app/(app)/leads/ai-emails/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Step 1: download leads + prompt. Step 2: upload the AI's CSV, check it, import as drafts. */
export function AiEmailsWorkflow({ fresh, emailed, inboxes, startDefault }: {
  fresh: number; emailed: number; inboxes: { id: string; email: string }[]; startDefault: string;
}) {
  const [emails, setEmails] = useState("4");
  const [days, setDays] = useState("1,4,8,14");
  const [includeEmailed, setIncludeEmailed] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<AiImportResult | null>(null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const q = new URLSearchParams({ emails, days, ...(includeEmailed ? { emailed: "1" } : {}) });
  const count = fresh + (includeEmailed ? emailed : 0);

  const run = (fn: typeof checkAiEmails) => start(async () => {
    const f = new FormData(form.current!);
    f.delete("files");
    for (const file of files) f.append("files", file);
    const res = await fn(f);
    setResult(res);
    if (!res.ok) toast.error(res.error);
    else if (res.imported != null) toast.success(`${res.imported} emails saved as drafts waiting for your approval`);
  });

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>1. Download the leads and the prompt</CardTitle>
          <CardDescription>
            {count} researched lead{count === 1 ? "" : "s"} with an emailable contact and no emails waiting
            {includeEmailed ? "" : ", never emailed"}. Each row has the issues the research found, the hook and the offer to pitch.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Emails per lead</Label>
              <Select value={emails} onValueChange={setEmails}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{["2", "3", "4", "5"].map((n) => <SelectItem key={n} value={n}>{n} emails</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="days">On days</Label><Input id="days" value={days} onChange={(e) => setDays(e.target.value)} placeholder="1,4,8,14" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={includeEmailed} onCheckedChange={(v) => setIncludeEmailed(v === true)} />
            Also include leads that were emailed before ({emailed})</label>
          <div className="flex flex-wrap gap-2">
            <Button asChild disabled={!count}><a href={`/api/leads/ai-export?file=leads&${q}`}><Download />Leads CSV</a></Button>
            <Button asChild variant="outline"><a href={`/api/leads/ai-export?file=prompt&${q}`}><Download />Prompt (.md)</a></Button>
            <Button variant="ghost" onClick={async () => {
              const text = await fetch(`/api/leads/ai-export?file=prompt&${q}`).then((r) => r.text());
              await navigator.clipboard.writeText(text);
              toast.success("Prompt copied");
            }}><Copy />Copy prompt</Button>
          </div>
          <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
            <li>Open Claude, ChatGPT or Manus and start a new chat.</li>
            <li>Attach the leads CSV, and paste the prompt (or attach the .md file).</li>
            <li>Download the <span className="font-mono">ai-emails.csv</span> it gives back, and upload it in step 2.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Upload the AI&apos;s emails</CardTitle>
          <CardDescription>Nothing is sent: the emails become drafts on each lead, waiting for your approval. Edit, approve or cancel them as usual.</CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={form} className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div className="grid gap-1.5">
              <Label htmlFor="files">CSV file(s) from the AI</Label>
              <Input id="files" type="file" accept=".csv,text/csv" multiple onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setResult(null); }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="start">Day 1 (first emails)</Label><Input id="start" name="start" type="date" defaultValue={startDefault} required /></div>
              <div className="grid gap-1.5"><Label htmlFor="time">Send time (lead&apos;s time zone)</Label><Input id="time" name="time" type="time" defaultValue="08:00" required /></div>
            </div>
            {inboxes.length > 1 && (
              <div className="grid gap-1.5"><Label>Send from</Label>
                <Select name="from_account" defaultValue="auto"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="auto">My default inbox</SelectItem>{inboxes.map((i) => <SelectItem key={i.id} value={i.id}>{i.email}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm"><Checkbox name="skip_weekends" defaultChecked />Move emails off Saturdays and Sundays</label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={!files.length || pending} onClick={() => run(checkAiEmails)}>
                {pending ? <Loader2 className="animate-spin" /> : <FileCheck2 />}Check file
              </Button>
              <Button type="button" disabled={!files.length || pending || !result?.ok || !result.emails || result.imported != null} onClick={() => run(importAiEmails)}>
                {pending ? <Loader2 className="animate-spin" /> : <Upload />}Import {result?.emails ? `${result.emails} emails` : ""} as drafts
              </Button>
            </div>
          </form>

          {result && (
            <div className="mt-5 space-y-3 border-t pt-4 text-sm">
              {result.error && <p className="text-red-600 dark:text-red-400">{result.error}</p>}
              {result.ok && (
                <p className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  {result.imported != null
                    ? `${result.imported} emails saved for ${result.leads} leads, waiting for your approval.`
                    : `${result.emails} emails for ${result.leads} leads are ready to import.`}
                </p>
              )}
              {result.imported != null && (
                <div className="flex gap-2">
                  <Button asChild size="sm"><Link href="/inbox">Review and approve in the Inbox</Link></Button>
                </div>
              )}
              {result.problems.length > 0 && (
                <div>
                  <div className="font-medium text-amber-700 dark:text-amber-400">{result.problems.length} problem{result.problems.length === 1 ? "" : "s"} (these leads are skipped):</div>
                  <ul className="mt-1 max-h-48 list-inside list-disc overflow-auto text-xs text-muted-foreground">{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              )}
              {result.sample.length > 0 && result.imported == null && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Preview the first emails</summary>
                  <ul className="mt-2 space-y-3">
                    {result.sample.map((s, i) => (
                      <li key={i} className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{s.company} · {s.email} · email {s.step}, day {s.send_day}</div>
                        <div className="font-medium">{s.subject}</div>
                        <p className="mt-1 whitespace-pre-wrap">{s.body}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
