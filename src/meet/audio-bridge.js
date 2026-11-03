/** Installed before Meet scripts. Physical microphone/camera are never requested. */
export function installAudioBridge() {
  if (
    location.hostname !== "meet.google.com" &&
    location.hostname !== "localhost"
  )
    return;
  const NativePC = window.RTCPeerConnection;
  const context = new AudioContext({ sampleRate: 48000 });
  const toMeeting = context.createMediaStreamDestination();
  const fromMeeting = context.createMediaStreamDestination();
  const silent = context.createConstantSource();
  const zero = context.createGain();
  zero.gain.value = 0;
  silent.connect(zero);
  zero.connect(toMeeting);
  zero.connect(fromMeeting);
  silent.start();
  const sources = new Map();
  const incomingMeter = context.createAnalyser();
  const outgoingMeter = context.createAnalyser();
  incomingMeter.fftSize = 256;
  outgoingMeter.fftSize = 256;
  const monitorSilence = context.createGain();
  monitorSilence.gain.value = 0;
  incomingMeter.connect(monitorSilence);
  outgoingMeter.connect(monitorSilence);
  monitorSilence.connect(context.destination);
  const outgoingGain = context.createGain();
  outgoingGain.gain.value = 1;
  outgoingGain.connect(toMeeting);
  outgoingGain.connect(outgoingMeter);
  let livePlayback = null;
  const playbacks = new Set();
  let livePeer = null,
    liveSource = null,
    channel = null;
  let started = false,
    closed = false,
    error = null;
  let receivedTracks = 0;
  const micClones = [];
  const pcs = new Set();
  function receive(event) {
    if (event.track.kind !== "audio" || sources.has(event.track.id)) return;
    const stream = new MediaStream([event.track]);
    // Keep the remote media renderer consuming the track even when local playout is muted.
    const playback = new Audio();
    playback.srcObject = stream;
    playback.muted = true;
    playback.play().catch(() => {});
    playbacks.add(playback);
    const source = context.createMediaStreamSource(stream);
    source.connect(fromMeeting);
    source.connect(incomingMeter);
    sources.set(event.track.id, source);
    receivedTracks++;
    event.track.addEventListener("ended", () => {
      source.disconnect();
      playback.pause();
      playback.srcObject = null;
      sources.delete(event.track.id);
    });
  }
  window.RTCPeerConnection = new Proxy(NativePC, {
    construct(target, args) {
      const pc = new target(...args);
      pc.addEventListener("track", receive);
      pcs.add(pc);
      return pc;
    },
  });
  // Return a software microphone and (if requested) a black synthetic camera.
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const paint = canvas.getContext("2d");
  paint.fillStyle = "#101612";
  paint.fillRect(0, 0, 640, 360);
  const camera = canvas.captureStream(1);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    await context.resume();
    const stream = new MediaStream();
    if (constraints?.audio) {
      const track = toMeeting.stream.getAudioTracks()[0].clone();
      micClones.push(track);
      stream.addTrack(track);
    }
    if (constraints?.video) stream.addTrack(camera.getVideoTracks()[0].clone());
    return stream;
  };
  // Meet's remote sound goes to the interviewer graph, not this laptop's speakers.
  const quietPlayback = () => {
    document.querySelectorAll("audio,video").forEach((e) => {
      e.muted = true;
    });
  };
  const observer = new MutationObserver(quietPlayback);
  document.addEventListener("DOMContentLoaded", () =>
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    }),
  );
  const muteTimer = setInterval(quietPlayback, 500);
  function rms(meter) {
    const data = new Float32Array(256);
    meter.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((s, x) => s + x * x, 0) / data.length);
  }
  window.mockPartnerBridge = {
    async offer() {
      if (livePeer) throw new Error("Voice peer already exists");
      await context.resume();
      livePeer = new NativePC();
      livePeer.addTrack(
        fromMeeting.stream.getAudioTracks()[0],
        fromMeeting.stream,
      );
      livePeer.addEventListener("track", (e) => {
        if (e.track.kind === "audio") {
          const stream = new MediaStream([e.track]);
          livePlayback = new Audio();
          livePlayback.srcObject = stream;
          livePlayback.muted = true;
          livePlayback.play().catch(() => {});
          liveSource = context.createMediaStreamSource(stream);
          liveSource.connect(outgoingGain);
        }
      });
      channel = livePeer.createDataChannel("oai-events");
      channel.addEventListener("message", (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === "session.started") started = true;
          if (event.type === "session.closed") closed = true;
          if (event.type === "error")
            error = event.error?.code || "provider_error";
        } catch {
          error = "invalid_event";
        }
      });
      await livePeer.setLocalDescription(await livePeer.createOffer());
      if (livePeer.iceGatheringState !== "complete")
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("ICE timeout")),
            10000,
          );
          livePeer.addEventListener("icegatheringstatechange", () => {
            if (livePeer.iceGatheringState === "complete") {
              clearTimeout(timer);
              resolve();
            }
          });
        });
      return livePeer.localDescription.sdp;
    },
    async answer(sdp) {
      await livePeer.setRemoteDescription({ type: "answer", sdp });
    },
    status() {
      return {
        audioState: context.state,
        receivedTracks,
        activeIncomingTracks: sources.size,
        meetingPeerCount: pcs.size,
        microphoneTracks: micClones.filter((t) => t.readyState === "live")
          .length,
        inputRms: rms(incomingMeter),
        outputRms: rms(outgoingMeter),
        voiceState: livePeer?.connectionState || "idle",
        started,
        closed,
        error,
      };
    },
    async diagnostics() {
      const details = [];
      for (const pc of pcs) {
        const stats = await pc.getStats();
        details.push({
          connection: pc.connectionState,
          senders: pc
            .getSenders()
            .map((s) => ({
              kind: s.track?.kind,
              enabled: s.track?.enabled,
              ready: s.track?.readyState,
            })),
          receivers: pc
            .getReceivers()
            .map((r) => ({
              kind: r.track?.kind,
              enabled: r.track?.enabled,
              muted: r.track?.muted,
              ready: r.track?.readyState,
            })),
          audio: Array.from(stats.values())
            .filter(
              (x) =>
                ["inbound-rtp", "outbound-rtp", "media-source"].includes(
                  x.type,
                ) && x.kind === "audio",
            )
            .map((x) => ({
              type: x.type,
              bytesSent: x.bytesSent,
              bytesReceived: x.bytesReceived,
              audioLevel: x.audioLevel,
              totalAudioEnergy: x.totalAudioEnergy,
            })),
        });
      }
      return details;
    },
    async tone(seconds = 0.4) {
      await context.resume();
      const oscillator = context.createOscillator(),
        gain = context.createGain();
      gain.gain.value = 0.06;
      oscillator.frequency.value = 440;
      oscillator.connect(gain);
      gain.connect(outgoingGain);
      oscillator.start();
      oscillator.stop(context.currentTime + seconds);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    },
    close() {
      outgoingGain.gain.value = 0;
      liveSource?.disconnect();
      if (livePlayback) {
        livePlayback.pause();
        livePlayback.srcObject = null;
      }
      if (channel?.readyState === "open")
        channel.send(JSON.stringify({ type: "session.close" }));
    },
    dispose() {
      this.close();
      livePeer?.close();
      for (const pc of pcs) pc.close();
      for (const source of sources.values()) source.disconnect();
      for (const el of playbacks) {
        el.pause();
        el.srcObject = null;
      }
      micClones.forEach((t) => t.stop());
      silent.stop();
      camera.getTracks().forEach((t) => t.stop());
      observer.disconnect();
      clearInterval(muteTimer);
      context.close();
    },
  };
}
