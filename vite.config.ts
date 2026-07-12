import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  // The shipped standalone chat uses Preact's React-compatible runtime. Tests
  // stay on real React so the exported React wrapper keeps direct coverage.
  plugins: mode === "test" ? [react()] : [preact()],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4174",
      "/ws": { target: "ws://127.0.0.1:4174", ws: true },
    },
  },
}));
