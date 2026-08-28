// Comma-separated search: "regn, sala, boul" narrows to entries matching any
// one of the three fragments, so a learner hunting for several words at once
// does not have to search, open, close, search again for each of them.

/** Splits a query on commas into lowercase, trimmed fragments — empty ones dropped. */
export function parseSearchTerms(query: string): string[] {
  return query
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True if any term is a substring of any haystack — an entry matches the
 * search as soon as one comma-separated fragment matches one of its fields,
 * however short that fragment is.
 *
 * No terms (nothing typed yet) matches everything, same as an empty search.
 */
export function matchesSearchTerms(haystacks: (string | null | undefined)[], terms: string[]): boolean {
  if (terms.length === 0) return true;
  const texts = haystacks.filter((h): h is string => Boolean(h)).map((h) => h.toLowerCase());
  return terms.some((term) => texts.some((text) => text.includes(term)));
}

/** Adds a dictated fragment as a new comma-separated term rather than replacing what's already typed. */
export function appendSearchTerm(previous: string, spoken: string): string {
  const base = previous.trim();
  const term = spoken.trim();
  if (!term) return previous;
  return base ? `${base}, ${term}` : term;
}
