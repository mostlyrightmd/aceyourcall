// Explicit aliases preserve old room links and their browser-local host credentials.
// A request must still use the Origin belonging to its own Host, never another alias.
export function requestOrigin(req, canonical, aliases = "") {
  const origins = [canonical, ...aliases.split(",").map(s => s.trim()).filter(Boolean)];
  for (const value of origins) {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.origin !== value)
      throw new Error("Call origins must be absolute HTTP(S) origins without paths");
    if (req.headers.host === url.host) return url.origin;
  }
  return null;
}
