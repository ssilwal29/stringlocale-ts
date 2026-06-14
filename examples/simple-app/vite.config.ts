import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// This example lives inside the stringlocale repo, so it resolves the package
// straight from source — no build step needed, always reflects the latest src.
// In a real app you'd just `import { ... } from "stringlocale"` after install.
const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "stringlocale/react": src("../../src/react/index.tsx"),
      stringlocale: src("../../src/index.ts"),
    },
  },
});
