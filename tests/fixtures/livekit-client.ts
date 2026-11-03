// Build-time browser-test substitute. Never included by the production Vite config.
export const RoomEvent = Object.fromEntries(
  [
    "TrackSubscribed",
    "TrackUnsubscribed",
    "ParticipantConnected",
    "ParticipantDisconnected",
    "TrackMuted",
    "TrackUnmuted",
    "LocalTrackPublished",
    "LocalTrackUnpublished",
    "ActiveSpeakersChanged",
    "AudioPlaybackStatusChanged",
    "Reconnecting",
    "Reconnected",
    "Disconnected",
  ].map((v) => [v, v]),
);
export const Track = { Source: { Microphone: "microphone" } };
export const VideoPresets = {
  h720: { resolution: { width: 1280, height: 720 } },
};
function participant(identity: string, name: string) {
  return {
    identity,
    name,
    isCameraEnabled: false,
    isMicrophoneEnabled: true,
    isSpeaking: false,
    trackPublications: new Map(),
    audioTrackPublications: new Map(),
    setMicrophoneEnabled: async function (enabled: boolean) {
      this.isMicrophoneEnabled = enabled;
    },
    setCameraEnabled: async function (enabled: boolean) {
      this.isCameraEnabled = enabled;
    },
    publishTrack: async () => {},
  };
}
export class Room {
  handlers = new Map<string, Function[]>();
  localParticipant = participant("alex", "Alex");
  remoteParticipants = new Map([
    ["bea", participant("bea", "Bea")],
    ["chris", participant("chris", "Chris")],
    ["interviewer", participant("interviewer", "AceYourCall")],
  ]);
  on(name: string, fn: Function) {
    this.handlers.set(name, [...(this.handlers.get(name) || []), fn]);
    return this;
  }
  async connect() {}
  async startAudio() {}
  async disconnect() {
    for (const fn of this.handlers.get("Disconnected") || []) fn();
  }
}
