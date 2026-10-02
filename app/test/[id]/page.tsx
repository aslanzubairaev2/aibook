import { AuthProvider } from "@/lib/auth/useAuth";
import { AssessmentScreen } from "@/components/assessment/AssessmentScreen";

export const metadata = { title: "Тест · AIBook" };

// The link a teacher agent hands the learner. Standalone rather than a section
// of the main screen, so it opens straight into the test from a chat message.
export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AuthProvider>
      <AssessmentScreen id={id} />
    </AuthProvider>
  );
}
