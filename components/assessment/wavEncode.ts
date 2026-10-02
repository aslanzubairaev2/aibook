// Turn whatever the browser recorded (webm/opus in Chrome and Android,
// mp4/aac in Safari and iOS) into the one format Azure's short-audio endpoint
// reads everywhere: 16 kHz, mono, 16-bit PCM WAV. Decoding in the browser
// means the server never has to guess at containers or codecs.

const TARGET_RATE = 16000;

type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };

export async function blobToWav16k(blob: Blob): Promise<{ wav: Blob; durationMs: number }> {
  const Ctx = window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext;
  if (!Ctx) throw new Error("Этот браузер не умеет обрабатывать звук.");
  const context = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void context.close();
  }
  const length = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  // One output channel: the offline context mixes stereo down on its own.
  const offline = new OfflineAudioContext(1, length, TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const tag = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  tag(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return { wav: new Blob([buffer], { type: "audio/wav" }), durationMs: Math.round(decoded.duration * 1000) };
}
