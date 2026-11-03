import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const assets = new Map();
// Only call with a server-allowlisted public asset path.
export function sendStatic(req, res, file, nonce, canonicalOrigin) {
  const path = "public/" + file;
  const stat = statSync(path);
  const version = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  let asset = assets.get(file);
  if (!asset || asset.version !== version) {
    const raw = readFileSync(path);
    const text = /\.(html|css|js)$/.test(file);
    asset = { version, raw, gzip: text ? gzipSync(raw) : null };
    asset.hash = createHash("sha256").update(raw).digest("hex");
    assets.set(file, asset);
  }
  const gzipAllowed = String(req.headers["accept-encoding"] || "")
    .split(",")
    .some((part) => {
      const [name, ...parameters] = part.trim().split(";");
      const quality = parameters.find((p) => p.trim().startsWith("q="));
      return (
        name.toLowerCase() === "gzip" &&
        (!quality || Number(quality.trim().slice(2)) > 0)
      );
    });
  const html = file.endsWith(".html");
  const raw =
    html && nonce
      ? Buffer.from(
          asset.raw
            .toString()
            .replaceAll("https://practice.mostlyright.md", canonicalOrigin || "https://practice.mostlyright.md")
            .replace(
              "</head>",
              `<meta name="csp-nonce" content="${nonce}"></head>`,
            ),
        )
      : asset.raw;
  const compressed =
    gzipAllowed && (html && nonce ? gzipSync(raw) : asset.gzip);
  const body = compressed || raw;
  const tag = `"${asset.hash}-${compressed ? "gzip" : "raw"}"`;
  res.setHeader("Vary", "Accept-Encoding");
  if (compressed) res.setHeader("Content-Encoding", "gzip");
  // HTML and all dynamic/private responses remain no-store. Public assets
  // revalidate on every navigation, so a deploy is visible without a hard refresh.
  if (!file.endsWith(".html")) {
    res.setHeader(
      "Cache-Control",
      /^app\/assets\/[\w-]+-[\w-]{8,}\.(js|css)$/.test(file)
        ? "public, max-age=31536000, immutable"
        : "public, no-cache",
    );
    res.setHeader("ETag", tag);
    const matches = String(req.headers["if-none-match"] || "")
      .split(",")
      .map((v) => v.trim().replace(/^W\//, ""));
    if (matches.includes(tag) || matches.includes("*")) {
      res.statusCode = 304;
      return res.end();
    }
  }
  res.setHeader("Content-Length", body.length);
  return res.end(body);
}
