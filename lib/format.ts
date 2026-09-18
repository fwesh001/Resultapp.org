/**
 * Format a raw school name from the database into Title Case.
 * e.g. "victory high school" -> "Victory High School"
 */
export function toTitleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .map((part) =>
          part.length > 0
            ? part.charAt(0).toUpperCase() + part.slice(1)
            : part,
        )
        .join("-"),
    )
    .join(" ");
}
