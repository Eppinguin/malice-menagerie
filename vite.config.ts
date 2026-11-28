import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

function listFiles(dir: string, excludeDir?: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    if (file === excludeDir) return [];
    return entry.isDirectory() ? listFiles(file, excludeDir) : [file];
  });
}

function relativeUrl(dir: string, file: string): string {
  return relative(dir, file).split(sep).join("/");
}

/**
 * Precache the whole build (app shell, hashed assets, bundled compendium) so
 * Malice Menagerie runs offline after the first visit. The manifest is written
 * from what the build actually emitted, and its content hash versions the
 * cache: any asset or data change installs a new service worker.
 *
 * The Owlbear extension under /obr/ is deliberately excluded — it is versioned
 * and updated on its own, and `public/_headers` marks it `no-cache`.
 */
function offlineBundle(): Plugin {
  let dist = "";
  let dataDir = "";
  return {
    name: "malice-menagerie-offline",
    apply: "build",
    enforce: "post",
    config(config) {
      const root = resolve(config.root ?? ".");
      const source = resolve(root, config.publicDir || "public", "data");
      const hash = createHash("sha256");
      for (const file of listFiles(source).sort()) {
        const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
        hash.update(relativeUrl(source, file)).update("\0").update(digest);
      }
      // A worker can claim a page safely because both lazy JS and snapshot
      // requests identify their exact contents in the URL.
      dataDir = `assets/compendium-${hash.digest("hex").slice(0, 16)}`;
      return { define: { __COMPENDIUM_DATA_ROOT__: JSON.stringify(`/${dataDir}/`) } };
    },
    configResolved(config) {
      // Honor `vite build --outDir` (and any config override) instead of
      // assuming the default `dist`.
      dist = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const root = fileURLToPath(new URL(".", import.meta.url));
      if (!dist || !existsSync(dist)) {
        throw new Error(`offline bundle: build output directory ${dist || "(unknown)"} is missing`);
      }
      const source = join(dist, "data");
      const snapshot = join(dist, dataDir);
      if (!existsSync(source)) throw new Error(`offline bundle: snapshot ${source} is missing`);
      // With emptyOutDir disabled, the same hash can already exist. Publish
      // this build's complete copy so the manifest reflects the current bytes.
      rmSync(snapshot, { recursive: true, force: true });
      renameSync(source, snapshot);

      const precached = listFiles(dist, join(dist, "obr"))
        .map((file) => ({ file, name: relativeUrl(dist, file) }))
        .filter(({ name }) => name !== "sw.js" && name !== "_headers" && !name.endsWith(".map"))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!precached.some(({ name }) => name === "index.html")) return; // not the app build

      const manifest = precached.map(({ file, name }) => ({
        // Cloudflare Pages redirects /index.html to the canonical root.
        url: name === "index.html" ? "/" : `/${name}`,
        integrity: `sha256-${createHash("sha256").update(readFileSync(file)).digest("base64")}`,
      }));
      const manifestJson = JSON.stringify(manifest, null, 2);

      // Hash only what the cache actually holds, so rebuilding without a
      // content change keeps the same version (and does not reinstall). The
      // service-worker template is included so a caching-logic change also
      // rolls the cache.
      const template = readFileSync(join(root, "scripts", "sw-template.js"), "utf8");
      const version = createHash("sha256")
        .update(template)
        .update("\0")
        .update(manifestJson)
        .digest("hex")
        .slice(0, 16);
      writeFileSync(
        join(dist, "sw.js"),
        template.replace("__VERSION__", version).replace("__PRECACHE__", manifestJson),
      );
    },
  };
}

// Vite 8 is Rolldown-powered and transforms JSX with oxc — no Babel involved.
export default defineConfig({
  plugins: [offlineBundle()],
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
