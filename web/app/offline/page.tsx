import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { BrandMark } from "@/components/brand";

export const metadata: Metadata = { title: "Offline" };

/** Shown by the service worker when a page can't load because there's no connection. */
export default function Offline() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <BrandMark className="size-12" />
      <WifiOff className="size-6 text-muted-foreground" />
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The Sentinel Systems needs a connection to load your leads and email. Check your internet, then try again.</p>
      <a href="/dashboard" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Try again</a>
    </main>
  );
}
