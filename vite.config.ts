import { defineConfig } from "vite";

// Vite 8 is Rolldown-powered and transforms JSX with oxc — no Babel involved.
export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "preact",
    },
  },
  worker: {
    format: "es",
  },
  // `public/_headers` is only honored by Cloudflare/Netlify, not `vite preview`.
  // Owlbear fetches /obr/manifest.json cross-origin from owlbear.rodeo.
  preview: {
    cors: { origin: "https://www.owlbear.rodeo" },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
  },
});
