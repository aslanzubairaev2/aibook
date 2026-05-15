export async function aiChat(prompt: string): Promise<string> {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    throw new Error("AI chat failed");
  }

  const data = await res.json();
  return data.reply;
}
