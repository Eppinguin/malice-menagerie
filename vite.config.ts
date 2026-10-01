import { defineConfig } from "vite";

// Vite 8 is Rolldown-powered and transforms JSX with oxc — no Babel involved.
export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "preact",
    },
  },
  server: {
     host: "127.0.0.1",
     port: 5173,
     strictPort: false,
   },
});
