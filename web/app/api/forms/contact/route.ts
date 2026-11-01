import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { allowedOrigins, checkContactForm } from "@/lib/forms";
import { envValue } from "@/lib/mail/env";
import { submitWebForm } from "@/lib/mail/worker";

export const dynamic = "force-dynamic";

// The website's contact form posts here (JSON or a normal form post). Open to the
// public, so: only listed websites may post from the browser (FORM_ORIGINS), bots are
// trapped by checkContactForm, and the database limits enquiries per visitor.

function cors(req: NextRequest) {
  const origin = req.headers.get("origin");
  const ok = !!origin && (allowedOrigins(envValue("FORM_ORIGINS") ?? undefined).has(origin) || origin === req.nextUrl.origin);
  return ok ? { "Access-Control-Allow-Origin": origin!, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } : null;
}

export function OPTIONS(req: NextRequest) {
  const h = cors(req);
  return new NextResponse(null, { status: h ? 204 : 403, headers: h ?? {} });
}

export async function POST(req: NextRequest) {
  const h = cors(req);
  // A browser on some other website: refuse. (No Origin = a server or a plain form post: allowed.)
  if (req.headers.get("origin") && !h) return NextResponse.json({ ok: false, error: "This website can't use this form." }, { status: 403 });
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: h ?? {} });

  let data: Record<string, unknown>;
  try {
    const type = req.headers.get("content-type") ?? "";
    data = type.includes("application/json") ? await req.json() : Object.fromEntries((await req.formData()).entries());
  } catch {
    return reply({ ok: false, error: "Couldn't read the form." }, 400);
  }
  const checked = checkContactForm(data);
  if (checked.ok === "spam") return reply({ ok: true });   // don't tell bots they were caught
  if (!checked.ok) return reply({ ok: false, error: checked.error }, 400);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ipHash = createHash("sha256").update(`${envValue("MAILER_SECRET") ?? ""}:${ip}`).digest("hex").slice(0, 32);
  try {
    await submitWebForm({ ...checked.form, page: checked.form.page || req.headers.get("referer") || "" }, ipHash);
    return reply({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/too many enquiries/.test(msg)) return reply({ ok: false, error: "Too many messages from here. Please try again in an hour." }, 429);
    if (/valid email|your name/.test(msg)) return reply({ ok: false, error: msg.replace(/^.*?: /, "") }, 400);
    console.error("web form:", msg);
    return reply({ ok: false, error: "Something went wrong. Please email us instead." }, 500);
  }
}
