import { setNonce } from "get-nonce";
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import Entry from "./Entry";
import Branding from "./Branding";
import { ThemeToggle } from "./Theme";
import { config, request, resolveRoom, navigateRoom, saveHost } from "./api";
import type { Config, Grant } from "./types";
import "./react.css";
import "./focus.css";
const styleNonce = document.querySelector<HTMLMetaElement>(
  'meta[name="csp-nonce"]',
)?.content;
if (styleNonce) setNonce(styleNonce);
const CallRoom = lazy(() => import("./Room"));
class Boundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="boot-status" role="alert">
        <p>This page couldn’t load.</p>
        <button onClick={() => location.reload()}>Reload</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function App() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.inputMode = "pointer";
    const pointer = () => { root.dataset.inputMode = "pointer"; };
    const keyboard = (event: KeyboardEvent) => {
      if (["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        root.dataset.inputMode = "keyboard";
      }
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
      delete root.dataset.inputMode;
    };
  }, []);
  const [settings, setSettings] = useState<Config>(),
    [grant, setGrant] = useState<Grant>(),
    [error, setError] = useState("");
  const enter = (room: Grant) => {
    navigateRoom(room);
    setGrant(room);
  };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(location.hash.slice(1));
        const creator = params.get("create"),
          id = params.get("room"),
          key = params.get("key");
        if (id && key) {
          const g = {
            id,
            key,
            program: params.get("program") || "speedrun-10",
          };
          const link = await request<{ code: string; host: boolean }>(
            `/rooms/${id}/link`,
            undefined,
            key,
          );
          if (link.host) {
            saveHost({ ...g, code: link.code });
            await request("/creator-access", { roomId: id }, key).catch(
              () => {},
            );
          }
          if (!cancelled) enter({ ...g, code: link.code });
          return;
        }
        if (location.pathname.startsWith("/r/")) {
          const g = await resolveRoom(location.pathname.slice(3));
          if (!cancelled) enter(g);
          return;
        }
        if (creator) {
          await request("/creator-access", {}, creator);
          history.replaceState(null, "", "/new");
        }
        const c = await config();
        if (!cancelled) setSettings(c);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setSettings({});
        }
      }
    })();
    const hash = () => location.reload();
    window.addEventListener("hashchange", hash);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", hash);
    };
  }, []);
  return (
    <>
      <header className="topbar">
        <a
          className="brand"
          href="/"
          aria-label="aceyourcall"
          onClick={(e) => {
            if (document.body.classList.contains("in-call")) e.preventDefault();
          }}
        >
          <img className="ace-logo" src="/aceyourcall-logo.svg" alt="aceyourcall" width="680" height="126" />
        </a>
        <div id="room-header" />
        <ThemeToggle />
      </header>
      <main>
        <Boundary>
          <Suspense
            fallback={
              <div className="boot-status" role="status">
                Opening room…
              </div>
            }
          >
            {grant ? (
              <CallRoom key={grant.id} grant={grant} />
            ) : settings ? (
              <Entry initial={settings} onRoom={enter} initialError={error} />
            ) : (
              <div className="boot-status" role="status">
                Loading…
              </div>
            )}
          </Suspense>
        </Boundary>
      </main>
      <Branding />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
