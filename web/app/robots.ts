import type { MetadataRoute } from "next";

// The staff workspace isn't for search engines.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
