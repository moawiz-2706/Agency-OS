import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mail libraries open raw TCP/TLS sockets: load them from node_modules instead of bundling.
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser"],
  // Mailbox attachments ride on the send action (Vercel caps a request at 4.5 MB).
  experimental: { serverActions: { bodySizeLimit: "4.4mb" } },
};

export default nextConfig;
