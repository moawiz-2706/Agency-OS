import { db, logActivity, must } from "@agencyos/db";
import type { ConsentBasis } from "./config.js";

export type NewContact = {
  company_id: string;
  full_name?: string;
  role?: string;
  email?: string;
  phone?: string;
  source_url: string;
  email_published_publicly: boolean;
  consent_basis: ConsentBasis;
};

/** Save a contact unless its email or domain is suppressed. */
export async function addContact(c: NewContact) {
  if (c.email) {
    c.email = c.email.toLowerCase();
    const domain = c.email.split("@")[1];
    const sup = must(await db().from("suppressions").select("id").or(`email.eq."${c.email}",domain.eq."${domain}"`).limit(1)) as any[];
    if (sup.length) return { saved: false, reason: "Email or domain is on the suppression list" };
  }
  const row = must(await db().from("contacts").insert(c).select("id").single()) as { id: string };
  await logActivity(c.company_id, "contact_added", { contact_id: row.id, source_url: c.source_url });
  return { saved: true, contact_id: row.id };
}

/** Add an email or domain to the never-contact list and flag matching contacts. */
export async function suppress({ email, domain, reason }: { email?: string; domain?: string; reason: string }) {
  if (!email && !domain) throw new Error("Give an email or a domain");
  email = email?.toLowerCase();
  domain = domain?.toLowerCase().replace(/^www\./, "");
  must(await db().from("suppressions").insert({ email, domain, reason }));
  if (email) must(await db().from("contacts").update({ do_not_contact: true }).eq("email", email));
  return { suppressed: email ?? domain };
}
