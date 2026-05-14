export function splitIntoTokens(text: string): string[] {
  return text.split(/([\s]+|[,.!?;:"""„"—–\-])/).filter(Boolean);
}

export function normalizeToken(token: string): string {
  return token.replace(/[^\p{L}\p{N}-]/gu, "").toLowerCase();
}

/** Split paragraph into sentences with their char offsets within the original string. */
export function splitSentencesWithRanges(
  para: string
): Array<{ text: string; start: number; end: number }> {
  const trimOffset = para.search(/\S/);
  if (trimOffset === -1) return [];
  const trimmed = para.slice(trimOffset);

  const result: Array<{ text: string; start: number; end: number }> = [];
  const re = /([.!?…]["»]?)\s+(?=[A-ZÄÖÜА-ЯЁ„"])/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(trimmed)) !== null) {
    const endIdx = m.index + m[1].length;
    // Skip abbreviations: word before period is ≤ 3 chars
    const before = trimmed.slice(0, m.index);
    const lastWord = before.split(/\s+/).pop() ?? "";
    if (lastWord.length <= 3 && m[1] === ".") continue;

    const raw = trimmed.slice(lastIdx, endIdx);
    if (raw.trim()) {
      result.push({ text: raw.trim(), start: trimOffset + lastIdx, end: trimOffset + endIdx });
    }
    lastIdx = endIdx + (m[0].length - m[1].length);
  }

  const tail = trimmed.slice(lastIdx);
  if (tail.trim()) {
    result.push({ text: tail.trim(), start: trimOffset + lastIdx, end: trimOffset + lastIdx + tail.length });
  }

  return result.length > 0 ? result : [{ text: para.trim(), start: trimOffset, end: para.length }];
}

/** Para-level char offsets of the comma/semicolon phrase containing targetCharInPara. */
export function findPhraseOffsets(
  para: string,
  sentStart: number,
  sentEnd: number,
  targetCharInPara: number
): [number, number] {
  const sent = para.slice(sentStart, sentEnd);
  const rel = targetCharInPara - sentStart;

  let phraseStart = 0;
  let phraseEnd = sent.length;
  const re = /[,;]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sent)) !== null) {
    if (m.index < rel) phraseStart = m.index + 1;
    else if (m.index > rel) { phraseEnd = m.index; break; }
  }
  return [sentStart + phraseStart, sentStart + phraseEnd];
}
