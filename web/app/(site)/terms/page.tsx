import type { Metadata } from "next";
import Link from "next/link";
import { BRAND, CONTACT_EMAIL } from "@/components/brand";
import { LegalPage } from "../legal";

export const metadata: Metadata = { title: "Terms of service", alternates: { canonical: "/terms" } };

export default function Terms() {
  return (
    <LegalPage title="Terms of service" updated="1 November 2026">
      <p>These terms apply to thesentinelsystems.com and to the workspace {BRAND} provides to its own team.</p>

      <h2>The website</h2>
      <p>
        The website describes our services. Information on it is general and may change. Any work we do for a client is covered by a separate
        written agreement or proposal, which takes priority over this page.
      </p>

      <h2>The team workspace</h2>
      <ul>
        <li>The workspace is for {BRAND} team members only. Accounts are approved by the owner, and access can be removed at any time.</li>
        <li>Team members must keep their sign-in details private and use the workspace only for {BRAND} business.</li>
        <li>Team members who connect an email account are responsible for what is sent from it and must follow anti-spam laws, including CAN-SPAM in the US and CASL in Canada: honest sender details and subject lines, our postal address, and honouring opt-outs.</li>
        <li>Don&apos;t try to access other people&apos;s accounts or data, or to disrupt the service.</li>
      </ul>

      <h2>Third-party services</h2>
      <p>
        Our work uses third-party platforms such as GoHighLevel, Google and GoDaddy. Their own terms apply to them, and we aren&apos;t responsible
        for their availability.
      </p>

      <h2>No warranty and limitation of liability</h2>
      <p>
        The website and workspace are provided &ldquo;as is&rdquo;. To the extent the law allows, {BRAND} isn&apos;t liable for indirect or
        consequential losses arising from their use.
      </p>

      <h2>Privacy</h2>
      <p>How we handle information is described in our <Link href="/privacy">privacy policy</Link>.</p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms; the date above shows the latest version. Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
