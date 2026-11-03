import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import * as Dialog from "@radix-ui/react-dialog";
import type { Participant, Track } from "livekit-client";
import { createEngine } from "./engine";
import type { Draft, Grant, Interviewer, Turn } from "./types";
import { request, roomUrl, navigateRoom } from "./api";
import { groupTurns } from "../src/transcripts.js";
import { Icon, IconButton, ErrorText, FieldSelect } from "./ui";
import Preview from "./Preview";
import RoomPill from "./RoomPill";
import { RoomSettings } from "./Theme";
import Scorecard from "./Scorecard";
function InterviewerStandby({
  person,
  research,
  ended,
  active,
}: {
  person?: Interviewer;
  research?: import("./types").Research;
  ended: boolean;
  active: boolean;
}) {
  const pending = ["queued", "searching"].includes(research?.status || "");
  return (
    <div
      className="tile ai-tile interviewer-standby"
      aria-label="AI practice interviewer"
    >
      <div className="standby-content">
        <div className="avatar">
          {person?.photo ? (
            <img src={person.photo} alt="Interviewer reference" />
          ) : (
            <Icon name="wave" />
          )}
        </div>
        <strong>{person?.name || "Practice interviewer"}</strong>
        <span>
          {pending
            ? research?.status === "queued"
              ? "Preparing your interviewer…"
              : "Researching background…"
            : active
              ? "Connecting interviewer…"
              : ended
                ? "Ready for another interview"
                : "Ready when you are"}
        </span>
        {pending && <progress aria-label="Interviewer research in progress" />}
      </div>
      <span className="participant-name">
        AI rehearsal · {pending ? "Preparing" : active ? "Connecting" : "Ready"}
      </span>
    </div>
  );
}
function Media({ track, local }: { track: Track; local: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (local && track.kind === "audio") return;
    const el = track.attach();
    el.autoplay = true;
    if (el instanceof HTMLVideoElement) {
      el.playsInline = true;
      el.muted = true;
    }
    container.current?.append(el);
    void el.play().catch(() => { if (track.kind === "audio") window.dispatchEvent(new Event("mp-audio-blocked")); });
    return () => {
      track.detach(el);
      el.remove();
    };
  }, [track, local]);
  return <div ref={container} className="track-media" />;
}
function Tile({
  participant,
  local,
  person,
}: {
  participant: Participant;
  local: boolean;
  person?: Interviewer;
}) {
  const ai = participant.identity === "interviewer";
  return (
    <div
      id={"p-" + participant.identity}
      className={
        "tile" +
        (local ? " local" : "") +
        (ai ? " ai-tile" : "") +
        (!participant.isCameraEnabled ? " camera-muted" : "") +
        (participant.isSpeaking ? " speaking" : "")
      }
    >
      <div className={"avatar" + (ai && person ? " reference-photo" : "")}>
        {ai ? (
          person?.photo ? (
            <img
              src={person.photo}
              alt={person.name + " — reference photo for AI rehearsal"}
            />
          ) : (
            <Icon name="wave" />
          )
        ) : (
          (participant.name || "Founder")
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0])
            .join("")
            .toUpperCase()
        )}
      </div>
      {[...participant.trackPublications.values()].map(
        (pub) =>
          pub.track && (
            <Media key={pub.trackSid} track={pub.track} local={local} />
          ),
      )}
      <span className="participant-name">
        <i
          className="mic-state"
          aria-label={
            participant.isMicrophoneEnabled
              ? "Microphone on"
              : "Microphone muted"
          }
        >
          <Icon name={participant.isMicrophoneEnabled ? "mic" : "micOff"} />
        </i>
        <span>
          {ai
            ? person?.name || "Interviewer"
            : (participant.name || "Founder") + (local ? " · You" : "")}
        </span>
      </span>
      {ai && (
        <span className="ai-disclosure">
          {person ? "AI rehearsal · synthetic voice" : "AI interviewer"}
        </span>
      )}
    </div>
  );
}
function Transcript({
  items,
  person,
}: {
  items: Turn[];
  person?: Interviewer;
}) {
  const ref = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const turns = useMemo(() => groupTurns(items), [items]);
  useLayoutEffect(() => {
    if (ref.current && follow.current)
      ref.current.scrollTop = ref.current.scrollHeight;
  }, [turns]);
  return (
    <div
      id="transcript"
      ref={ref}
      tabIndex={0}
      aria-label="Interview transcript"
      onScroll={() => {
        const el = ref.current!;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
    >
      {!turns.length ? (
        <div className="empty-state">
          <Icon name="file" />
          <p>No transcript yet.</p>
        </div>
      ) : (
        turns.map((t: Turn, i: number) => (
          <article className={"transcript-turn " + t.speaker} key={i}>
            <header>
              <span>
                {t.speakerName ||
                  (t.speaker === "partner"
                    ? person
                      ? person.name.split(" ")[0] + " · AI"
                      : "Interviewer"
                    : "Founders")}
              </span>
              <time>
                {Math.floor(t.start_ms / 60000)}:
                {String(Math.floor(t.start_ms / 1000) % 60).padStart(2, "0")}
              </time>
            </header>
            <p>{t.text.trim()}</p>
          </article>
        ))
      )}
    </div>
  );
}
export default function CallRoom({ grant: initial }: { grant: Grant }) {
  const [grant, setGrant] = useState(initial),
    [engine] = useState(() => createEngine(initial));
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const data = state.data,
    session = data?.sessions[0],
    active =
      !!session && ["live", "connecting", "closing"].includes(session.status),
    person = data?.profiles.find(
      (p) => p.id === (session?.profile || state.profile),
    )?.interviewer;
  const [context, setContext] = useState<Draft>({
      application: "",
      facts: "{}",
      program: initial.program,
      interviewer: { name: "" },
    }),
    [resultsOpen, setResultsOpen] = useState(false),
    [contextOpen, setContextOpen] = useState(false),
    [contextError, setContextError] = useState(""),
    [saving, setSaving] = useState(false),
    [tab, setTab] = useState("transcript"),
    [desktopPanel, setDesktopPanel] = useState(true),
    [mobilePanel, setMobilePanel] = useState(false),
    [mobile, setMobile] = useState(matchMedia("(max-width:680px)").matches),
    [width, setWidth] = useState(() => {
      try {
        return Number(localStorage.getItem("mp.panelWidth")) || 420;
      } catch {
        return 420;
      }
    });
  const [historyId, setHistoryId] = useState<string | null>(null);
  const viewedSession = data?.sessions.find(s => s.id === historyId) || session;
  const viewingLatest = viewedSession?.id === session?.id;
  const viewedPerson = data?.profiles.find(p => p.id === viewedSession?.profile)?.interviewer;
  const scoreGenerating = !!session && (state.scorePending || ["queued", "running"].includes(session.scoreStatus || "") || !!session.captionFinishing);
  const panel = mobile ? mobilePanel : desktopPanel;
  const togglePanel = (open: boolean) =>
    mobile ? setMobilePanel(open) : setDesktopPanel(open);
  useEffect(() => () => engine.dispose(), [engine]);
  useEffect(() => {
    void engine.refresh().catch(() => engine.note("Room settings could not load. Try reopening the room.", true));
  }, [engine]);
  useEffect(() => {
    const mq = matchMedia("(max-width:680px)");
    const changed = () => setMobile(mq.matches);
    mq.addEventListener("change", changed);
    return () => mq.removeEventListener("change", changed);
  }, []);
  useLayoutEffect(() => {
    document.body.className =
      (state.connected ? "in-call" : "preview-page") +
      (!desktopPanel ? " panel-hidden" : "") +
      (mobilePanel ? " mobile-panel-open" : "");
    document.documentElement.style.setProperty("--notes-width", width + "px");
  }, [state.connected, desktopPanel, mobilePanel, width]);
  useEffect(() => {
    if (!state.notice || state.error) return;
    const timer = setTimeout(() => engine.note(""), 3500);
    return () => clearTimeout(timer);
  }, [state.notice, state.error, engine]);
  const action = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      engine.note((e as Error).message, true);
    }
  };
  async function copy() {
    let current = grant;
    if (!current.code) {
      const link = await request<{ code: string }>(
        "/rooms/" + grant.id + "/link",
        undefined,
        grant.key,
      );
      current = { ...grant, code: link.code };
      setGrant(current);
      navigateRoom(current);
    }
    await navigator.clipboard.writeText(roomUrl(current));
    engine.note("Invite copied.");
  }
  const currentContext = (): Draft => ({
    application: data?.application || "",
    facts: data?.facts || "{}",
    program: state.profile,
    interviewer: data?.interviewer || { name: "" },
  });
  function openContext() {
    setContext(currentContext());
    setContextError("");
    setContextOpen(true);
  }
  const resize = (value: number) => {
    const next = Math.round(
      Math.min(Math.max(280, innerWidth * 0.55), Math.max(280, value)),
    );
    setWidth(next);
    try {
      localStorage.setItem("mp.panelWidth", String(next));
    } catch {}
  };
  useEffect(() => {
    const clamp = () => resize(width);
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [width]);
  const local = engine.local();
  const settingsMenu = (
<RoomSettings
          profile={state.profile}
          onProfile={data?.host ? engine.setProfile : undefined}
          profiles={(data?.profiles || []).map((p) => ({
            value: p.id,
            label:
              (
                {
                  "yc-10": "YC",
                  "speedrun-10": "Speedrun",
                  "speedrun-10-hard": "Speedrun · hard",
                } as Record<string, string>
              )[p.id] || p.title,
          }))}
          onContext={data?.host ? openContext : undefined}
          contextDisabled={state.busy || active}
        />
  );
  const researching = ["queued", "searching"].includes(data?.research?.status || "");
  const interviewControls = (
      <div className="session-pill" role="group" aria-label="Interview controls">
      {data?.host ? (
        <section id="host" className="session-action"
          data-tooltip={researching && !active ? "" : undefined}
          data-tooltip-text={researching && !active ? "Researching interviewer…" : undefined}
          aria-label={researching && !active ? "Researching interviewer…" : undefined}
          tabIndex={researching && !active ? 0 : undefined}
        >
          {active ? (
            <button
              id="end"
              className="end-interview"
              onClick={() => void action(engine.end)}
            >
              <Icon name="stop" />
              End interview
            </button>
          ) : (
            <button
              id="start"
              className="primary"
              disabled={
                state.busy ||
                !data.enabled ||
                ["queued", "searching"].includes(data.research?.status || "") ||
                (!data.queueEnabled && data.busy)
              }
              onClick={() => void action(() => engine.start(currentContext()))}
            >
              <Icon name="playFilled" />
              {state.busy ? "Connecting…" : "Start interview"}
            </button>
          )}
        </section>
      ) : (
        <span id="guest-note">Waiting for host</span>
      )}
        <span id="clock" aria-label="Interview time remaining" className={active ? "running" : ""}>
          {Math.floor(state.seconds / 60)}:
          {String(state.seconds % 60).padStart(2, "0")}
        </span>
      </div>
  );
  return (
    <>
      {createPortal(<><RoomPill grant={grant} count={state.connected ? state.participants.filter(p => p.identity !== "interviewer").length : undefined} /></>, document.getElementById("room-header")!)}
      {state.connected &&
        data?.research &&
        data.research.status !== "ready" &&
        (state.participants.some((p) => p.identity === "interviewer") ||
          !["queued", "searching"].includes(data.research.status)) && (
          <aside className="research-status" aria-live="polite">
            {["queued", "searching"].includes(data.research.status) ? (
              <>
                <span>
                  {data.research.status === "queued"
                    ? "Interviewer research queued"
                    : "Researching interviewer background…"}
                </span>
                <progress aria-label="Interviewer research in progress" />
              </>
            ) : (
              <span>
                {data.research.status === "unmatched"
                  ? "Profile not confidently matched. Using your notes."
                  : "Research unavailable. Using your notes."}
              </span>
            )}
          </aside>
        )}
      {state.connected ? (
        <section id="call">
          {state.queueWaiting && (
            <div id="queue-banner" aria-labelledby="queue-title">
              <span className="queue-emoji" aria-hidden="true">🙇</span>
              <h2 id="queue-title">Waiting for an interviewer</h2>
              <span id="queue-message" role="status">
                {state.queue ? `Position ${state.queue} in queue` : "Checking availability…"}
              </span>
              <p className="queue-hint">Your interview starts automatically when a slot opens.</p>
              <button id="cancel-queue" onClick={engine.cancelQueue}>Leave queue</button>
            </div>
          )}
          <div className="workspace">
            <section className="stage" aria-label="Participants">
              <div id="tiles">
                {!state.participants.some(
                  (p) => p.identity === "interviewer",
                ) && (
                  <InterviewerStandby
                    person={person}
                    research={data?.research}
                    ended={session?.status === "complete"}
                    active={session?.status === "live"}
                  />
                )}
                {state.participants.map((p) => (
                  <Tile
                    key={p.identity}
                    participant={p}
                    local={p === local}
                    person={person}
                  />
                ))}
              </div>
            </section>
            <aside
              id="results"
              className="side-panel"
              aria-label="Interview notes"
            >
              <div
                id="panel-resize"
                role="separator"
                aria-label="Resize notes panel"
                aria-orientation="vertical"
                aria-valuemin={280}
                aria-valuemax={Math.round(Math.max(280, innerWidth * 0.55))}
                aria-valuenow={width}
                tabIndex={0}
                onPointerDown={(e) => {
                  if (e.button === 0) {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    resize(
                      document
                        .getElementById("results")!
                        .getBoundingClientRect().right - e.clientX,
                    );
                }}
                onPointerUp={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onKeyDown={(e) => {
                  if (["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) {
                    e.preventDefault();
                    resize(
                      e.key === "Home"
                        ? 420
                        : width + (e.key === "ArrowLeft" ? 32 : -32),
                    );
                  }
                }}
              />
              <Tabs.Root
                value={tab}
                onValueChange={setTab}
                className="notes-tabs"
              >
                <div className="panel-header">
                  <Tabs.List
                    className="panel-tabs"
                    aria-label="Interview notes"
                  >
                    <Tabs.Trigger value="transcript" id="transcript-tab">
                      Transcript
                    </Tabs.Trigger>
                    <Tabs.Trigger value="scorecard" id="scorecard-tab" data-generating={scoreGenerating || undefined}>
                      Scorecard
                    </Tabs.Trigger>
                  </Tabs.List>
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <IconButton id="interview-history" className="icon-only" icon="history" label="Interview history" />
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Content className="settings-menu history-menu" align="end" sideOffset={8} collisionPadding={12} aria-label="Interview history">
                        <Menu.Label className="history-menu-label">Interviews</Menu.Label>
                        {!data?.sessions.length && <div className="history-menu-empty">No interviews yet</div>}
                        <Menu.RadioGroup value={viewedSession?.id || ""} onValueChange={id => setHistoryId(id === session?.id ? null : id)}>
                          {data?.sessions.map((item, index) => <Menu.RadioItem className="history-item" key={item.id} value={item.id}>
                            <span>{item.started ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(item.started) : `Interview ${data.sessions.length - index}`}
                              <small>{["live", "connecting", "closing"].includes(item.status) ? "In progress" : item.status === "complete" ? "Completed" : item.status}</small>
                            </span>
                            <Menu.ItemIndicator><Icon name="check" /></Menu.ItemIndicator>
                          </Menu.RadioItem>)}
                        </Menu.RadioGroup>
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu.Root>
                  <IconButton
                    id="panel-close"
                    className="icon-only"
                    label="Close notes panel"
                    icon="close"
                    onClick={() => {
                      togglePanel(false);
                      document.getElementById(`${tab}-toggle`)?.focus();
                    }}
                  />
                </div>
                {!viewingLatest && viewedSession && <div className="history-selection">Previous interview <button onClick={() => setHistoryId(null)}>Back to latest</button></div>}
                {viewingLatest && active && session?.agendaWarning && (
                  <div id="agenda-warning" className="warning" role="alert">
                    {session.agendaWarning}
                  </div>
                )}
                <Tabs.Content
                  value="transcript"
                  id="transcript-panel"
                  forceMount
                  hidden={tab !== "transcript"}
                >
                  {active && viewingLatest && state.participants.some(p => p.isSpeaking && p.identity !== "interviewer") && (
                    <div className="transcript-speaking"><Icon name="mic" />{state.participants.filter(p => p.isSpeaking && p.identity !== "interviewer").map(p => p.name || "Participant").join(", ")} speaking…</div>
                  )}
                  <Transcript
                    items={viewedSession?.transcript || []}
                    person={viewedPerson}
                  />
                </Tabs.Content>
                <Tabs.Content
                  value="scorecard"
                  id="scorecard-panel"
                  forceMount
                  hidden={tab !== "scorecard"}
                >
                  <div id="scorecard" tabIndex={0}>
                    {viewedSession?.scorecard ? (
                      <Scorecard card={viewedSession.scorecard} />
                    ) : (
                      <div className="empty-state">
                        <Icon name="sparkles" />
                        <p>Scorecard available after the interview.</p>
                      </div>
                    )}
                  </div>
                  {!viewedSession?.scorecard &&
                    ((viewingLatest && state.scorePending) ||
                      viewedSession?.scoreStatus === "running" ||
                      viewedSession?.scoreStatus === "queued" ||
                      viewedSession?.captionFinishing ||
                      (viewingLatest && state.scoreError) ||
                      viewedSession?.scoreError) && (
                      <p
                        id="score-status"
                        className="score-status"
                        role={
                          (viewingLatest && state.scoreError) || viewedSession?.scoreError
                            ? "alert"
                            : "status"
                        }
                      >
                        {(viewingLatest && state.scorePending) ||
                        viewedSession?.scoreStatus === "running" ||
                        viewedSession?.scoreStatus === "queued"
                          ? "Generating scorecard… Up to 2 minutes."
                          : viewedSession?.captionFinishing
                            ? "Finishing transcript…"
                            : (viewingLatest && state.scoreError) || viewedSession?.scoreError}
                      </p>
                    )}
                  {viewingLatest && data?.host && viewedSession &&
                    ["complete", "unconfirmed"].includes(viewedSession?.status || "") &&
                    !viewedSession?.scorecard &&
                    (viewedSession.scoreStatus === "failed" ||
                      !!(viewingLatest && state.scoreError)) && (
                      <button
                        id="score"
                        disabled={
                          (viewingLatest && state.scorePending) ||
                          viewedSession.scoreStatus === "running" ||
                          viewedSession.captionFinishing
                        }
                        onClick={() => void action(engine.score)}
                      >
                        <Icon name="sparkles" />
                        {(viewingLatest && state.scorePending)
                          ? "Generating scorecard…"
                          : (viewingLatest && state.scoreError) || viewedSession.scoreError
                            ? "Retry scorecard"
                            : "Retry scorecard"}
                      </button>
                    )}
                </Tabs.Content>
              </Tabs.Root>
            </aside>
          </div>
          <div className="call-dock">
          <nav className="call-controls" aria-label="Call controls">
            <IconButton
              id="mic"
              icon={local?.isMicrophoneEnabled ? "mic" : "micOff"}
              label={local?.isMicrophoneEnabled ? "Mute mic" : "Unmute mic"}
              aria-pressed={!local?.isMicrophoneEnabled}
              onClick={() => void action(engine.mic)}
            />
            <IconButton
              id="camera"
              icon={local?.isCameraEnabled ? "camera" : "cameraOff"}
              label={local?.isCameraEnabled ? "Camera off" : "Camera on"}
              aria-pressed={!local?.isCameraEnabled}
              onClick={() => void action(engine.camera)}
            />
            {(["transcript", "scorecard"] as const).map(view => (
              <IconButton
                key={view}
                data-generating={view === "scorecard" && scoreGenerating || undefined}
                id={`${view}-toggle`}
                icon={view === "transcript" ? "chat" : "scorecard"}
                label={view === "transcript" ? "Transcript" : "Scorecard"}
                aria-pressed={panel && tab === view}
                aria-expanded={panel && tab === view}
                aria-controls="results"
                onClick={() => {
                  if (panel && tab === view) togglePanel(false);
                  else { setTab(view); togglePanel(true); }
                }}
              />
            ))}
            {settingsMenu}
            <IconButton
              id="leave"
              className="leave"
              icon="phone"
              label="Leave room"
              onClick={() => void action(engine.leave)}
            />
          </nav>
          {interviewControls}
          </div>
        </section>
      ) : (
        <>
          <Preview engine={engine} settings={settingsMenu} />
          {!!data?.sessions.length && <button className="secondary" onClick={() => setResultsOpen(true)}>View interview results</button>}
        </>
      )}
      <Dialog.Root open={resultsOpen} onOpenChange={setResultsOpen}>
        <Dialog.Portal><Dialog.Overlay className="context-overlay" />
          <Dialog.Content className="react-dialog">
            <div className="dialog-heading"><Dialog.Title>Interview results</Dialog.Title>
              <Dialog.Close asChild><IconButton icon="close" label="Close results" className="icon-only" /></Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Transcripts and scorecards from this room.</Dialog.Description>
            <div style={{ overflowY: "auto", minHeight: 0, padding: "0 24px 24px" }}>
              {data?.sessions.map(item => <section key={item.id} style={{ marginBlock: 24 }}>
                <h3>{item.started ? new Date(item.started).toLocaleString() : "Interview"}</h3>
                {item.scorecard ? <Scorecard card={item.scorecard} /> : <p role="status">{item.scoreError || (["live", "connecting", "closing"].includes(item.status) ? "Interview in progress." : "Preparing your scorecard…")}</p>}
                {!item.scorecard && item.id === session?.id && item.scoreStatus === "failed" && <button disabled={state.scorePending} onClick={() => void action(engine.score)}>Retry scorecard</button>}
                <details><summary>Transcript</summary><Transcript items={item.transcript || []} person={person} /></details>
              </section>)}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {state.audioBlocked && <div className="notice" role="alert"><span>Audio is paused.</span><button onClick={() => void action(engine.sound)}>Enable audio</button></div>}
      <Dialog.Root
        open={contextOpen}
        onOpenChange={(open) => {
          if (!saving) setContextOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="context-overlay" />
          <Dialog.Content
            id="background-dialog"
            className="react-dialog"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              document.getElementById("context-title")?.focus();
            }}
            onEscapeKeyDown={(e) => {
              if (saving) e.preventDefault();
            }}
            onPointerDownOutside={(e) => {
              if (saving) e.preventDefault();
            }}
          >
            <div className="dialog-heading">
              <div>
                <Dialog.Title id="context-title" tabIndex={-1}>Company context</Dialog.Title>
                <Dialog.Description>
                  Application and interviewer details.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <IconButton
                  id="background-close"
                  className="icon-only"
                  icon="close"
                  label="Close company context"
                  disabled={saving}
                />
              </Dialog.Close>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (saving) return;
                setSaving(true);
                setContextError("");
                try {
                  await engine.save({ ...context, facts: "{}" });
                  setContextOpen(false);
                } catch (e) {
                  setContextError((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <div className="dialog-body">
                <ErrorText id="context-error">{contextError}</ErrorText>
                <label htmlFor="application">Application</label>
                <textarea
                  id="application"
                  rows={5}
                  disabled={saving}
                  value={context.application}
                  onChange={(e) =>
                    setContext({ ...context, application: e.target.value })
                  }
                />
                <label htmlFor="context-person">
                  Interviewer name (optional)
                </label>
                <input
                  id="context-person"
                  maxLength={100}
                  disabled={saving}
                  value={context.interviewer.name}
                  onChange={(e) =>
                    setContext({
                      ...context,
                      interviewer: {
                        ...context.interviewer,
                        name: e.target.value,
                      },
                    })
                  }
                />
                <label htmlFor="context-linkedin">
                  LinkedIn profile (optional)
                </label>
                <input
                  id="context-linkedin"
                  type="url"
                  maxLength={400}
                  disabled={saving}
                  value={context.interviewer.linkedin || ""}
                  onChange={(e) =>
                    setContext({
                      ...context,
                      interviewer: {
                        ...context.interviewer,
                        linkedin: e.target.value,
                      },
                    })
                  }
                />
                <label htmlFor="context-voice">Practice voice</label>
                <FieldSelect
                  id="context-voice"
                  label="Practice voice"
                  value={context.interviewer.voice || "auto"}
                  disabled={saving}
                  options={[
                    { value: "auto", label: "Automatic" },
                    { value: "cedar", label: "Cedar · masculine" },
                    { value: "marin", label: "Marin · feminine" },
                  ]}
                  onChange={(voice) =>
                    setContext({
                      ...context,
                      interviewer: {
                        ...context.interviewer,
                        voice: voice as "auto" | "cedar" | "marin",
                      },
                    })
                  }
                />
                <label htmlFor="context-notes">
                  Your notes about the interviewer (optional)
                </label>
                <textarea
                  id="context-notes"
                  maxLength={3000}
                  disabled={saving}
                  value={context.interviewer.notes || ""}
                  onChange={(e) =>
                    setContext({
                      ...context,
                      interviewer: {
                        ...context.interviewer,
                        notes: e.target.value,
                      },
                    })
                  }
                />
              </div>
              <div className="dialog-footer">
                <Dialog.Close asChild>
                  <button
                    id="background-cancel"
                    type="button"
                    disabled={saving}
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button id="save" className="primary" disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {state.notice && (
        <div id="notice" className={"notice" + (state.error ? " error" : "")}>
          <Icon name={state.error ? "alert" : "check"} />
          <span id="notice-text" role={state.error ? "alert" : "status"}>
            {state.notice}
          </span>
          <IconButton
            id="notice-dismiss"
            className="icon-only"
            label="Dismiss notification"
            icon="close"
            onClick={() => engine.note("")}
          />
        </div>
      )}
    </>
  );
}
