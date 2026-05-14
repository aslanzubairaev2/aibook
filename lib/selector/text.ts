export function splitIntoTokens(sentence: string): string[] {
  return sentence.split(/([\s]+|[,.!?;:"""„"—–\-])/).filter(Boolean);
}

export function normalizeToken(token: string): string {
  return token.replace(/[^\p{L}\p{N}-]/gu, "").toLowerCase();
}

export function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function findSentence(sentences: string[], charIndex: number): number {
  let pos = 0;
  for (let i = 0; i < sentences.length; i++) {
    pos += sentences[i].length + 1;
    if (charIndex < pos) return i;
  }
  return sentences.length - 1;
}
