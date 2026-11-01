import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "react/index": "src/react/index.tsx",
    "node/index": "src/node.ts",
    "cli/index": "src/cli/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  treeshake: true,
  splitting: false,
  sourcemap: false,
  external: ["react"],
});
