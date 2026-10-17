import type { MetadataRoute } from "next";
import { headers } from "next/headers";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // The demo host is a machine for ephemeral tenants, not content: crawlers
  // get nothing here. (Demo responses also carry X-Robots-Tag: noindex via
  // middleware — this is the second lock on the same door.)
  const host = (await headers()).get("host")?.split(":")[0].toLowerCase() || "";
  if (host === "demo.resultapp.org" || host.endsWith(".demo.resultapp.org")) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /admin/, /staff/ and /student/ are the private portals (they also
      // resolve under [subdomain] segments on the apex); /api/ is machine
      // surface; /superadmin is internal ops. All stay out of the index.
      disallow: ["/admin/", "/staff/", "/student/", "/api/", "/superadmin"],
    },
    sitemap: "https://resultapp.org/sitemap.xml",
  };
}
