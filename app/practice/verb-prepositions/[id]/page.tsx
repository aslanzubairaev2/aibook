import { AuthProvider } from "@/lib/auth/useAuth";
import { GrammarSessionScreen } from "@/components/grammar/GrammarSessionScreen";

export const metadata = { title: "Глаголы и предлоги · AIBook" };

// The link create_grammar_trainer_session hands back: opens straight into the assigned session.
export default async function VerbPrepositionSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AuthProvider>
      <GrammarSessionScreen trainer="verb_prepositions" id={id} />
    </AuthProvider>
  );
}
