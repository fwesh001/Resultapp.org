/**
 * Every identifier the legal pages need, in one place.
 *
 * Changing the trading name, the support address, the regulator, or the
 * effective date here updates the Privacy Policy, the Terms of Service, the
 * Refund Policy, the registration consent notice, and the sitemap at once.
 * There are no magic strings in the document bodies.
 */

/** Legal operating name of the data controller / service provider. */
export const CONTROLLER_NAME = "Zabdiel Tech";

/** Consumer-facing trading name of the service. */
export const TRADING_NAME = "ResultApp.org";

/** Registered operating location. */
export const CONTROLLER_LOCATION = "Abuja / Nasarawa, Nigeria";

/** Primary support channel for all three documents. */
export const SUPPORT_EMAIL = "support@resultapp.org";

/** Human-readable support number, matching the contact page. */
export const SUPPORT_PHONE_DISPLAY = "07025067494";

/** International dialling form for tel: links. */
export const SUPPORT_PHONE_TEL = "+2347025067494";

/** Support window. Referenced by the response clocks in Terms and Refund. */
export const SUPPORT_HOURS = "8am–8pm WAT, Monday to Friday";

/** Governing law for the Terms of Service. */
export const GOVERNING_LAW = "the Federal Republic of Nigeria";

/** Exclusive forum for the Terms of Service. */
export const JURISDICTION = "the Federal High Court of Nigeria sitting in Abuja, Federal Capital Territory";

/** Supervisory authority under the NDPA 2023 / NDPR 2023. */
export const REGULATOR_NAME = "Nigeria Data Protection Commission";

export const REGULATOR_SHORT = "NDPC";

export const REGULATOR_URL = "https://www.ndpc.gov.ng";

/** Date the current version of all three documents takes effect. */
export const EFFECTIVE_DATE = "1 October 2026";

/**
 * Per-document version tokens. Bump independently so a Refund Policy edit
 * does not invalidate an accepted Terms version.
 */
export const PRIVACY_VERSION = "1.0";

export const TERMS_VERSION = "1.0";

export const REFUND_VERSION = "1.0";

/** Canonical routes for the legal pages, shared by the footers and the sitemap. */
export const LEGAL_ROUTES = {
  privacy: "/privacy",
  terms: "/terms",
  refund: "/refund-policy",
} as const;

export type LegalRouteKey = keyof typeof LEGAL_ROUTES;
