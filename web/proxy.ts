import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Sign-in, the privacy/terms and unsubscribe pages, the website's contact form, PWA files and /api/mail/tick (which checks its own secret) need no session.
const PUBLIC = ["/login", "/auth/", "/api/mail/tick", "/privacy", "/terms", "/offline", "/icons/", "/icon", "/apple-icon", "/manifest.webmanifest", "/sw.js", "/robots.txt",
  "/unsubscribe", "/api/unsubscribe", "/forms/", "/api/forms/"];

/** Refresh the Supabase session on every request and send signed-out visitors to /login. */
export async function proxy(request: NextRequest) {
  // Supabase sends people to the Site URL when the redirect isn't allow-listed, so a
  // sign-in code can land on any page. Hand it to the callback instead of losing it.
  const params = request.nextUrl.searchParams;
  if (!request.nextUrl.pathname.startsWith("/auth/") && (params.has("code") || params.has("token_hash") || params.has("error_description"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() revalidates the token with Supabase; don't put code between createServerClient and this.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && !PUBLIC.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
