import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Where every sign-in lands: Google (OAuth code), email links in the default
 * template (PKCE code), and the token_hash template, which also works when the
 * link is opened in a different browser or the Gmail app.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"), type);
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (providerError) return toLogin(url, reason(providerError));

  const supabase = await supabaseServer();
  const { error } = tokenHash && type
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error("missing code") };

  if (error) return toLogin(url, reason(error.message));
  return NextResponse.redirect(new URL(next, url.origin));
}

/** Only same-site paths; a password-reset link goes to the account page to set the new one. */
function safeNext(next: string | null, type: EmailOtpType | null) {
  if (type === "recovery") return "/account?reset=1";
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function reason(message: string) {
  if (/signup|not allowed|user not found/i.test(message)) return "not_on_team";
  if (/verifier|code challenge|both auth code and code verifier/i.test(message)) return "other_browser";
  if (/expired|invalid|already been used|otp/i.test(message)) return "expired";
  return "failed";
}

function toLogin(url: URL, why: string) {
  return NextResponse.redirect(new URL(`/login?error=${why}`, url.origin));
}
