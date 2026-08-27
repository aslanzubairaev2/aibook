"use client";

import { splitIntoTokens, normalizeToken } from "@/lib/selector/text";

type Props = {
  text: string;
  onWordTap: (word: string, contextSentence: string) => void;
};

/**
 * Renders text with every word tappable — same tokenizer the reader and the
 * discuss chat use, so a German word inside an exercise opens the exact same
 * "Слово" modal a word tapped anywhere else in the app would.
 */
export function TappableText({ text, onWordTap }: Props) {
  return (
    <>
      {splitIntoTokens(text).map((token, i) => {
        if (!normalizeToken(token)) return <span key={i}>{token}</span>;
        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            className="hw-tappable-word"
            onClick={() => onWordTap(token, text)}
            onKeyDown={(e) => { if (e.key === "Enter") onWordTap(token, text); }}
          >
            {token}
          </span>
        );
      })}
    </>
  );
}
