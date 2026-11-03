import { track } from "./analytics";
import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type Participant,
} from "livekit-client";
import { createNamedCaptions } from "../web/named-captions.js";
import { request } from "./api";
import {
  permissions,
  type Grant,
  type RoomState,
  type Draft,
  type Scorecard,
} from "./types";
export interface EngineState {
  connected: boolean;
  connecting: boolean;
  connection: string;
  participants: Participant[];
  data?: RoomState;
  profile: string;
  busy: boolean;
  queue?: number;
  queueWaiting: boolean;
  notice: string;
  error: boolean;
  audioBlocked: boolean;
  scorePending: boolean;
  scoreError: string;
  seconds: number;
  revision: number;
}
export function createEngine(grant: Grant) {
  let snapshot: EngineState = {
    connected: false,
    connecting: false,
    connection: "Disconnected",
    participants: [],
    profile: grant.program,
    busy: false,
    queueWaiting: false,
    notice: "",
    error: false,
    audioBlocked: false,
    scorePending: false,
    scoreError: "",
    seconds: 600,
    revision: 0,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<EngineState>) => {
    snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
    listeners.forEach((fn) => fn());
  };
  const note = (notice: string, error = false) => update({ notice, error });
  const api = <T>(action: string, data?: unknown, timeout = 15000) =>
    request<T>(`/rooms/${grant.id}/${action}`, data, grant.key, timeout);
  let room: Room | undefined,
    aiRoom: Room | undefined,
    ctx: AudioContext | undefined,
    mix: MediaStreamAudioDestinationNode | undefined,
    pc: RTCPeerConnection | undefined,
    dc: RTCDataChannel | undefined,
    decoder: HTMLAudioElement | undefined,
    sessionId: string | undefined;
  let pulse: ReturnType<typeof setInterval> | undefined,
    poll: ReturnType<typeof setInterval> | undefined,
    clock: ReturnType<typeof setInterval> | undefined;
  let captions: Awaited<ReturnType<typeof createNamedCaptions>> | undefined;
  let captionRefreshPending = false;
  const sources = new Map<Track, MediaStreamAudioSourceNode>();
  let queueCancelled = false,
    disposed = false,
    refreshing = false,
    notified = "",
    cleanup: Promise<void> | undefined;
  function sync() {
    if (room)
      update({
        participants: [
          room.localParticipant,
          ...room.remoteParticipants.values(),
        ],
      });
  }
  function mixTrack(track: Track, p: Participant) {
    if (
      !ctx ||
      !mix ||
      sources.has(track) ||
      track.kind !== "audio" ||
      p.identity === "interviewer"
    )
      return;
    const source = ctx.createMediaStreamSource(
      new MediaStream([track.mediaStreamTrack]),
    );
    source.connect(mix);
    sources.set(track, source);
    captions?.add(track, source, p);
  }
  function allAudio() {
    if (!room) return;
    for (const p of [
      room.localParticipant,
      ...room.remoteParticipants.values(),
    ])
      for (const pub of p.audioTrackPublications.values())
        if (pub.track && p.identity !== "interviewer") {
          mixTrack(pub.track, p);
          captions?.add(pub.track, sources.get(pub.track), p);
        }
  }
  function removeTrack(track: Track) {
    captions?.remove(track);
    sources.get(track)?.disconnect();
    sources.delete(track);
    sync();
  }
  let stopping = false;
  const failures = new Map<string, ReturnType<typeof setTimeout>>();
  function mediaFailure(reason: string, failed: boolean) {
    if (!failed) {
      clearTimeout(failures.get(reason));
      failures.delete(reason);
      return;
    }
    if (stopping || disposed || failures.has(reason)) return;
    failures.set(
      reason,
      setTimeout(() => {
        failures.delete(reason);
        if (stopping || !sessionId || disposed) return;
        note(
          "Interviewer audio disconnected. Ending the interview and preparing your scorecard.",
          true,
        );
        void end(reason).catch(() =>
          note("Interview connection lost. Checking the final result…", true),
        );
      }, 8000),
    );
  }
  async function cleanupAI() {
    if (cleanup) return cleanup;
    stopping = true;
    for (const timeout of failures.values()) clearTimeout(timeout);
    failures.clear();
    cleanup = (async () => {
      const done = captions?.stop();
      captions = undefined;
      clearInterval(pulse);
      pc?.close();
      pc = undefined;
      dc = undefined;
      decoder?.pause();
      if (decoder) decoder.srcObject = null;
      decoder = undefined;
      await aiRoom?.disconnect();
      aiRoom = undefined;
      for (const source of sources.values()) source.disconnect();
      sources.clear();
      await done;
      await ctx?.close();
      ctx = undefined;
      sessionId = undefined;
    })();
    try {
      await cleanup;
    } finally {
      cleanup = undefined;
    }
  }
  async function end(reason = "manual") {
    stopping = true;
    const id = sessionId;
    sessionId = undefined;
    try {
      if (id) await api(`sessions/${id}/end`, { reason });
    } finally {
      await cleanupAI();
    }
  }
  async function refresh() {
    if (refreshing || disposed) return;
    if (!poll) poll = setInterval(() => void refresh().catch(() => {}), 3000);
    refreshing = true;
    try {
      const data = await api<RoomState>("state");
      update({ data });
      const current = data.sessions[0];
      if (
        current?.started &&
        ["live", "connecting", "closing"].includes(current.status)
      )
        update({
          seconds: Math.max(
            0,
            600 - Math.floor((Date.now() - current.started) / 1000),
          ),
        });
      if (
        current &&
        notified !== current.id &&
        ["complete", "unconfirmed"].includes(current.status)
      ) {
        notified = current.id;
        if (current.id === sessionId) await cleanupAI();
        note(
          current.interrupted
            ? "The interviewer disconnected. Your room is still open. Please start a new interview."
            : current.status === "unconfirmed"
              ? "Interview ended. Preparing your feedback…"
              : current.stopReason === "agenda_derailment"
                ? "The interviewer left after continued off-topic requests."
                : current.stopReason === "agenda_unavailable"
                  ? "Interview ended because agenda supervision became unavailable. Please try again."
                  : "Interview finished.",
          !!current.interrupted,
        );
      }
    } finally {
      refreshing = false;
    }
  }
  async function join(name: string, mic: boolean, camera: boolean) {
    if (snapshot.connecting || snapshot.connected) return;
    update({ connecting: true });
    try {
      const token = await api<{ url: string; token: string }>("join", {
        name,
        consent: true,
        permissions,
      });
      if (disposed) return;
      room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
        publishDefaults: { simulcast: true, videoCodec: "vp8" },
      });
      room
        .on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
          mixTrack(track, p);
          sync();
        })
        .on(RoomEvent.TrackUnsubscribed, removeTrack)
        .on(RoomEvent.ParticipantConnected, sync)
        .on(RoomEvent.ParticipantDisconnected, sync)
        .on(RoomEvent.TrackMuted, sync)
        .on(RoomEvent.TrackUnmuted, sync)
        .on(RoomEvent.LocalTrackPublished, (p) => {
          if (p.track && room) mixTrack(p.track, room.localParticipant);
          sync();
        })
        .on(RoomEvent.LocalTrackUnpublished, (p) => {
          if (p.track) removeTrack(p.track);
        })
        .on(RoomEvent.AudioPlaybackStatusChanged, () =>
          update({ audioBlocked: !room?.canPlaybackAudio }),
        )
        .on(RoomEvent.ActiveSpeakersChanged, sync)
        .on(RoomEvent.Reconnecting, () => {
          update({ connection: "Reconnecting…" });
          note("Reconnecting call…");
          if (sessionId) void end("room_reconnecting").catch(() => {});
        })
        .on(RoomEvent.Reconnected, () => {
          update({ connection: "Connected" });
          note("Call reconnected.");
        })
        .on(RoomEvent.Disconnected, () => {
          queueCancelled = true;
          clearInterval(clock);
          void end("room_disconnected").catch(() => {});
          update({
            connected: false,
            participants: [],
            connection: "Disconnected",
          });
          note("You left the room.");
        });
      await room.connect(token.url, token.token);
      track("room_joined");
      if (disposed) {
        await room.disconnect();
        return;
      }
      await room.startAudio().catch(() => update({ audioBlocked: true }));
      await room.localParticipant.setMicrophoneEnabled(mic);
      try {
        await room.localParticipant.setCameraEnabled(camera);
      } catch {
        note("Camera unavailable. You can continue with audio.");
      }
      if (disposed) {
        await room.disconnect();
        return;
      }
      update({ connected: true, connection: "Connected" });
      sync();
      await refresh();
      if (disposed) {
        await room.disconnect();
        return;
      }
      clock = setInterval(() => {
        const s = snapshot.data?.sessions[0];
        if (s?.started && ["live", "connecting", "closing"].includes(s.status))
          update({
            seconds: Math.max(
              0,
              600 - Math.floor((Date.now() - s.started) / 1000),
            ),
          });
      }, 1000);
    } catch (e) {
      track("join_failed");
      await room?.disconnect();
      throw e;
    } finally {
      update({ connecting: false });
    }
  }
  async function start(context: Draft) {
    if (snapshot.busy || sessionId) return;
    update({
      busy: true,
      scoreError: "",
      queueWaiting: true,
      queue: undefined,
    });
    queueCancelled = false;
    let queuedAt = 0;
    try {
      while (true) {
        const q = await api<{
          status: string;
          position?: number;
          message?: string;
        }>("queue", {});
        if (queueCancelled) {
          await api("queue", { cancel: true });
          return;
        }
        if (q.status === "ready") break;
        if (q.status === "unavailable") throw Error(q.message);
        if (!queuedAt) {
          queuedAt = Date.now();
          track("queue_entered");
        }
        update({ queue: q.position });
        await new Promise((r) => setTimeout(r, 3000));
      }
      update({ queueWaiting: false });
      // Context edits are saved explicitly; starting must not overwrite cached preparation.
      if (queueCancelled) return;
      stopping = false;
      ctx = new AudioContext({ sampleRate: 48000 });
      ctx.onstatechange = () =>
        mediaFailure("audio_context_suspended", ctx?.state === "suspended");
      await ctx.resume();
      mix = ctx.createMediaStreamDestination();
      allAudio();
      const token = await api<{ url: string; token: string }>("join", {
        ai: true,
        consent: true,
      });
      aiRoom = new Room();
      aiRoom
        .on(RoomEvent.Reconnecting, () =>
          mediaFailure("ai_room_disconnected", true),
        )
        .on(RoomEvent.Reconnected, () =>
          mediaFailure("ai_room_disconnected", false),
        )
        .on(RoomEvent.Disconnected, () =>
          mediaFailure("ai_room_disconnected", true),
        )
        .on(RoomEvent.LocalTrackUnpublished, () =>
          mediaFailure("ai_track_ended", true),
        );
      await aiRoom.connect(token.url, token.token, { autoSubscribe: false });
      pc = new RTCPeerConnection();
      const inputTrack = mix.stream.getAudioTracks()[0];
      inputTrack.addEventListener("ended", () =>
        mediaFailure("ai_track_ended", true),
      );
      pc.addTrack(inputTrack, mix.stream);
      pc.ontrack = async (e) => {
        e.track.addEventListener("ended", () =>
          mediaFailure("ai_track_ended", true),
        );
        decoder = new Audio();
        decoder.muted = true;
        decoder.srcObject = new MediaStream([e.track]);
        await decoder.play().catch(() => {});
        try {
          const publication = await aiRoom?.localParticipant.publishTrack(
            e.track,
            {
              source: Track.Source.Microphone,
            },
          );
          publication?.track?.mediaStreamTrack.addEventListener("ended", () =>
            mediaFailure("ai_track_ended", true),
          );
        } catch {
          note("AI audio could not connect.", true);
          void end("audio_publish_failed").catch(() => {});
        }
      };
      dc = pc.createDataChannel("oai-events");
      dc.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === "session.started" && sessionId)
            void api(`sessions/${sessionId}/heartbeat`, {
              started: true,
            }).catch(() => {});
          if (m.type === "session.closed") void cleanupAI().catch(() => {});
        } catch {}
      };
      pc.onconnectionstatechange = () => {
        mediaFailure(
          "provider_connection_failed",
          !!pc && ["failed", "disconnected"].includes(pc.connectionState),
        );
      };
      await pc.setLocalDescription(await pc.createOffer());
      if (pc.iceGatheringState !== "complete")
        await new Promise<void>((resolve, reject) => {
          const current = pc!;
          const timeout = setTimeout(() => {
            current.removeEventListener("icegatheringstatechange", changed);
            reject(Error("Audio connection timed out"));
          }, 10000);
          function changed() {
            if (current.iceGatheringState === "complete") {
              clearTimeout(timeout);
              current.removeEventListener("icegatheringstatechange", changed);
              resolve();
            }
          }
          current.addEventListener("icegatheringstatechange", changed);
        });
      if (queueCancelled) {
        await cleanupAI();
        return;
      }
      const started = await api<{
        id: string;
        elapsedMs?: number;
        sdp: string;
      }>(
        "start",
        {
          profile: snapshot.profile,
          sdp: pc.localDescription!.sdp,
          namedTranscription: true,
          participantIds: room
            ? [room.localParticipant, ...room.remoteParticipants.values()]
                .filter((p) => p.identity !== "interviewer")
                .map((p) => p.identity)
            : [],
        },
        60000,
      );
      sessionId = started.id;
      if (queueCancelled) {
        await end();
        return;
      }
      try {
        captions = await createNamedCaptions({
          ctx,
          elapsedMs: started.elapsedMs || 0,
          send: async (packet: unknown) => {
            const result = await api(`sessions/${started.id}/caption`, {
              ...(packet as object),
              timebase: "created",
            });
            // Publish attributed words as soon as transcription finishes.
            if (!disposed && !captionRefreshPending) {
              captionRefreshPending = true;
              void refresh()
                .catch(() => {})
                .finally(() => {
                  captionRefreshPending = false;
                });
            }
            return result;
          },
          onError: (message: string) => note(message, true),
        });
        allAudio();
      } catch {
        note(
          "Named captions are unavailable. The interview can continue with unattributed text.",
          true,
        );
      }
      await pc.setRemoteDescription({ type: "answer", sdp: started.sdp });
      const heartbeatSession = sessionId;
      pulse = setInterval(async () => {
        if (stopping || sessionId !== heartbeatSession) return;
        try {
          const ps = room
            ? [room.localParticipant, ...room.remoteParticipants.values()]
            : [];
          await api(`sessions/${sessionId}/heartbeat`, {
            humanSpeaking: ps.some(
              (p) => p.identity !== "interviewer" && p.isSpeaking,
            ),
            partnerSpeaking: ps.some(
              (p) => p.identity === "interviewer" && p.isSpeaking,
            ),
            participants: ps
              .filter((p) => p.identity !== "interviewer")
              .map((p) => ({
                id: p.identity,
                name: p.name,
                speaking: p.isSpeaking,
              })),
          });
        } catch {
          if (sessionId !== heartbeatSession || stopping) return;
          await end("heartbeat_failed").catch(() => {});
          note("Interview connection lost. Preparing your feedback…", true);
        }
      }, 2000);
      note("Interview started.");
      await refresh();
    } catch (e) {
      track("interview_start_failed");
      await end("startup_failed");
      throw e;
    } finally {
      update({ busy: false, queueWaiting: false });
      await api("queue", { cancel: true }).catch(() => {});
    }
  }
  async function score() {
    const id = snapshot.data?.sessions[0]?.id;
    if (!id || snapshot.scorePending) return;
    update({ scorePending: true, scoreError: "" });
    try {
      const card = await api<Scorecard>(`sessions/${id}/scorecard`, {}, 150000);
      if (snapshot.data?.sessions[0]?.id === id)
        update({
          data: {
            ...snapshot.data,
            sessions: snapshot.data.sessions.map((s) =>
              s.id === id ? { ...s, scorecard: card } : s,
            ),
          },
        });
      note("Scorecard ready.");
    } catch (e) {
      update({ scoreError: (e as Error).message + " Try again." });
      throw e;
    } finally {
      update({ scorePending: false });
    }
  }
  function cancelQueue() {
    if (snapshot.queueWaiting) track("queue_left");
    queueCancelled = true;
    void api("queue", { cancel: true }).catch(() => {});
  }
  async function leave() {
    cancelQueue();
    await end();
    await room?.disconnect();
  }
  function pagehide() {
    queueCancelled = true;
    if (snapshot.queueWaiting || snapshot.busy)
      void fetch(`/rooms/${grant.id}/queue`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + grant.key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cancel: true }),
        keepalive: true,
      }).catch(() => {});
    if (sessionId)
      void fetch(`/rooms/${grant.id}/sessions/${sessionId}/end`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + grant.key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "page_left" }),
        keepalive: true,
      }).catch(() => {});
    void room?.disconnect();
  }
  const audioBlocked = () => update({ audioBlocked: true });
  window.addEventListener("mp-audio-blocked", audioBlocked);
  window.addEventListener("pagehide", pagehide);
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    join,
    start,
    end,
    leave,
    score,
    refresh,
    cancelQueue,
    note,
    setProfile: (profile: string) => update({ profile }),
    save: async (draft: Draft) => {
      await api("grounding", draft);
      await refresh();
      note("Company context saved.");
    },
    withdraw: async () => {
      await api("withdraw-permissions", {});
      note(
        "Optional improvement and sales permissions withdrawn for this room.",
      );
    },
    mic: async () => {
      if (room) {
        await room.localParticipant.setMicrophoneEnabled(
          !room.localParticipant.isMicrophoneEnabled,
        );
        sync();
      }
    },
    camera: async () => {
      if (room) {
        await room.localParticipant.setCameraEnabled(
          !room.localParticipant.isCameraEnabled,
        );
        sync();
      }
    },
    sound: async () => {
      await room?.startAudio();
      await ctx?.resume();
      update({ audioBlocked: false });
    },
    local: () => room?.localParticipant,
    dispose: () => {
      disposed = true;
      queueCancelled = true;
      clearInterval(poll);
      clearInterval(clock);
      window.removeEventListener("mp-audio-blocked", audioBlocked);
      window.removeEventListener("pagehide", pagehide);
      pagehide();
      void cleanupAI();
      listeners.clear();
    },
  };
}
export type Engine = ReturnType<typeof createEngine>;
