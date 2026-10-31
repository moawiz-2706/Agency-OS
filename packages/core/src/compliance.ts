import { mxHosts } from "@agencyos/adapters";
import { db, logActivity, must } from "@agencyos/db";
import type { ConsentBasis } from "./config.js";
import { isValidEmailSyntax } from "./csv.js";

// SPEC "Outreach, deliverability and compliance". These rules are enforced in
// code; the outreach_send_guard trigger repeats the hard ones in the database.

export const CASL_BASES: ConsentBasis[] = ["casl_implied_published", "casl_implied_relationship", "express"];

const ROLE_LOCALS = new Set([
  "info", "office", "contact", "admin", "sales", "service", "services", "support", "hello", "team",
  "help", "booking", "bookings", "schedule", "scheduling", "dispatch", "customerservice", "inquiries",
  "enquiries", "mail", "billing", "accounts", "reception", "frontdesk", "jobs", "careers", "hr", "marketing",
]);

/** info@, office@... allowed but flagged: they reach a shared inbox, not the owner. */
export function isRoleAddress(email: string): boolean {
  return ROLE_LOCALS.has(email.split("@")[0].replace(/[^a-z]/g, ""));
}

/**
 * Lawful basis for a newly imported contact.
 * US: cold B2B email is allowed (CAN-SPAM), so `usBasis` applies.
 * Canada: only implied consent from conspicuous publication counts, and a bought
 * list doesn't prove that. We record it only when the source URL is on the
 * business's own website; otherwise it stays unknown and can't be emailed.
 */
export function consentForImport(
  country: "US" | "CA" | null,
  email: string | null,
  sourceUrl: string | null,
  companyDomain: string | null,
  usBasis: ConsentBasis = "can_spam_b2b",
): { basis: ConsentBasis; published: boolean } {
  if (!email) return { basis: "unknown", published: false };
  if (country === "US") return { basis: usBasis, published: false };
  if (country === "CA" && sourceUrl && companyDomain) {
    try {
      const host = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
      if (host === companyDomain || host.endsWith(`.${companyDomain}`)) {
        return { basis: "casl_implied_published", published: true };
      }
    } catch { /* not a URL */ }
  }
  return { basis: "unknown", published: false };
}

export type SendCheck = {
  email: string | null;
  email_status: string;
  consent_basis: ConsentBasis;
  do_not_contact: boolean;
  country: "US" | "CA" | null;
  suppressed: boolean;
};

/** Why a contact can't be emailed, or an empty list when it can. */
export function sendBlockers(c: SendCheck): string[] {
  const out: string[] = [];
  if (!c.email) out.push("no email address");
  if (c.do_not_contact) out.push("marked do-not-contact");
  if (c.suppressed) out.push("on the suppression list");
  if (c.email_status === "bounced") out.push("email bounced before");
  if (c.email_status === "invalid") out.push("email failed verification (bad syntax or no mail server)");
  if (c.email_status === "unknown") out.push("email not verified yet (run verify_email)");
  if (!c.country) out.push("company country unknown (US or CA decides which law applies)");
  if (c.consent_basis === "unknown") out.push("no consent basis recorded");
  if (c.country === "CA" && !CASL_BASES.includes(c.consent_basis)) out.push("Canadian contact without a CASL basis");
  return out;
}

export async function isSuppressed(email: string): Promise<boolean> {
  const domain = email.split("@")[1];
  const rows = must(await db().from("suppressions").select("id").or(`email.eq."${email}",domain.eq."${domain}"`).limit(1)) as any[];
  return rows.length > 0;
}

/** Syntax, MX record and suppression check; stores the result on each contact. */
export async function verifyEmails(contactIds: string[]) {
  const contacts = must(await db().from("contacts").select("id,company_id,email,do_not_contact,consent_basis,companies(country)").in("id", contactIds)) as any[];
  const mxCache = new Map<string, string[]>();
  const results = [];
  for (const c of contacts) {
    if (!c.email) { results.push({ contact_id: c.id, status: "no_email" }); continue; }
    const email = String(c.email).toLowerCase();
    const syntax = isValidEmailSyntax(email);
    const domain = email.split("@")[1] ?? "";
    let mx: string[] = [];
    if (syntax) {
      if (!mxCache.has(domain)) mxCache.set(domain, await mxHosts(domain));
      mx = mxCache.get(domain)!;
    }
    const role = isRoleAddress(email);
    const suppressed = await isSuppressed(email);
    const status = !syntax || !mx.length ? "invalid" : role ? "risky" : "valid";
    must(await db().from("contacts").update({ email_status: status, email_is_role: role, verified_at: new Date().toISOString() }).eq("id", c.id));
    await logActivity(c.company_id, "email_verified", { contact_id: c.id, status, mx: mx[0] ?? null, suppressed });
    const blockers = sendBlockers({
      email, email_status: status, consent_basis: c.consent_basis, do_not_contact: c.do_not_contact,
      country: c.companies?.country ?? null, suppressed,
    });
    results.push({ contact_id: c.id, email, status, role_address: role, mx: mx[0] ?? null, suppressed, can_send: !blockers.length, blockers });
  }
  return { checked: results.length, results };
}
