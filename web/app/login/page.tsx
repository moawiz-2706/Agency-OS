"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

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

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">AgencyOS</h1>
      <p className="mt-1 text-sm text-slate-500">Sign in with a link sent to your email.</p>
      {state === "sent" ? (
        <p className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
          Check <b>{email}</b> for a sign-in link. You can close this tab.
        </p>
      ) : (
        <form onSubmit={send} className="mt-6 space-y-3">
          <input
            type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@youragency.com" className="input w-full"
          />
          <button disabled={state === "sending"} className="btn-primary w-full">
            {state === "sending" ? "Sending…" : "Send sign-in link"}
          </button>
          {state === "error" && <p className="text-sm text-rose-600">{message}</p>}
        </form>
      )}
    </main>
  );
}
