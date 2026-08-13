import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWav } from "./wav.ts";

/** Build a WAVE buffer, optionally with an extra chunk before `data`. */
function makeWav(opts: {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  samples?: number[];
  extraChunk?: { id: string; body: number[] };
  dataSizeOverride?: number;
}): ArrayBuffer {
  const sampleRate = opts.sampleRate ?? 24000;
  const channels = opts.channels ?? 1;
  const bits = opts.bitsPerSample ?? 16;
  const samples = opts.samples ?? [0, 1, -1, 32767];

  const extra = opts.extraChunk;
  const extraSize = extra ? 8 + extra.body.length + (extra.body.length % 2) : 0;
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(12 + 24 + extraSize + 8 + dataBytes);
  const view = new DataView(buffer);

  writeTag(view, 0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  writeTag(view, 8, "WAVE");

  writeTag(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bits / 8, true);
  view.setUint16(32, channels * bits / 8, true);
  view.setUint16(34, bits, true);

  let offset = 36;
  if (extra) {
    writeTag(view, offset, extra.id);
    view.setUint32(offset + 4, extra.body.length, true);
    extra.body.forEach((b, i) => view.setUint8(offset + 8 + i, b));
    offset += 8 + extra.body.length + (extra.body.length % 2);
  }

  writeTag(view, offset, "data");
  view.setUint32(offset + 4, opts.dataSizeOverride ?? dataBytes, true);
  samples.forEach((s, i) => view.setInt16(offset + 8 + i * 2, s, true));

  return buffer;
}

function writeTag(view: DataView, offset: number, tag: string) {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, tag.charCodeAt(i));
}

test("reads the declared sample rate rather than assuming 24 kHz", () => {
  assert.equal(parseWav(makeWav({ sampleRate: 22050 })).sampleRate, 22050);
  assert.equal(parseWav(makeWav({ sampleRate: 44100 })).sampleRate, 44100);
});

test("returns the data chunk without the header", () => {
  const wav = parseWav(makeWav({ samples: [0, 1, -1, 32767] }));
  assert.equal(wav.pcm.byteLength, 8);
  const view = new DataView(wav.pcm.buffer, wav.pcm.byteOffset, wav.pcm.byteLength);
  assert.equal(view.getInt16(6, true), 32767);
});

test("walks past a LIST chunk instead of assuming data starts at byte 44", () => {
  const wav = parseWav(makeWav({
    extraChunk: { id: "LIST", body: [1, 2, 3, 4, 5, 6] },
    samples: [7, 8],
  }));
  assert.equal(wav.pcm.byteLength, 4);
  const view = new DataView(wav.pcm.buffer, wav.pcm.byteOffset, wav.pcm.byteLength);
  assert.equal(view.getInt16(0, true), 7);
  assert.equal(view.getInt16(2, true), 8);
});

test("handles an odd-sized chunk's pad byte", () => {
  const wav = parseWav(makeWav({
    extraChunk: { id: "fact", body: [9, 9, 9] },
    samples: [5, 6],
  }));
  const view = new DataView(wav.pcm.buffer, wav.pcm.byteOffset, wav.pcm.byteLength);
  assert.equal(view.getInt16(0, true), 5);
});

test("falls back to the real buffer length when data declares a streaming size", () => {
  const wav = parseWav(makeWav({ samples: [1, 2, 3], dataSizeOverride: 0xffffffff }));
  assert.equal(wav.pcm.byteLength, 6);
});

test("keeps only the first channel of interleaved stereo", () => {
  // Left samples 100/300, right samples 200/400.
  const wav = parseWav(makeWav({ channels: 2, samples: [100, 200, 300, 400] }));
  assert.equal(wav.pcm.byteLength, 4);
  const view = new DataView(wav.pcm.buffer, wav.pcm.byteOffset, wav.pcm.byteLength);
  assert.equal(view.getInt16(0, true), 100);
  assert.equal(view.getInt16(2, true), 300);
});

test("refuses formats the player cannot decode", () => {
  assert.throws(() => parseWav(makeWav({ bitsPerSample: 24 })), /16-bit/);
  assert.throws(() => parseWav(new ArrayBuffer(4)), /too short/);
  assert.throws(() => parseWav(new ArrayBuffer(64)), /RIFF/);
});
