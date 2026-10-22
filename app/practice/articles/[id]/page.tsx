import { AuthProvider } from "@/lib/auth/useAuth";
import { GrammarSessionScreen } from "@/components/grammar/GrammarSessionScreen";

export const metadata = { title: "Артикли и падежи · AIBook" };

// The link create_grammar_trainer_session hands back: opens straight into the assigned session.
export default async function ArticleSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AuthProvider>
      <GrammarSessionScreen trainer="articles_cases" id={id} />
    </AuthProvider>
  );
}
