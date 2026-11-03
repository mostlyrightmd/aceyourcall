import type { Config, Grant } from "./types";
export async function request<T>(
  path: string,
  data?: unknown,
  key?: string,
  timeout = 15000,
): Promise<T> {
  const response = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: "Bearer " + key } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(timeout),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Request failed. Please try again.");
  return body as T;
}
export const config = () => request<Config>("/config");
export function saveHost(grant: Grant) {
  try {
    localStorage.setItem(
      "mp-host:" + grant.id,
      JSON.stringify({
        key: grant.key,
        program: grant.program,
        expires: Date.now() + 7 * 86400000,
      }),
    );
  } catch {}
}
function storedHost(id: string) {
  try {
    const saved = JSON.parse(localStorage.getItem("mp-host:" + id) || "null");
    if (
      typeof saved?.key === "string" &&
      Number.isFinite(saved.expires) &&
      saved.expires + 6 * 86400000 > Date.now()
    )
      return saved as { key: string; program?: string };
    localStorage.removeItem("mp-host:" + id);
  } catch {}
  return null;
}
export async function resolveRoom(value: string): Promise<Grant> {
  let code = value.trim();
  if (code.startsWith("http")) {
    const url = new URL(code);
    if (url.origin !== location.origin || !url.pathname.startsWith("/r/"))
      throw new Error("Enter a room code or a practice room link.");
    code = url.pathname.slice(3);
  }
  const result = await request<{ id: string; guest: string; code: string }>(
    "/room-code",
    { code },
  );
  const saved = storedHost(result.id);
  let key = saved?.key || result.guest;
  if (key !== result.guest) {
    try {
      const verified = await request<{ host: boolean }>(
        "/rooms/" + result.id + "/link",
        undefined,
        key,
      );
      if (!verified.host) throw Error("Host grant expired");
      saveHost({
        id: result.id,
        key,
        program: saved?.program || "speedrun-10",
      });
      await request("/creator-access", { roomId: result.id }, key).catch(
        () => {},
      );
    } catch {
      localStorage.removeItem("mp-host:" + result.id);
      key = result.guest;
    }
  }
  return {
    id: result.id,
    key,
    code: result.code,
    program: saved?.program || "speedrun-10",
  };
}
export function roomUrl(grant: Grant) {
  return location.origin + "/r/" + grant.code;
}
export function navigateRoom(grant: Grant) {
  if (grant.code) history.replaceState(null, "", "/r/" + grant.code);
}
