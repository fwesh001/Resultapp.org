/**
 * Single source of truth for the shape of every legal document rendered by
 * components/legal/LegalDocument.tsx.
 *
 * Document *content* lives in sibling modules (privacy.ts, terms.ts, refund.ts)
 * so copy changes never require touching a component. Kept in a plain
 * (non-client) module so both server and client components can import it.
 */

/** A renderable fragment inside a section body. */
export type LegalBlock =
  /** Sub-heading inside a section, rendered as an <h3>. Supports `**bold**`. */
  | { kind: "h3"; text: string }
  /** Paragraph. Supports inline `**bold**` emphasis. */
  | { kind: "p"; text: string }
  /** Unordered bullet list. Items support `**bold**`. */
  | { kind: "ul"; items: string[] }
  /** Ordered / numbered list. Items support `**bold**`. */
  | { kind: "ol"; items: string[] }
  /** Highlighted callout used for warnings and cross-references. */
  | { kind: "note"; text: string }
  /** Data table. First row is the header. Cells support `**bold**`. */
  | { kind: "table"; head: string[]; rows: string[][] };

export interface LegalSection {
  /** URL fragment used for the table of contents, e.g. "cookies" -> #cookies */
  id: string;
  /** Rendered as an <h2>. Keep it short enough for a nav rail. */
  heading: string;
  blocks: LegalBlock[];
}

export interface LegalDocumentData {
  /** Used for the route and as the `key` prop when cross-linking. */
  slug: string;
  /** Page title, also the PageHero heading (this becomes the <h1>). */
  title: string;
  /** Optional hero sub-line. */
  subtitle: string;
  /** Semantic version of this document's text. */
  version: string;
  /** Human-readable date this version takes effect. */
  effectiveDate: string;
  /** Meta description for page metadata. */
  description: string;
  /** Plain-English summary bullets rendered in the "In short" panel. */
  summary: string[];
  sections: LegalSection[];
}
