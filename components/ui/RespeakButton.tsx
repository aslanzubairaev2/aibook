"use client";

// Replace the recording for this line.
//
// Audio is cached the instant it is made, which is what turns a bad reading
// into a permanent property of a card rather than a bad moment: it comes back
// identically every time the card does, and pressing play again only replays
// the stored copy. This is the press that discards it and asks the engine
// again — so it belongs beside the card, where the learner is when they hear
// the problem, not somewhere they have to go looking.

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { respeak } from "@/lib/tts";

type Props = {
  text: string;
  lang: string;
  size?: number;
  className?: string;
};

export function RespeakButton({ text, lang, size = 22, className = "card-action-btn" }: Props) {
  const [working, setWorking] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (working || !text.trim()) return;

    setWorking(true);
    try {
      await respeak(text, lang);
    } finally {
      setWorking(false);
    }
  };

  return (
    <button
      className={className}
      type="button"
      aria-label="Переозвучить"
      title="Переозвучить заново — не из кеша"
      disabled={working}
      onClick={handleClick}
    >
      {working ? <Loader2 size={size} className="spin" /> : <RefreshCw size={size} />}
    </button>
  );
}
