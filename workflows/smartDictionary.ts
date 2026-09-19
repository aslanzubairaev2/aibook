import { createHook, sleep } from "workflow";
import {
  markSmartDictionaryJobFailed,
  runSmartDictionaryRound,
  updateSmartDictionaryJob,
} from "@/lib/ai/smartDictionaryJob";

export type SmartDictionaryAnswer = { answer: string };

async function markAnswerReceived(jobId: string) {
  "use step";
  await updateSmartDictionaryJob(jobId, { current_action: "Ответ получен, продолжаю работу…" });
}

function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /429|quota|timeout|timed out|fetch failed|temporar|503|502|504/.test(message);
}

export async function smartDictionaryWorkflow(jobId: string, apiKey: string) {
  "use workflow";

  let clarificationQuestion = "";
  let clarificationAnswer = "";
  for (let iteration = 0; iteration < 40; iteration++) {
    const hookToken = `dictionary-job:${jobId}:${iteration}`;
    const answerHook = createHook<SmartDictionaryAnswer>({ token: hookToken });
    try {
      let result: Awaited<ReturnType<typeof runSmartDictionaryRound>> | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          result = await runSmartDictionaryRound(jobId, apiKey, clarificationQuestion, clarificationAnswer, hookToken);
          break;
        } catch (error) {
          if (!isTransientError(error) || attempt === 2) throw error;
          await sleep(`${2 ** (attempt + 1)}s`);
        }
      }
      if (!result) throw new Error("Фоновый раунд не вернул результат.");
      if (result.status === "completed" || result.status === "failed") return result;
      if (result.status === "waiting_input") {
        const answer = await answerHook;
        clarificationQuestion = result.clarification;
        clarificationAnswer = answer.answer.trim().slice(0, 1200);
        await markAnswerReceived(jobId);
      } else {
        clarificationQuestion = "";
        clarificationAnswer = "";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка фоновой задачи.";
      await markSmartDictionaryJobFailed(jobId, message);
      throw error;
    }

  }

  await markSmartDictionaryJobFailed(jobId, "Задача превысила безопасный лимит раундов. Запустите запрос ещё раз для продолжения.");
  return { status: "failed" as const, error: "Задача превысила безопасный лимит раундов." };
}
