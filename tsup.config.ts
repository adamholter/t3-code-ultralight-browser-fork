import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    client: "src/lib/codex-client.ts",
    assistant: "src/lib/codex-assistant.ts",
    react: "src/embed/index.ts",
    element: "src/element.ts",
    "embed-events": "src/embed-events.ts",
    "element-auto": "src/element-auto.ts",
    server: "server/attach.ts",
    doctor: "server/doctor.ts",
    integration: "server/integration-contract.ts",
    requests: "src/lib/server-requests.ts",
    standalone: "server/index.ts",
    types: "src/types.ts",
  },
  format: ["esm"],
  dts: true,
  // Published source is available in the repository; omit maps from the tiny consumer artifact.
  sourcemap: false,
  clean: true,
  splitting: false,
  outDir: "dist-lib",
  external: ["react", "react-dom"],
});
