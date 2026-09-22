/** Extract a printed page number from model-provided source metadata. */
export function extractPageLabel(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const match = value?.match(/(?:seite|s\.|с\.|стр\.?|страниц(?:а|е)?|page)\s*[:.]?\s*(\d+(?:\s*[-–]\s*\d+)?)/iu);
    if (match?.[1]) return match[1].replace(/\s+/g, "");
  }
  return "";
}

export function withPageDescription(description: string, pageLabel: string): string {
  const trimmed = description.trim();
  if (!pageLabel || new RegExp(`(?:страниц|seite|page|с\\.|стр\\.?)\\s*${pageLabel.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`, "iu").test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}${trimmed ? " · " : ""}страница ${pageLabel}`;
}
