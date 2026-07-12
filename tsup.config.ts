import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    client: "src/lib/codex-client.ts",
    react: "src/embed/index.ts",
    server: "server/attach.ts",
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
