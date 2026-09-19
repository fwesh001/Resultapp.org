/**
 * Derive the academic session label dynamically (YYYY/YYYY+1).
 * Nigerian school year starts in September: Sep–Dec belongs to the
 * session starting this year, Jan–Aug to the one that started last year.
 * Mirrors backend db_manager.current_academic_session().
 */
export function currentAcademicSession(now: Date = new Date()): string {
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();
  if (month >= 9) return `${year}/${year + 1}`;
  return `${year - 1}/${year}`;
}
export function toTitleCase(value: string | null | undefined): string {
  // Format a raw school name from the database into Title Case.
  // e.g. "victory high school" -> "Victory High School"
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
