import { defineConfig } from "vite";

function urlPath(relative: string): string {
  const path = decodeURIComponent(new URL(relative, import.meta.url).pathname);
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

/**
 * The Owlbear Rodeo companion extension is a separate multi-page build that
 * shares framework-free bridge modules from `shared/obr/` and no app UI code.
 * It is emitted into `dist/obr/` so both the app (`/`) and extension (`/obr/`)
 * deploy atomically from one static site origin.
 */
export default defineConfig({
  // The app and extension run concurrently from the same package. Sharing
  // Vite's dependency cache can leave one serving 504 Outdated Optimize Dep.
  cacheDir: urlPath("../node_modules/.vite-obr"),
  root: "obr",
  base: "/obr/",
  publicDir: "public",
  worker: {
    format: "es",
  },
  build: {
    outDir: "../dist/obr",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: ["index.html", "background.html"],
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: false,
    cors: {
      origin: "https://www.owlbear.rodeo",
    },
  },
});
