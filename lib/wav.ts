// The player decodes raw 16-bit PCM and needs to be told the sample rate that
// PCM was recorded at. Deepgram and Gemini both hand back headerless 24 kHz, so
// the rate could stay a constant — but Speechify picks its own rate per model,
// and guessing wrong plays every card back chipmunked or sludged.
//
// Asking Speechify for WAV and reading the header is the way to *know* the rate
// instead of assuming it. The payload after the header is the same raw PCM the
// player already handles.

export type Wav = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** The `data` chunk alone — no header, ready for the existing player. */
  pcm: Uint8Array;
};

/**
 * Read a RIFF/WAVE buffer into its PCM payload and format.
 *
 * Throws on anything that is not 16-bit PCM WAVE, because silently mis-reading
 * a header produces audio that plays at the wrong speed rather than an error
 * anyone would notice in a log.
 */
export function parseWav(buffer: ArrayBuffer): Wav {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12) throw new Error("WAV too short to hold a header");
  if (readTag(view, 0) !== "RIFF" || readTag(view, 8) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE buffer");
  }

  let fmt: { channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let pcm: Uint8Array | null = null;

  // Chunks run back to back after the 12-byte RIFF header, and a file may carry
  // LIST/fact/anything before `data` — so walk rather than assume offset 44.
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = readTag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === "fmt " && size >= 16) {
      fmt = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      // A streamed WAV can declare size 0 or 0xFFFFFFFF; trust the buffer then.
      const available = buffer.byteLength - body;
      const length = size === 0 || size > available ? available : size;
      pcm = new Uint8Array(buffer, body, length);
    }

    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }

  if (!fmt) throw new Error("WAV has no fmt chunk");
  if (!pcm) throw new Error("WAV has no data chunk");
  if (fmt.bitsPerSample !== 16) throw new Error(`Expected 16-bit PCM, got ${fmt.bitsPerSample}-bit`);
  if (!Number.isFinite(fmt.sampleRate) || fmt.sampleRate <= 0) throw new Error("WAV declares no sample rate");

  return { ...fmt, pcm: fmt.channels > 1 ? takeFirstChannel(pcm, fmt.channels) : pcm };
}

/** The player is mono; interleaved extra channels would play as noise at double speed. */
function takeFirstChannel(pcm: Uint8Array, channels: number): Uint8Array {
  const frameBytes = 2 * channels;
  const frames = Math.floor(pcm.byteLength / frameBytes);
  const out = new Uint8Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    out[i * 2] = pcm[i * frameBytes];
    out[i * 2 + 1] = pcm[i * frameBytes + 1];
  }
  return out;
}

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}
