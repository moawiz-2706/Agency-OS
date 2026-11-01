import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme";
import { ServiceWorker } from "@/components/service-worker";
import { BRAND } from "@/components/brand";
import { cn } from "@/lib/utils";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://agencyos.thesentinelsystems.com"),
  title: { default: BRAND, template: `%s · ${BRAND}` },
  description: "The Sentinel Systems team workspace: leads, outreach and replies.",
  robots: { index: false, follow: false },
  applicationName: BRAND,
  appleWebApp: { capable: true, title: "Sentinel", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1120" },
  ],
};

const LEGACY_POLYFILLS = `(function(){function at(n){n=Math.trunc(n)||0;if(n<0)n+=this.length;return n<0||n>=this.length?undefined:this[n];}
[Array,String].forEach(function(C){if(!C.prototype.at)Object.defineProperty(C.prototype,"at",{value:at,writable:true,configurable:true});});
if(!Object.hasOwn)Object.hasOwn=function(o,k){return Object.prototype.hasOwnProperty.call(o,k);};})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("font-sans", sans.variable, mono.variable)} suppressHydrationWarning>
      <head>
        {/* Small fallbacks for older iPhones (iOS 15), before any app code runs. */}
        <script dangerouslySetInnerHTML={{ __html: LEGACY_POLYFILLS }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
