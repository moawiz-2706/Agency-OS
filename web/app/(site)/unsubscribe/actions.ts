"use server";

import { redirect } from "next/navigation";
import { verifyUnsubscribe } from "@/lib/mail/unsubscribe";
import { unsubscribeAddress } from "@/lib/mail/worker";

export async function confirmUnsubscribe(e: string, t: string) {
  const email = verifyUnsubscribe(e, t);
  if (!email) redirect("/unsubscribe");
  let ok = true;
  try {
    await unsubscribeAddress(email);
  } catch {
    ok = false;
  }
  redirect(`/unsubscribe?${new URLSearchParams({ e, t, [ok ? "done" : "failed"]: "1" })}`);
}
