"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Sets the signed-in user's password with Supabase Auth; the password never touches our database. */
export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("Use at least 8 characters");
    if (password !== confirm) return toast.error("The two passwords don't match");
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Password saved. You can now sign in with it.");
      setPassword("");
      setConfirm("");
    }
  }

  return (
    <form onSubmit={save} className="grid max-w-sm gap-4">
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input id="new-password" type="password" autoComplete="new-password" minLength={8} required
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Repeat it</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required aria-invalid={mismatch}
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {mismatch && <p className="text-xs text-destructive">Doesn&apos;t match yet</p>}
      </div>
      <Button type="submit" disabled={busy} className="w-fit">
        {busy && <Loader2 className="animate-spin" />}Save password
      </Button>
    </form>
  );
}
