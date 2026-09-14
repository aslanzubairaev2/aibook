/** Only retry an absent optional column, never permissions or other SQL errors. */
export function isMissingContentType(error: { code?: string; message: string } | null): boolean {
  return Boolean(error && ["42703", "PGRST204"].includes(error.code ?? "")
    && /\bcontent_type\b/.test(error.message));
}

export const CONTENT_TYPE_MIGRATION_ERROR =
  "Для сохранения фраз и выражений нужно обновить базу словаря. Обратитесь к владельцу приложения; снимок можно повторить после обновления.";

/** Legacy dictionaries contain words only. The callback must retain owner filters. */
export async function readDictionaryWithFallback<T extends { data: unknown; error: { code?: string; message: string } | null }>(
  run: (hasContentType: boolean) => PromiseLike<T>,
): Promise<T> {
  const result = await run(true);
  return isMissingContentType(result.error) ? await run(false) : result;
}
