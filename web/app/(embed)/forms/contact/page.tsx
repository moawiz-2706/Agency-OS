import type { Metadata } from "next";
import { ContactForm } from "@/components/contact-form";

export const metadata: Metadata = { title: "Contact us", robots: { index: false, follow: false } };

/** The website's contact form, for embedding with an <iframe> (see docs/WEB-FORM.md). */
export default async function ContactFormPage({ searchParams }: { searchParams: Promise<{ button?: string }> }) {
  const { button } = await searchParams;
  return <ContactForm button={button?.slice(0, 40) || "Send"} />;
}
