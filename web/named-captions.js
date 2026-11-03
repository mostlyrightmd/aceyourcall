export async function createNamedCaptions({ ctx, elapsedMs, send, onError }) {
  const offset = elapsedMs - ctx.currentTime * 1000;
  await ctx.audioWorklet.addModule("/caption-worklet.js");
  const tracks = new Map();
  let stopped = false,
    warned = false;
  const warn = () => {
    if (!warned) {
      warned = true;
      onError(
        "Some microphone captions are unavailable. Unattributed transcript text will be kept.",
      );
    }
  };
  function queue(c) {
    if (!c.frames.length) return;
    const frames = c.frames;
    c.frames = [];
    c.silent = 0;
    const length = frames.reduce((n, f) => n + f.pcm.length, 0);
    if (length < 1600) return;
    const samples = new Int16Array(length);
    let i = 0;
    for (const f of frames) {
      samples.set(f.pcm, i);
      i += f.pcm.length;
    }
    // Little-endian PCM, including on platforms whose typed-array byte order differs.
    const bytes = new Uint8Array(length * 2),
      view = new DataView(bytes.buffer);
    for (let j = 0; j < length; j++) view.setInt16(j * 2, samples[j], true);
    let binary = "";
    for (let j = 0; j < bytes.length; j += 8192)
      binary += String.fromCharCode(...bytes.subarray(j, j + 8192));
    const end = Math.max(0, frames.at(-1).endMs + offset),
      start = Math.max(0, end - length / 16);
    const packet = {
      chunkId: crypto.randomUUID(),
      speakerId: c.id,
      start_ms: start,
      end_ms: end,
      pcm: btoa(binary),
    };
    if (c.queue.length >= 2) {
      fail(packet);
      return;
    }
    c.queue.push(packet);
    pump(c);
  }
  function fail(packet) {
    warn();
    send({ ...packet, pcm: undefined, failed: true }).catch(() => {});
  }
  async function pump(c) {
    if (c.running) return;
    c.running = true;
    while (c.queue.length) {
      const packet = c.queue.shift();
      try {
        await send(packet);
      } catch {
        fail(packet);
      }
    }
    c.running = false;
  }
  function add(track, source, participant) {
    if (
      stopped ||
      tracks.has(track) ||
      !participant?.identity ||
      participant.identity === "interviewer"
    )
      return;
    const node = new AudioWorkletNode(ctx, "caption-pcm", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      }),
      sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);
    const c = {
      node,
      sink,
      source,
      id: participant.identity,
      frames: [],
      pre: [],
      silent: 0,
      queue: [],
      running: false,
    };
    tracks.set(track, c);
    node.port.onmessage = ({ data }) => {
      if (stopped) return;
      if (track.isMuted || !track.mediaStreamTrack?.enabled) {
        queue(c);
        c.pre = [];
        return;
      }
      const f = { pcm: new Int16Array(data.pcm), endMs: data.endMs };
      const speech = data.rms > 0.008;
      if (!c.frames.length) {
        c.pre.push(f);
        if (c.pre.length > 3) c.pre.shift();
        if (speech) {
          c.frames = c.pre;
          c.pre = [];
        }
      } else {
        c.frames.push(f);
        c.silent = speech ? 0 : c.silent + 1;
      }
      if (c.frames.length >= 80 || c.silent >= 7) queue(c);
    };
  }
  function remove(track) {
    const c = tracks.get(track);
    if (!c) return;
    queue(c);
    c.node.port.onmessage = null;
    c.source.disconnect(c.node);
    c.node.disconnect();
    c.sink.disconnect();
    tracks.delete(track);
    retired.add(c);
  }
  const retired = new Set();
  async function stop() {
    if (stopped) return;
    stopped = true;
    for (const track of [...tracks.keys()]) remove(track);
    const end = performance.now() + 12000;
    while (
      [...retired].some((c) => c.running || c.queue.length) &&
      performance.now() < end
    )
      await new Promise((r) => setTimeout(r, 50));
    for (const c of retired)
      if (c.queue.length) {
        for (const packet of c.queue) fail(packet);
        c.queue = [];
      }
  }
  return { add, remove, stop };
}
