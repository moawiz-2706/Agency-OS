import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { currentMember } from "@/lib/team";
import { memberName } from "@/lib/crm";
import { STATE_COOKIE, exchangeCode, revokeToken } from "@/lib/mail/google";
import { encryptToken } from "@/lib/mail/crypto";
import { runMail } from "@/lib/mail/worker";

export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Google sends the member back here: check it's the same browser, store the encrypted token. */
export async function GET(request: NextRequest) {
  const back = (status: string, reason?: string) => {
    const url = new URL("/account", request.url);
    url.searchParams.set("mail", status);
    if (reason) url.searchParams.set("reason", reason.slice(0, 200));
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: STATE_COOKIE, path: "/auth/gmail" });
    return res;
  };

  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const expected = request.cookies.get(STATE_COOKIE)?.value ?? "";
  if (!state || !expected || !same(state, expected)) return back("error", "The connection request expired. Try again.");
  if (params.get("error")) return back("error", params.get("error") === "access_denied" ? "You cancelled on Google's screen." : params.get("error")!);

  const { member } = await currentMember();
  if (!member) return NextResponse.redirect(new URL("/login", request.url));

  let refreshToken: string | undefined;
  try {
    const got = await exchangeCode(params.get("code") ?? "", `${request.nextUrl.origin}/auth/gmail/callback`);
    refreshToken = got.refreshToken;
    const supabase = await supabaseServer();
    const { error } = await supabase.rpc("save_my_mail_account", {
      p_email: got.email, p_from_name: memberName(member), p_token_encrypted: encryptToken(got.refreshToken, got.email),
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    if (refreshToken) await revokeToken(refreshToken);   // never leave an unused grant behind
    return back("error", e instanceof Error ? e.message : "Couldn't connect Gmail");
  }

  // First sync (looks back 14 days) after the redirect, so the page loads right away.
  after(() => runMail({ memberId: member.id, send: false }).catch(() => {}));
  return back("connected");
}
