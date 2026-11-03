import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ command }) => ({
  root: "frontend",
  base: command === "serve" ? "/" : "/app/",
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "../public/app",
    emptyOutDir: true,
    sourcemap: false,
    manifest: true,
  },
  server: {
    proxy: Object.fromEntries(
      [
        "/aceyourcall-logo.svg",
        "/favicon.svg",
        "/config",
        "/rooms",
        "/room-code",
        "/creator-access",
        "/call.css",
        "/entry.css",
        "/entry-coast.webp",
        "/theme.js",
        "/theme.css",
        "/theme-dark.png",
        "/theme-light.png",
        "/seeam-noor.png",
        "/caption-worklet.js",
        "/terms",
        "/privacy",
      ].map((path) => [path, "http://localhost:4320"]),
    ),
  },
}));
