import { key } from "./provider.js";
export const CAPTION_RATE = 0.0045; // USD/audio minute: GPT-Transcribe, verified 2026-11-01.
export const CAPTION_CAP = 0.2;
export function validateCaption(input, elapsedMs, failed = false) {
  if (
    !/^[a-f0-9-]{36}$/.test(input.chunkId || "") ||
    !/^[a-f0-9-]{36}$/.test(input.speakerId || "") ||
    typeof input.speakerName !== "string" ||
    !input.speakerName.trim() ||
    input.speakerName.length > 60
  )
    throw Error("Invalid microphone identity");
  if (
    !Number.isFinite(input.start_ms) ||
    !Number.isFinite(input.end_ms) ||
    input.start_ms < 0 ||
    input.end_ms <= input.start_ms ||
    input.end_ms - input.start_ms > 8100 ||
    input.end_ms > Math.min(612000, elapsedMs + 3000)
  )
    throw Error("Invalid caption timing");
  if (failed) return { pcm: null, cost: 0 };
  if (
    typeof input.pcm !== "string" ||
    input.pcm.length > 344000 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.pcm)
  )
    throw Error("Invalid caption audio");
  const pcm = Buffer.from(input.pcm, "base64");
  const seconds = pcm.length / 32000;
  if (
    pcm.length % 2 ||
    seconds < 0.1 ||
    seconds > 8.1 ||
    Math.abs(seconds * 1000 - (input.end_ms - input.start_ms)) > 250
  )
    throw Error("Invalid caption duration");
  return { pcm, cost: (Math.ceil(seconds) * CAPTION_RATE) / 60 };
}
export function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
export async function transcribeMicrophone(pcm) {
  const form = new FormData();
  form.set("model", "gpt-transcribe");
  form.set("file", new Blob([wav(pcm)], { type: "audio/wav" }), "speech.wav");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}` },
    body: form,
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Error(`Microphone transcription failed (${r.status})`);
  const result = await r.json();
  if (typeof result.text !== "string" || result.text.length > 12000)
    throw Error("Invalid transcription result");
  return result.text.trim();
}
