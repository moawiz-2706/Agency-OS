"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(params.get("error") ? "error" : "idle");
  const [message, setMessage] = useState(params.get("error") ? "That sign-in link expired or was opened in another browser. Send a new one." : "");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      // Only people set up by scripts/setup-team.mjs can sign in.
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setState("error");
      setMessage(/signups not allowed|not found|user/i.test(error.message)
        ? "That email is not on the team. Ask the owner to add you."
        : error.message);
    } else {
      setState("sent");
    }
  }

  if (state === "sent") {
    return (
      <CardContent className="space-y-3 text-center">
        <MailCheck className="mx-auto size-10 text-emerald-600" />
        <p className="text-sm">We sent a sign-in link to <span className="font-medium">{email}</span>.</p>
        <p className="text-xs text-muted-foreground">Open it in this browser. You can close this tab.</p>
        <Button variant="ghost" size="sm" onClick={() => setState("idle")}>Use a different email</Button>
      </CardContent>
    );
  }

  return (
    <CardContent>
      <form onSubmit={send} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" type="email" required autoFocus autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@youragency.com" />
        </div>
        <Button type="submit" className="w-full" disabled={state === "sending"}>
          {state === "sending" && <Loader2 className="animate-spin" />}
          Send sign-in link
        </Button>
        {state === "error" && <p role="alert" className="text-sm text-destructive">{message}</p>}
      </form>
    </CardContent>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">A</span>
          AgencyOS
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>We&apos;ll email you a one-time link. No password needed.</CardDescription>
          </CardHeader>
          <Suspense><LoginForm /></Suspense>
        </Card>
        <p className="text-center text-xs text-muted-foreground">Team members only.</p>
      </div>
    </main>
  );
}
