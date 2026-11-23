import { defineConfig } from "vite";

function urlPath(relative: string): string {
  const path = decodeURIComponent(new URL(relative, import.meta.url).pathname);
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

/**
 * Browser harness build: the real popover and background pages with the
 * Owlbear SDK swapped for an in-memory stand-in, plus a fake Malice window.
 * It exists to exercise pairing and the SharedWorker port hand-off in a real
 * browser; it is not part of the extension that ships.
 *
 *   pnpm build:obr-harness
 *   serve obr/harness-dist at an origin root, then follow
 *   HARNESS.md.
 */
const root = urlPath(".");
const sdkStub = urlPath("./src/harness/fakeObr.ts");

export default defineConfig({
  cacheDir: urlPath("../node_modules/.vite-obr-harness"),
  root,
  base: "./",
  publicDir: "public",
  worker: {
    format: "es",
  },
  resolve: { alias: [{ find: /^@owlbear-rodeo\/sdk$/, replacement: sdkStub }] },
  build: {
    outDir: "harness-dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: [
        "index.html",
        "background.html",
        "harness.html",
        "harness-malice.html",
        "spike.html",
        "spike-peer.html",
      ],
    },
  },
});
