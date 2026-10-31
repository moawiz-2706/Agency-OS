"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const ERRORS: Record<string, string> = {
  not_on_team: "That account is not on the team. Ask the owner to add your email.",
  other_browser: "That link was opened in a different browser from the one you asked from. Sign in with Google or your password instead.",
  expired: "That link has expired or was already used. Sign in with Google or your password, or send a new link.",
  failed: "Sign-in didn't complete. Please try again.",
};

type Mode = "password" | "link" | "reset";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
    </svg>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"google" | "form" | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(ERRORS[params.get("error") ?? ""] ?? "");

  const supabase = supabaseBrowser();
  const callback = `${typeof window === "undefined" ? "" : window.location.origin}/auth/callback`;
  const cleanEmail = email.trim().toLowerCase();

  async function google() {
    setBusy("google");
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback, queryParams: { prompt: "select_account" } },
    });
    if (error) { setBusy(null); setError(error.message); }
    // On success the browser is already on its way to Google.
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("form");
    setError("");
    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (error) {
        setBusy(null);
        setError(/invalid login/i.test(error.message)
          ? "Wrong email or password. If you haven't set a password yet, sign in with Google or an email link first, then set one under Account."
          : error.message);
        return;
      }
      router.replace("/");
      router.refresh();
      return;
    }
    const { error } = mode === "link"
      ? await supabase.auth.signInWithOtp({ email: cleanEmail, options: { shouldCreateUser: false, emailRedirectTo: callback } })
      : await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: `${callback}?next=/account` });
    setBusy(null);
    if (error) setError(/signups not allowed|not found|user/i.test(error.message) ? ERRORS.not_on_team : error.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <CardContent className="space-y-3 text-center">
        <MailCheck className="mx-auto size-10 text-emerald-600" />
        <p className="text-sm">
          {mode === "reset" ? "We sent a password reset link to " : "We sent a sign-in link to "}
          <span className="font-medium">{cleanEmail}</span>.
        </p>
        <p className="text-xs text-muted-foreground">Open it in this same browser. It works once and expires after an hour.</p>
        <Button variant="ghost" size="sm" onClick={() => { setSent(false); setMode("password"); }}>Back to sign in</Button>
      </CardContent>
    );
  }

  return (
    <CardContent className="space-y-5">
      <Button type="button" variant="outline" className="w-full" onClick={google} disabled={busy !== null}>
        {busy === "google" ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
        Continue with Google
      </Button>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />or<Separator className="flex-1" />
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@youragency.com" />
        </div>
        {mode === "password" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => { setMode("reset"); setError(""); }}>Forgot password?</button>
            </div>
            <Input id="password" type="password" required autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        <Button type="submit" className="w-full" disabled={busy !== null}>
          {busy === "form" && <Loader2 className="animate-spin" />}
          {mode === "password" ? "Sign in" : mode === "link" ? "Email me a sign-in link" : "Send reset link"}
        </Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>

      <div className="text-center text-xs text-muted-foreground">
        {mode === "password" ? (
          <button type="button" className="hover:text-foreground hover:underline" onClick={() => { setMode("link"); setError(""); }}>
            Email me a sign-in link instead
          </button>
        ) : (
          <button type="button" className="hover:text-foreground hover:underline" onClick={() => { setMode("password"); setError(""); }}>
            Sign in with a password
          </button>
        )}
      </div>
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
            <CardDescription>Use your Google account or your email and password.</CardDescription>
          </CardHeader>
          <Suspense><LoginForm /></Suspense>
        </Card>
        <p className="text-center text-xs text-muted-foreground">Team members only.</p>
      </div>
    </main>
  );
}
