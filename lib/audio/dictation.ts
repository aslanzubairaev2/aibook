export const DICTATION_MAX_SECONDS = 60;
export const DICTATION_SAMPLE_RATE = 16000;
export const DICTATION_MAX_BYTES = 44 + DICTATION_SAMPLE_RATE * 2 * DICTATION_MAX_SECONDS;
export const DICTATION_MODEL = "gemini-3.5-transcribe";

/** Canonical mono PCM WAV: bounded and inspectable before any paid API call. */
export function encodeDictationWav(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const tag = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, DICTATION_SAMPLE_RATE, true);
  view.setUint32(28, DICTATION_SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
  });
  return buffer;
}

export function dictationSeconds(buffer: ArrayBuffer): number {
  if (buffer.byteLength < 46 || buffer.byteLength > DICTATION_MAX_BYTES || buffer.byteLength % 2) throw new Error("Запись должна длиться не более 60 секунд.");
  const view = new DataView(buffer);
  const tag = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(buffer, offset, length));
  if (tag(0, 4) !== "RIFF" || tag(8, 4) !== "WAVE" || tag(12, 4) !== "fmt " || tag(36, 4) !== "data"
    || view.getUint32(4, true) !== buffer.byteLength - 8 || view.getUint32(16, true) !== 16
    || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1
    || view.getUint32(24, true) !== DICTATION_SAMPLE_RATE || view.getUint32(28, true) !== DICTATION_SAMPLE_RATE * 2
    || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16
    || view.getUint32(40, true) !== buffer.byteLength - 44) throw new Error("Некорректный формат записи.");
  return (buffer.byteLength - 44) / (DICTATION_SAMPLE_RATE * 2);
}

export function dictationVocabulary(context: string): string[] {
  return [...new Set(context.slice(0, 1200).split(/[^\p{L}\p{N}'’-]+/u).filter(word => word.length > 1))].slice(0, 80);
}

/** This is an estimate for this device's submitted audio, not the provider's bill. */
export function addDictationUsage(seconds: number): number {
  const key = `aibook_dictation_seconds:${new Date().toLocaleDateString("en-CA")}`;
  try {
    const previous = Number(localStorage.getItem(key) || 0);
    const total = (Number.isFinite(previous) && previous > 0 ? previous : 0) + seconds;
    localStorage.setItem(key, String(total));
    return total;
  } catch { return seconds; }
}
