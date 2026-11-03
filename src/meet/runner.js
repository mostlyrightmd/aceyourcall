import { spawn } from "node:child_process";
import { meetURL } from "./config.js";
export function meetingRunner({
  onExit = () => {},
  spawnProcess = spawn,
  signalProcess = (child, signal) => {
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {}
  },
  stopTimeoutMs = 10000,
} = {}) {
  let child = null,
    stopTimer = null;
  let state = { running: false, status: "idle" };
  return {
    state: () => ({ ...state }),
    start({ url, profile, seconds }) {
      if (child) throw new Error("A meeting bot is already running");
      url = meetURL(url);
      if (!Number.isInteger(seconds) || seconds < 5 || seconds > 600)
        throw new Error("Meeting duration must be 5–600 seconds");
      state = { running: true, status: "opening", seconds };
      child = spawnProcess(
        process.execPath,
        [
          "scripts/meet-bot.mjs",
          "--url",
          url,
          "--profile",
          profile,
          "--seconds",
          String(seconds),
          "--voice",
          "--consent",
        ],
        {
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        },
      );
      let pending = "";
      child.stdout.on("data", (chunk) => {
        pending += chunk.toString();
        if (pending.length > 64000) pending = "";
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (event.event === "audio_status") state.audio = event;
            else state.status = event.event;
            if (event.id) state.sessionId = event.id;
            if (event.reason) state.error = String(event.reason).slice(0, 240);
          } catch {}
        }
      });
      child.stderr.on("data", () => {}); // Never expose browser internals or credentials.
      child.on("error", () => {
        state.error = "Could not start the meeting browser";
      });
      child.on("close", (code) => {
        clearTimeout(stopTimer);
        stopTimer = null;
        signalProcess(child, "SIGTERM");
        child = null;
        state.running = false;
        state.status = code === 0 ? "ended" : "needs_attention";
        onExit();
      });
      return this.state();
    },
    stop() {
      if (child) {
        state.status = "stopping";
        signalProcess(child, "SIGTERM");
        if (!stopTimer) {
          const pending = child;
          stopTimer = setTimeout(
            () => signalProcess(pending, "SIGKILL"),
            stopTimeoutMs,
          );
          stopTimer.unref?.();
        }
      }
    },
  };
}
