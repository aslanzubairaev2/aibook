"use client";

import { splitCardBack } from "@/lib/cards";
import { extractVerbFormsFromDetails, summarizeGermanVerb } from "@/lib/verbForms";
import { CardVerbForms } from "@/components/verbs/VerbPrincipalParts";

/**
 * The back of a card as a learner reads it: the meaning, then a verb's forms
 * as the trainer prints them («книжн. unterschrieb · разг. hat unterschrieben»)
 * instead of the stored «praeteritum: … · trennbar: …» line, then whatever else
 * the back carries. Pure — no lookups — so a list of hundreds of rows stays cheap.
 */
export function CardBackSummary({
  front,
  back,
  renderText,
}: {
  front: string;
  back: string;
  /** Lets a list keep its words tappable; plain text otherwise. */
  renderText?: (text: string, kind: "meaning" | "details") => React.ReactNode;
}) {
  const { meaning, details } = splitCardBack(back);
  const parsed = extractVerbFormsFromDetails(details);
  const summary = summarizeGermanVerb(front, parsed.forms);
  const rest = summary ? parsed.rest : details;
  const show = renderText ?? ((text: string) => text);
  return (
    <div className="card-back-summary">
      {meaning && <div className="card-back-meaning">{show(meaning, "meaning")}</div>}
      {summary && <CardVerbForms summary={summary} />}
      {rest && <div className="card-back-details">{show(rest, "details")}</div>}
    </div>
  );
}
