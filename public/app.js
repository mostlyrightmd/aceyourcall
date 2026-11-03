function groupTranscript(items) {
  const turns = [];
  for (const t of items) {
    const last = turns.at(-1);
    if (last && last.speaker === t.speaker && t.start_ms - last.end_ms < 4000) {
      last.text += t.text;
      last.end_ms = t.end_ms;
    } else turns.push({ ...t });
  }
  return turns;
}
const $ = (id) => document.getElementById(id);
let state,
  pc,
  stream,
  dc,
  sessionId,
  heartbeat,
  starting = false;
async function api(path, data) {
  const r = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || "Request failed");
  return b;
}
function note(t) {
  $("notice").textContent = t;
}
async function refresh(initial = false) {
  state = await api("/api/state");
  if (initial) {
    for (const p of state.profiles) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.title;
      $("profile").append(o);
    }
    $("profile").value = "speedrun-10";
    $("application").value = state.application;
    $("facts").value = state.facts;
  }
  $("status").textContent = state.kill
    ? "Kill switch on"
    : state.enabled
      ? "Ready for practice"
      : "Offline setup · paid calls disabled";
  $("spend").textContent =
    `Today $${state.daily.toFixed(3)} / $15 · Last 31 days $${state.cycle.toFixed(3)} / $180`;
  $("kill").textContent = state.kill
    ? "Disable kill switch"
    : "Enable kill switch";
  $("start").disabled = !!sessionId || starting || state.kill || !state.enabled;
  $("meet-start").disabled =
    state.kill || !state.enabled || !!state.active || state.meeting?.running;
  $("meet-end").disabled = !state.meeting?.running;
  $("meet-status").textContent =
    state.meeting?.error || "Meeting bot: " + (state.meeting?.status || "idle");
  if (state.meeting?.running) $("start").disabled = true;
  $("history").replaceChildren();
  for (const s of state.sessions) {
    const row = document.createElement("div"),
      link = document.createElement("a");
    link.href = `/api/sessions/${s.id}/export`;
    link.textContent = "Export transcript";
    row.append(
      document.createTextNode(
        `${new Date(s.created).toLocaleString()} · ${s.profile}${s.synthetic ? " (synthetic test)" : ""} · ${s.status} · $${s.cost.toFixed(3)}  `,
      ),
      link,
    );
    if (s.status === "complete") {
      const button = document.createElement("button");
      button.textContent = s.scorecard
        ? "View scorecard"
        : "Generate scorecard (≤ $0.05)";
      button.onclick = async () => {
        button.disabled = true;
        try {
          const card = await api(`/api/sessions/${s.id}/scorecard`, {});
          const result = document.createElement("pre");
          result.style.whiteSpace = "pre-wrap";
          result.textContent = JSON.stringify(card, null, 2);
          row.append(result);
          const download = document.createElement("a");
          download.href = `/api/sessions/${s.id}/scorecard-export`;
          download.textContent = "Download scorecard Markdown";
          row.append(download);
          if (!s.coverage?.length && card.coverage.length) {
            const confirm = document.createElement("button");
            confirm.textContent =
              "Confirm these questions were asked: " + card.coverage.join(", ");
            confirm.onclick = async () => {
              try {
                await api(`/api/sessions/${s.id}/coverage`, {
                  ids: card.coverage,
                });
                confirm.textContent = "Coverage confirmed";
                confirm.disabled = true;
              } catch (e) {
                note(e.message);
              }
            };
            row.append(confirm);
          }
        } catch (e) {
          note(e.message);
        } finally {
          button.disabled = false;
        }
      };
      row.append(document.createTextNode(" "), button);
    }
    $("history").append(row);
  }
  if (sessionId) {
    const r = state.sessions.find((s) => s.id === sessionId);
    if (r) {
      $("transcript").textContent = groupTranscript(r.transcript)
        .map(
          (t) => `[${(t.start_ms / 1000).toFixed(1)}] ${t.speaker}: ${t.text}`,
        )
        .join("\n");
      if (["complete", "unconfirmed"].includes(r.status)) {
        cleanup();
        note(
          r.status === "complete"
            ? "Session ended. Transcript saved."
            : "Session ended with unconfirmed final usage. Kill switch enabled; reconcile before restarting.",
        );
      }
    }
  }
}
function cleanup() {
  clearInterval(heartbeat);
  heartbeat = null;
  pc?.close();
  stream?.getTracks().forEach((t) => t.stop());
  pc = null;
  stream = null;
  dc = null;
  sessionId = null;
  $("audio").srcObject = null;
  $("end").disabled = true;
  $("mute").disabled = true;
  $("mute").textContent = "Mute mic";
  $("start").disabled = state?.kill || !state?.enabled;
}
async function end() {
  const id = sessionId; // Stop local audio immediately while server drains final accounting.
  $("audio").muted = true;
  stream?.getTracks().forEach((t) => (t.enabled = false));
  if (dc?.readyState === "open")
    dc.send(JSON.stringify({ type: "session.close" }));
  try {
    if (id) await api(`/api/sessions/${id}/end`, {});
  } catch (e) {
    note(e.message);
  }
  setTimeout(() => {
    cleanup();
    refresh().catch((e) => note(e.message));
  }, 2000);
}
$("save").onclick = async () => {
  try {
    await api("/api/grounding", {
      application: $("application").value,
      facts: $("facts").value,
    });
    note("Application saved locally.");
  } catch (e) {
    note(e.message);
  }
};
$("kill").onclick = async () => {
  try {
    await api("/api/kill", { enabled: !state.kill });
    if (!state.kill) await end();
    await refresh();
  } catch (e) {
    note(e.message);
  }
};
$("mute").onclick = () => {
  if (!stream) return;
  const enabled = !stream.getAudioTracks()[0].enabled;
  stream.getAudioTracks().forEach((t) => (t.enabled = enabled));
  $("mute").textContent = enabled ? "Mute mic" : "Unmute mic";
};
$("end").onclick = end;
$("start").onclick = async () => {
  if (starting || sessionId) return;
  if (!$("consent").checked)
    return note("All participants must consent before starting.");
  starting = true;
  $("start").disabled = true;
  try {
    await api("/api/grounding", {
      application: $("application").value,
      facts: $("facts").value,
    });
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    pc = new RTCPeerConnection();
    for (const t of stream.getTracks()) pc.addTrack(t, stream);
    $("audio").muted = false;
    pc.ontrack = (e) => {
      $("audio").srcObject = e.streams[0];
      $("audio")
        .play()
        .catch(() => note("Click the page to allow audio playback."));
    };
    dc = pc.createDataChannel("oai-events");
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "session.started" && sessionId)
          api(`/api/sessions/${sessionId}/heartbeat`, { started: true }).catch(
            () => {},
          );
        if (msg.type === "session.closed") {
          cleanup();
          refresh().catch(() => {});
        }
      } catch {}
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(pc?.connectionState)) end();
    };
    await pc.setLocalDescription(await pc.createOffer());
    if (pc.iceGatheringState !== "complete")
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("ICE gathering timed out")),
          10000,
        );
        pc.addEventListener("icegatheringstatechange", () => {
          if (pc.iceGatheringState === "complete") {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    const result = await api("/api/sessions", {
      profile: $("profile").value,
      consent: true,
      sdp: pc.localDescription.sdp,
    });
    sessionId = result.id;
    await pc.setRemoteDescription({ type: "answer", sdp: result.sdp });
    $("end").disabled = false;
    $("mute").disabled = false;
    note("Interview connected.");
    heartbeat = setInterval(async () => {
      try {
        const r = await api(`/api/sessions/${sessionId}/heartbeat`, {});
        if (r.started) {
          const elapsed = (Date.now() - r.started) / 1000,
            remaining = Math.max(0, 600 - Math.floor(elapsed));
          $("clock").textContent =
            `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
          if (elapsed >= 630) end();
        }
        await refresh();
      } catch (e) {
        note(e.message);
        end();
      }
    }, 2000);
  } catch (e) {
    note(e.message);
    if (sessionId) await end();
    else cleanup();
  } finally {
    starting = false;
    $("start").disabled = !!sessionId || state.kill || !state.enabled;
  }
};
window.addEventListener("pagehide", () => {
  if (sessionId)
    navigator.sendBeacon(
      `/api/sessions/${sessionId}/end`,
      new Blob(["{}"], { type: "application/json" }),
    );
  cleanup();
});
refresh(true).catch((e) => note(e.message));

let meetingPoll;
$("meet-start").onclick = async () => {
  if (!$("consent").checked)
    return note("All participants must consent before the bot joins.");
  $("meet-start").disabled = true;
  try {
    await api("/api/grounding", {
      application: $("application").value,
      facts: $("facts").value,
    });
    await api("/api/meet/start", {
      url: $("meet-url").value,
      profile: $("profile").value,
      consent: true,
      seconds: 600,
    });
    note("Bot is opening Meet. Admit it when asked.");
    clearInterval(meetingPoll);
    meetingPoll = setInterval(async () => {
      try {
        await refresh();
        if (!state.meeting?.running) clearInterval(meetingPoll);
      } catch (e) {
        note(e.message);
      }
    }, 2000);
  } catch (e) {
    note(e.message);
    await refresh();
  }
};
$("meet-end").onclick = async () => {
  try {
    await api("/api/meet/end", {});
    await refresh();
  } catch (e) {
    note(e.message);
  }
};
