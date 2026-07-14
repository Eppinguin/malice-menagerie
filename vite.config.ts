import { defineConfig } from "vite";

// Vite 8 is Rolldown-powered and transforms JSX with oxc — no Babel involved.
export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "preact",
    },
  },
});
