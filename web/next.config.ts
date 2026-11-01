import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mail libraries open raw TCP/TLS sockets: load them from node_modules instead of bundling.
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser"],
};

export default nextConfig;
