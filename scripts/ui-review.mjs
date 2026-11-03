import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = process.cwd();
const screens = [
  ["/", "Landing"],
  ["/new", "Application"],
  ["/join", "Join by code"],
  ["/r/prejoin", "Camera preview"],
  ["/r/ready", "Interviewer ready"],
  ["/r/research", "Research in progress"],
  ["/r/call-three", "Three participants"],
  ["/r/call-four", "Four participants"],
  ["/r/queue", "Queue"],
  ["/r/transcript", "Transcript"],
  ["/r/scorecard", "Scorecard"],
  ["/r/score-error", "Scorecard error"],
  ["/r/reconnecting", "Reconnecting"],
  ["/r/context", "Company context"],
  ["/terms", "Terms"],
  ["/privacy", "Privacy"],
];
const server = await createServer({
  configFile: false,
  root: resolve("frontend"),
  base: "/",
  publicDir: false,
  resolve: {
    alias: [{ find: "./engine", replacement: resolve("review/engine.ts") }],
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.UI_REVIEW_PORT || 4318),
    strictPort: true,
    proxy: {},
  },
  plugins: [
    react(),
    {
      name: "local-ui-review",
      enforce: "pre",
      transform(code, id) {
        if (id.split("?")[0] === resolve("frontend/main.tsx"))
          return (
            `import ${JSON.stringify("/@fs/" + resolve("review/bootstrap.ts"))};\n` +
            code
          );
      },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          const path = new URL(req.url, "http://localhost").pathname;
          if (path === "/review") {
            res.setHeader("Content-Type", "text/html");
            res.end(
              `<!doctype html><meta charset="utf-8"><title>AceYourCall · UI review</title><style>body{background:#101010;color:#eee;font:16px system-ui;max-width:1000px;margin:64px auto;padding:24px}h1{font-size:36px}p{color:#aaa}nav{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:32px}a{color:#eee;text-decoration:none;padding:24px;background:#222;border-radius:12px}a:hover{background:#333}small{display:block;color:#999;margin-top:8px}</style><h1>UI review</h1><p>Real components. Synthetic people and data. No devices, API calls or production writes.</p><p>Edit frontend files to see updates here instantly. Restart with <code>npm run ui:review</code>.</p><nav>${screens.map(([url, label]) => `<a href="${url}" target="_blank">${label}<small>${url}</small></a>`).join("")}</nav>`,
            );
            return;
          }
          if (path === "/stats") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({completedInterviews: 24})); return; }
          const file =
            path === "/" ? "landing.html" :
            path === "/terms"
              ? "terms.html"
              : path === "/privacy"
                ? "privacy.html"
                : [
                      "/call.css",
                      "/entry.css",
                      "/entry-coast.webp",
                      "/theme.js",
                      "/theme.css",
                      "/favicon.svg", "/favicon-16.png", "/favicon-32.png", "/favicon-180.png", "/aceyourcall-logo.svg", "/landing.css", "/landing.js", "/analytics.js", "/og-lighthouse.png", "/og-light-minimal.png", "/x-light-minimal.png",
                      "/theme-dark.png",
                      "/theme-light.png",
                      "/seeam-noor.png",
                    ].includes(path)
                  ? path.slice(1)
                  : null;
          if (file) {
            res.setHeader(
              "Content-Type",
              file.endsWith(".js")
                ? "text/javascript"
                : file.endsWith(".css")
                  ? "text/css"
                  : file.endsWith(".html")
                    ? "text/html"
                    : file.endsWith(".webp")
                      ? "image/webp"
                      : file.endsWith(".svg") ? "image/svg+xml" : "image/png",
            );
            res.end(readFileSync(resolve(root, "public", file)));
            return;
          }
          next();
        });
      },
    },
  ],
});
await server.listen();
console.log(`UI review: http://localhost:${server.config.server.port}/review`);
