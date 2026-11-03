import ResizableTextarea from "./ResizableTextarea";
import { useEffect, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { config as getConfig, request, resolveRoom, saveHost } from "./api";
import { permissions, type Config, type Draft, type Grant } from "./types";
import { ErrorText, Icon, Legal, FieldSelect, programs } from "./ui";
const empty: Draft = {
  application: "",
  facts: "{}",
  program: "speedrun-10",
  interviewer: { name: "", linkedin: "", notes: "" },
};
function readDraft(): Draft {
  try {
    const d = JSON.parse(
      localStorage.getItem("mp.applicationDraft.v1") || "null",
    );
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      application: text(d?.application),
      facts: text(d?.facts) || "{}",
      program: programs.some((p) => p.value === d?.program)
        ? d.program
        : "speedrun-10",
      interviewer: {
        name: text(d?.interviewer?.name),
        linkedin: text(d?.interviewer?.linkedin),
        notes: text(d?.interviewer?.notes),
      },
    };
  } catch {
    return empty;
  }
}
declare global {
  interface Window {
    turnstile?: {
      render: (target: HTMLElement, options: Record<string, unknown>) => string;
      getResponse: (id: string) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}
function useChallenge(sitekey?: string) {
  const target = useRef<HTMLDivElement>(null),
    widget = useRef<string | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!sitekey) return;
    let cancelled = false;
    const mount = () => {
      if (cancelled || !target.current || !window.turnstile) return;
      widget.current = window.turnstile.render(target.current, {
        sitekey,
        action: "create-room",
        theme: "dark",
        appearance: "interaction-only",
        "error-callback": () =>
          setError("Verification failed. Refresh to try again."),
      });
    };
    let script: HTMLScriptElement | undefined;
    if (window.turnstile) mount();
    else {
      script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.onload = mount;
      script.onerror = () =>
        setError("Verification could not load. Refresh to try again.");
      document.head.append(script);
    }
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
      script?.remove();
    };
  }, [sitekey]);
  return {
    target,
    error,
    response: () =>
      widget.current
        ? window.turnstile?.getResponse(widget.current)
        : undefined,
    reset: () => {
      if (widget.current) window.turnstile?.reset(widget.current);
    },
  };
}
export default function Entry({
  initial,
  onRoom,
  initialError = "",
}: {
  initial: Config;
  onRoom: (g: Grant) => void;
  initialError?: string;
}) {
  const [config, setConfig] = useState(initial),
    [mode, setMode] = useState(
      new URLSearchParams(location.search).get("mode") === "join" ? "join" : initial.canCreate || initial.communityPreview ? "create" : "join",
    ),
    [draft, setDraft] = useState(readDraft),
    [remember, setRemember] = useState(() => {
      try {
        return localStorage.getItem("mp.rememberDraft") !== "false";
      } catch {
        return false;
      }
    }),
    [error, setError] = useState(initialError),
    [applicationError, setApplicationError] = useState(""),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState(""),
    [creator, setCreator] = useState(""),
    [fileLabel, setFileLabel] = useState(""),
    [dragging, setDragging] = useState(false),
    [storageError, setStorageError] = useState("");
  const allowed = !!(config.canCreate || config.communityPreview),
    challenge = useChallenge(config.turnstileSitekey),
    application = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    document.body.className =
      "entry-home" +
      (mode === "create" && allowed ? " onboarding" : "") +
      (mode === "join" ? " entry-joining" : "");
  }, [mode, allowed]);
  useEffect(() => {
    if (mode !== "create" || !allowed) return;
    let depth = 0;
    const files = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types || []).includes("Files");
    const enter = (e: DragEvent) => {
      if (files(e)) {
        e.preventDefault();
        depth++;
        setDragging(true);
      }
    };
    const over = (e: DragEvent) => {
      if (files(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (files(e)) {
        depth = Math.max(0, depth - 1);
        if (!depth) setDragging(false);
      }
    };
    const reset = () => {
      depth = 0;
      setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (files(e)) e.preventDefault();
      reset();
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("blur", reset);
    };
  }, [mode, allowed]);
  useEffect(() => {
    try {
      localStorage.setItem("mp.rememberDraft", String(remember));
      if (remember)
        localStorage.setItem("mp.applicationDraft.v1", JSON.stringify(draft));
      else localStorage.removeItem("mp.applicationDraft.v1");
    } catch {
      setStorageError(
        "Browser storage is unavailable. Your draft works for this visit.",
      );
    }
  }, [draft, remember]);
  const update = (part: Partial<Draft>) => setDraft((d) => ({ ...d, ...part }));
  const upload = async (file?: File) => {
    if (!file) return;
    setApplicationError("");
    if (!/\.(md|txt)$/i.test(file.name) || file.size > 35000) {
      setApplicationError("Choose a .md or .txt file under 35 KB.");
      return;
    }
    try {
      const text = await file.text();
      if (text.includes("\0")) throw Error("Use a plain text file.");
      update({ application: text });
      setFileLabel(file.name + " loaded");
    } catch (e) {
      setApplicationError((e as Error).message);
    }
  };
  async function submit() {
    if (busy) return;
    setError("");
    setApplicationError("");
    if (
      mode === "create" &&
      allowed &&
      (draft.application.trim().length < 20 ||
        new TextEncoder().encode(draft.application).length > 35000)
    ) {
      setApplicationError(
        "Paste or upload your application (at least 20 characters, up to 35 KB).",
      );
      application.current?.focus();
      return;
    }
    setBusy(true);
    try {
      if (mode === "join") {
        onRoom(await resolveRoom(code));
        return;
      }
      if (!allowed) {
        const url = new URL(creator.trim()),
          key = new URLSearchParams(url.hash.slice(1)).get("create");
        if (url.origin !== location.origin || !key)
          throw Error("Use the private creator link for this site.");
        await request("/creator-access", {}, key);
        setCreator("");
        setConfig(await getConfig());
        return;
      }
      const result = await request<{ id: string; host: string; code: string }>(
        "/rooms",
        { ...draft, permissions, challenge: challenge.response() },
      );
      const grant = {
        id: result.id,
        key: result.host,
        code: result.code,
        program: draft.program,
      };
      saveHost(grant);
      onRoom(grant);
    } catch (e) {
      setError((e as Error).message || "Please try again.");
    } finally {
      setBusy(false);
      challenge.reset();
    }
  }
  return (
    <section id="welcome" className="welcome">
      <div className="onboarding-heading">
        <h1 id="entry-title">
          {mode === "join" ? "Join your team." : "Practice your interview."}
        </h1>
        <p>
          {mode === "join"
            ? "Enter the room code or link from your host."
            : "YC or Speedrun. Solo or with your cofounders."}
        </p>
      </div>
      <div className="entry-card">
        <Tabs.Root
          value={mode}
          onValueChange={(v) => {
            setMode(v);
            setError("");
          }}
        >
          <Tabs.List id="entry-modes" aria-label="Practice room">
            <Tabs.Trigger id="entry-create-tab" value="create">
              Create room
            </Tabs.Trigger>
            <Tabs.Trigger id="entry-join-tab" value="join">
              Join room
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="join">
            <form
              id="code-entry"
              className="code-entry"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label htmlFor="room-code">Room code or invite link</label>
              <div className="code-entry-row">
                <input
                  id="room-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="abcd-efgh-jkmp"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={100}
                  aria-invalid={!!error}
                  aria-describedby="code-error"
                />
                <button className="primary" disabled={busy}>
                  {busy ? "Opening…" : "Join room"}
                </button>
              </div>
              <ErrorText id="code-error">{error}</ErrorText>
            </form>
            {!allowed && (
              <button
                id="creator-shortcut"
                className="text-button"
                onClick={() => {
                  setMode("create");
                  setError("");
                }}
              >
                Have a creator link?
              </button>
            )}
          </Tabs.Content>
          <Tabs.Content value="create" forceMount hidden={mode !== "create"}>
            {allowed ? (
              <section id="create">
                <form
                  id="application-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <label htmlFor="draft-program">Interview</label>
                  <FieldSelect
                    id="draft-program"
                    value={draft.program}
                    onChange={(program) => update({ program })}
                    options={programs}
                  />
                  <label htmlFor="draft-application">Your application</label>
                  <ResizableTextarea
                    ref={application}
                    id="draft-application"
                    value={draft.application}
                    onChange={(e) => update({ application: e.target.value })}
                    placeholder="Paste your submitted application here…"
                    aria-invalid={!!applicationError}
                    aria-describedby="application-error"
                  />
                  <ErrorText id="application-error">
                    {applicationError}
                  </ErrorText>
                  <div className="upload-separator">
                    <span>OR</span>
                  </div>
                  <label
                    id="draft-dropzone"
                    className={
                      "upload-dropzone" + (dragging ? " is-dragging" : "")
                    }
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      if (e.dataTransfer.files.length !== 1)
                        setApplicationError("Choose one .md or .txt file.");
                      else void upload(e.dataTransfer.files[0]);
                    }}
                  >
                    <input
                      id="draft-file"
                      type="file"
                      accept=".md,.txt,text/plain,text/markdown"
                      onChange={(e) => {
                        void upload(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <span>Upload .md or .txt</span>
                    <span id="draft-upload-status" className="upload-hint">
                      {fileLabel || "Drag and drop or choose a file"}
                    </span>
                  </label>
                  <details className="interviewer-fields">
                    <summary>
                      <Icon name="chevron" /> Know your interviewer?{" "}
                      <span>Optional</span>
                    </summary>
                    <label htmlFor="draft-person">Name</label>
                    <input
                      id="draft-person"
                      maxLength={100}
                      value={draft.interviewer.name}
                      onChange={(e) =>
                        update({
                          interviewer: {
                            ...draft.interviewer,
                            name: e.target.value,
                          },
                        })
                      }
                    />
                    <label htmlFor="draft-linkedin">LinkedIn profile</label>
                    <input
                      id="draft-linkedin"
                      type="url"
                      maxLength={400}
                      value={draft.interviewer.linkedin}
                      onChange={(e) =>
                        update({
                          interviewer: {
                            ...draft.interviewer,
                            linkedin: e.target.value,
                          },
                        })
                      }
                    />
                    <label htmlFor="draft-notes">Preparation notes</label>
                    <textarea
                      id="draft-notes"
                      maxLength={3000}
                      value={draft.interviewer.notes}
                      onChange={(e) =>
                        update({
                          interviewer: {
                            ...draft.interviewer,
                            notes: e.target.value,
                          },
                        })
                      }
                    />
                  </details>
                  <div className="draft-controls">
                    <label className="check">
                      <input
                        id="remember-draft"
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                      />
                      <Icon name="check" />
                      Remember on this device
                    </label>
                    <button
                      id="forget-draft"
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setRemember(false);
                        setDraft(empty);
                        setFileLabel("");
                      }}
                    >
                      Clear saved draft
                    </button>
                  </div>
                  <ErrorText>{storageError || challenge.error}</ErrorText>
                  <ErrorText id="create-error">{error}</ErrorText>
                  <div ref={challenge.target} id="challenge" />
                  <button id="new" className="primary wide" disabled={busy}>
                    {busy ? "Creating…" : "Create practice room"}
                  </button>
                  <Legal />
                </form>
              </section>
            ) : (
              <section id="no-invite">
                <div className="creator-access-note">
                  <p>Room creation is invite-only for now.</p>
                  <form
                    id="creator-entry"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submit();
                    }}
                  >
                    <label htmlFor="creator-link">Creator link</label>
                    <input
                      id="creator-link"
                      type="password"
                      autoComplete="off"
                      value={creator}
                      onChange={(e) => setCreator(e.target.value)}
                      placeholder="Paste your private creator link"
                      aria-describedby="creator-error"
                    />
                    <ErrorText id="creator-error">{error}</ErrorText>
                    <button className="primary wide" disabled={busy}>
                      {busy ? "Checking…" : "Continue"}
                    </button>
                  </form>
                </div>
              </section>
            )}
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </section>
  );
}
