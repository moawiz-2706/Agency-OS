import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard",
    name: "The Sentinel Systems",
    short_name: "Sentinel",
    description: "Leads, outreach and replies for The Sentinel Systems team.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b1120",
    theme_color: "#1e3a8a",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Leads", url: "/leads" },
      { name: "Inbox", url: "/inbox" },
      { name: "Mailbox", url: "/mailbox" },
    ],
  };
}
