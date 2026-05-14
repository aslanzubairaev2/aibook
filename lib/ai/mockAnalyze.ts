import { mockAnalysis } from "@/lib/mockData";

export async function analyzeSelection() {
  await new Promise((resolve) => setTimeout(resolve, 450));
  return mockAnalysis;
}
