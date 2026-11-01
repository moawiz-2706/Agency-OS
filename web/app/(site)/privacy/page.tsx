import type { Metadata } from "next";
import { BRAND, CONTACT_EMAIL } from "@/components/brand";
import { LegalPage } from "../legal";

export const metadata: Metadata = { title: "Privacy policy", alternates: { canonical: "/privacy" } };

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="1 November 2026">
      <p>
        This policy explains how {BRAND} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects and uses information through our website,
        thesentinelsystems.com, our internal workspace, and when we contact businesses about our services.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><b>Business contact information</b> that businesses publish themselves (for example on their own website or business listings): business name, phone number, business email address, website and service area.</li>
        <li><b>Information you send us</b> when you email or call us, such as your name, email address, phone number and the content of your message.</li>
        <li><b>Team account information</b> for our own staff who sign in to our workspace: name, email address and sign-in details.</li>
        <li><b>Basic technical information</b> needed to run the website securely, such as browser type and pages requested, kept in standard server logs.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To offer and provide our services, reply to messages and follow up on business enquiries.</li>
        <li>To send business-to-business emails about services relevant to a company&apos;s role. Every such email says who we are, includes our postal address and lets the recipient opt out by replying.</li>
        <li>To keep our systems secure and working.</li>
      </ul>
      <p>We don&apos;t sell personal information, and we don&apos;t use it for advertising profiles.</p>

      <h2>Opting out</h2>
      <p>
        Reply &ldquo;no&rdquo; or &ldquo;unsubscribe&rdquo; to any email from us, or write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        We add your address to a do-not-contact list and stop all further emails, normally within 2 business days and always within
        10 business days. We keep the minimum needed on that list so we don&apos;t contact you again.
      </p>

      <h2>Google user data</h2>
      <p>
        Our team can connect their own Gmail accounts to our workspace to send emails and to see replies from the businesses we work with.
        For this we request the Gmail &ldquo;send&rdquo; and &ldquo;read-only&rdquo; permissions. We use them only to send emails the user
        writes or approves and to match replies, bounces and opt-outs to the right business record. Only messages to and from those businesses
        are stored; other email in the account is not stored. Access tokens are encrypted, and a user can disconnect at any time in the
        workspace or in their Google account settings.
      </p>
      <p>
        {BRAND}&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>,
        including the Limited Use requirements. We don&apos;t use Google user data for advertising, don&apos;t sell it, and don&apos;t use it
        to train AI models.
      </p>

      <h2>Service providers</h2>
      <p>
        We use trusted providers to run our systems, including hosting (Vercel), database (Supabase), email (Google and GoDaddy) and
        CRM tooling (HighLevel). They process data only on our instructions.
      </p>

      <h2>Retention and security</h2>
      <p>
        We keep business records while they&apos;re useful for our work and delete them on request. Data is encrypted in transit, access is
        limited to our team, and passwords and access tokens are stored encrypted.
      </p>

      <h2>Your choices</h2>
      <p>
        You can ask what information we hold about you or your business, ask us to correct it, or ask us to delete it, by writing to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Residents of Canada and US states with privacy laws may have additional
        rights, which we&apos;ll honour.
      </p>

      <h2>Contact</h2>
      <p>{BRAND} · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
    </LegalPage>
  );
}
