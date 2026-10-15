import { redirect } from "next/navigation";
import { readAdminIdentity } from "@/lib/adminAuth";

/**
 * Page-level capability guard for the admin portal.
 *
 * WHY THIS IS A HELPER EACH PAGE CALLS, NOT A LAYOUT CONFIG
 * -------------------------------------------------------
 * Next 16 does NOT expose a child page's exports to its parent layout, so a
 * layout cannot discover which page it is wrapping. Attempting it this way was
 * verified live and failed: `(children as {requiredCapability}).requiredCapability`
 * is `undefined` for every page. Without a probe that failure would have
 * shipped silently — every moderator with full admin access, every test green.
 *
 * So the check lives where the route is actually known: inside each page, one
 * line at the top.
 *
 *   export async function ...AdminSettingsPage({ params }) {
 *     const guard = await enforceAdminCapability(params, "settings");
 *     if (guard) return guard;   // unreachable — enforceAdminCapability throws
 *     ...
 *   }
 *
 * It redirects rather than returning a response because these are Server
 * Components, which cannot return raw Response objects.
 *
 * Returns the redirect target for callers that want to log it, and throws
 * nothing. Missing session -> the portal's login; missing capability -> that
 * portal's dashboard, carrying `?denied=` so the page can explain itself.
 */
export async function enforceAdminCapability(
  params: { subdomain: string } | Promise<{ subdomain: string }>,
  capability: string,
  /**
   * Which portal the caller lives in.
   *
   * Both redirect targets used to be hardcoded to `/admin/...`, which was
   * invisible while only the admin portal used this helper. Once a moderator
   * portal exists it matters twice over: a signed-out moderator was sent to
   * the ADMIN login — the very page that asks for "Admin ID or Email" — and a
   * denied moderator was dumped onto the admin dashboard. Both read as "the
   * moderator feature is broken".
   *
   * The capability check itself is identical either way. This only decides
   * WHERE a rejection lands.
   */
  portal: "admin" | "moderator" = "admin",
): Promise<string | null> {
  const { subdomain: raw } = await params;
  const subdomain = (raw || "").toLowerCase().trim();

  const identity = await readAdminIdentity(subdomain);
  if (!identity) {
    redirect(`/${subdomain}/${portal}/login`);
  }

  if (identity.role !== "admin" && !identity.capabilities.includes(capability)) {
    redirect(`/${subdomain}/${portal}?denied=${encodeURIComponent(capability)}`);
  }

  return null;
}