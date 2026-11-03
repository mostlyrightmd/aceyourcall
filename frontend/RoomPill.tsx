import { useEffect, useState } from "react";
import type { Grant } from "./types";
import { request } from "./api";
import { Icon, IconButton } from "./ui";
export default function RoomPill({ grant, count }: { grant: Grant; count?: number }) {
  const [presence, setPresence] = useState<{code?: string; count: number | null}>({code: grant.code, count: null});
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await request<{code: string; count: number | null}>(`/rooms/${grant.id}/presence`, undefined, grant.key);
        if (!disposed) setPresence(result);
      } catch { if (!disposed) setPresence(p => ({...p, count: null})); }
      if (!disposed && count === undefined) timer = setTimeout(poll, 10000);
    };
    if (count === undefined || !grant.code) void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [grant.id, grant.key, grant.code, count]);
  useEffect(() => {
    if (!copyStatus) return;
    const timer = setTimeout(() => setCopyStatus(""), 2500);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const copyCode = async () => {
    if (!presence.code) return;
    try { await navigator.clipboard.writeText(presence.code); setCopyStatus("Room code copied"); }
    catch { setCopyStatus("Could not copy. Select the room code to copy it."); }
  };
  return (
<div className="prejoin-room-pill" aria-label="Room details">
        <span className="room-pill-label">Room:</span>
        <span className="room-pill-code">{presence.code || "…"}</span>
        <IconButton icon={copyStatus === "Room code copied" ? "check" : "copy"} label="Copy room code" onClick={() => void copyCode()} disabled={!presence.code} />
        <span className="room-pill-divider" aria-hidden="true" />
        <span className="room-pill-count" aria-label={`${count ?? presence.count ?? "Unknown number of"} people in room`} title="People currently connected">
          <Icon name="users" />
          {(count ?? presence.count) === null ? "—" : count ?? presence.count}
        </span>
        <span className="sr-only" role="status">{copyStatus}</span>
      </div>
  );
}
