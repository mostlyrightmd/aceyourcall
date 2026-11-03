import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { Engine } from "./engine";
import { ErrorText, IconButton } from "./ui";
export default function Preview({ engine, settings }: { engine: Engine; settings?: ReactNode }) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | undefined>(undefined),
    generation = useRef(0);
  const [mic, setMic] = useState(true),
    [camera, setCamera] = useState(true),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [name, setName] = useState("");
  const stop = () => {
    generation.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = undefined;
    if (video.current) video.current.srcObject = null;
  };
  async function capture() {
    const own = ++generation.current;
    setReady(false);
    try {
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: { width: 640, height: 360 },
        });
      } catch {
        try {
          s = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true },
            video: false,
          });
          setCamera(false);
        } catch {
          s = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { width: 640, height: 360 },
          });
          setMic(false);
        }
      }
      if (own !== generation.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      if (video.current) video.current.srcObject = s;
      setStatus(
        !s.getAudioTracks().length
          ? "Microphone unavailable. Join with it off."
          : !s.getVideoTracks().length
            ? "Camera unavailable. Join with it off."
            : "",
      );
    } catch {
      if (own === generation.current) {
        setMic(false);
        setCamera(false);
        setStatus("Camera and microphone unavailable. Join with both off.");
      }
    } finally {
      if (own === generation.current) setReady(true);
    }
  }
  useEffect(() => {
    void capture();
    return stop;
  }, []);
  useEffect(() => {
    stream.current?.getAudioTracks().forEach((t) => (t.enabled = mic));
    stream.current?.getVideoTracks().forEach((t) => (t.enabled = camera));
  }, [mic, camera, ready]);
  async function join() {
    if (busy) return;
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    setError("");
    setBusy(true);
    const useMic = mic,
      useCamera = camera;
    stop();
    try {
      await engine.join(name.trim(), useMic, useCamera);
    } catch (e) {
      setError((e as Error).message);
      void capture();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="welcome" className="welcome">
      <div className="entry-card">
        <section id="lobby">
          <div className="prejoin-media">
            <div className="preview-frame">
              <video
                id="preview-video"
                ref={video}
                autoPlay
                muted
                playsInline
                hidden={!camera || !ready}
              />
              <div id="preview-placeholder" hidden={camera && ready}>
                {ready ? "Camera off" : "Camera preview"}
              </div>
            </div>
            <div className="preview-controls">
              <IconButton
                id="preview-mic"
                className="control preview-toggle"
                icon={mic ? "mic" : "micOff"}
                label="Microphone"
                aria-pressed={mic}
                disabled={!ready || busy}
                onClick={() => {
                  setMic(!mic);
                  if (!stream.current?.getAudioTracks().length) {
                    stop();
                    void capture();
                  }
                }}
              />
              <IconButton
                id="preview-camera"
                className="control preview-toggle"
                icon={camera ? "camera" : "cameraOff"}
                label="Camera"
                aria-pressed={camera}
                disabled={!ready || busy}
                onClick={() => {
                  setCamera(!camera);
                  if (!stream.current?.getVideoTracks().length) {
                    stop();
                    void capture();
                  }
                }}
              />
              {settings}
            </div>
            {status && (
              <p id="preview-status" role="status">
                {status}
              </p>
            )}
          </div>
          <div className="prejoin-form">
            <div className="prejoin-heading">
              <h1>Join the room</h1>
              <p id="prejoin-description">Enter the name others will see.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void join();
              }}
            >
              <input
                id="name"
                value={name}
                maxLength={80}
                autoComplete="given-name"
                placeholder="Your name"
                aria-label="Your name"
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!error}
                aria-describedby="prejoin-description join-error"
              />
              <ErrorText id="join-error">{error}</ErrorText>
              <button id="join" className="primary wide" disabled={busy}>
                {busy ? "Joining…" : "Join room"}
              </button>
            </form>
          </div>
        </section>
      </div>
    </section>
  );
}
