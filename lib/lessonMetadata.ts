/** Extract a printed page number from model-provided source metadata. */
export function extractPageLabel(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const match = value?.match(/(?:seite|s\.|с\.|стр\.?|страниц(?:а|е)?|page)\s*[:.]?\s*(\d+(?:\s*[-–]\s*\d+)?)/iu);
    if (match?.[1]) return match[1].replace(/\s+/g, "");
  }
  return "";
}

/**
 * Keeps the page metadata readable and searchable when it comes from a bare
 * number in the capture form. Labels that already carry their own context —
 * "Seite 68", "Lektion 4" — are left intact.
 */
export function normalizePageLabel(value: string | null | undefined): string {
  const clean = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) return "";
  if (/^\d{1,4}(?:\s*[-–]\s*\d{1,4})?$/.test(clean)) return `страница ${clean}`;
  return clean;
}

/** A page, lesson, unit or chapter reference is enough to identify a source. */
export function hasPageReference(value: string | null | undefined): boolean {
  const clean = String(value ?? "").trim();
  return Boolean(
    extractPageLabel(clean)
    || /^\d{1,4}(?:\s*[-–]\s*\d{1,4})?$/.test(clean)
    || /(?:lektion|lesson|unit|урок|глава|chapter)\s*\d+/iu.test(clean),
  );
}

export function withPageDescription(description: string, pageLabel: string): string {
  const trimmed = description.trim();
  if (!pageLabel || new RegExp(`(?:страниц|seite|page|с\\.|стр\\.?)\\s*${pageLabel.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`, "iu").test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}${trimmed ? " · " : ""}страница ${pageLabel}`;
}
