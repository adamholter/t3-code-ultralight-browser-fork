import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    client: "src/lib/codex-client.ts",
    react: "src/embed/index.ts",
    element: "src/element.ts",
    "element-auto": "src/element-auto.ts",
    server: "server/attach.ts",
    doctor: "server/doctor.ts",
    requests: "src/lib/server-requests.ts",
    standalone: "server/index.ts",
    types: "src/types.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  outDir: "dist-lib",
  external: ["react", "react-dom"],
});
