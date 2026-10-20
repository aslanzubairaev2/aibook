import { AuthProvider } from "@/lib/auth/useAuth";
import { PronounSessionScreen } from "@/components/pronouns/PronounSessionScreen";

export const metadata = { title: "Местоимения · AIBook" };

// The link create_pronoun_practice_session hands back: opens straight into the
// assigned session from a chat message, like a teacher's test does.
export default async function PronounSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AuthProvider>
      <PronounSessionScreen id={id} />
    </AuthProvider>
  );
}
