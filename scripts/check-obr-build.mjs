/**
 * Owlbear Rodeo does not resolve manifest URLs with `new URL(value, base)`.
 * It concatenates the manifest's origin and the value:
 *
 *   origin + value
 *
 * So `"background_url": "background.html"` becomes
 * `https://host.examplebackground.html` — an invalid URL that throws while
 * Owlbear builds the extension frame. Serving the extension under `/obr/` on
 * the app's origin requires every manifest path to start with `"/obr/"` (or be
 * a full URL).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = "https://extension.invalid";
const BASE_PATH = "/obr/";
const ROOT_DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const OBR_DIST = join(ROOT_DIST, "obr");
const manifestPath = join(OBR_DIST, "manifest.json");

if (!existsSync(manifestPath)) {
  fail(`No built manifest at ${manifestPath}. Run the OBR build first.`);
}

/** @type {{ icon?: string, action?: { icon?: string, popover?: string }, background_url?: string }} */
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const targets = [
  ["icon", manifest.icon],
  ["action.icon", manifest.action?.icon],
  ["action.popover", manifest.action?.popover],
  ["background_url", manifest.background_url],
];

for (const [label, value] of targets) {
  if (value === undefined) continue;
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string.`);
  if (value.startsWith("http://")) {
    fail(
      `${label} is "${value}". Hosted manifest URLs must use https:// or start with ${BASE_PATH}.`,
    );
  }
  if (!value.startsWith("https://") && !value.startsWith(BASE_PATH))
    fail(
      `${label} is "${value}". Owlbear concatenates the manifest origin and the value, and this ` +
        `extension is hosted under ${BASE_PATH}. Use "${BASE_PATH}${value.replace(/^\/+/, "")}" or a full HTTPS URL.`,
    );
  let url;
  try {
    url = new URL(value.startsWith("https://") ? value : `${ORIGIN}${value}`);
  } catch {
    fail(`${label} is "${value}", which is not a URL Owlbear can build.`);
  }
  if (value.startsWith("https://") && url.origin !== ORIGIN) continue;
  if (!existsSync(join(ROOT_DIST, decodeURIComponent(url.pathname))))
    fail(`${label} points at ${url.pathname}, which the build did not emit.`);
}

for (const runtimeFile of ["bridge-worker.js", "index.html", "background.html", "sw.js"]) {
  if (!existsSync(join(OBR_DIST, runtimeFile))) fail(`the build did not emit ${runtimeFile}.`);
}
const obrAssetsDir = join(OBR_DIST, "assets");
const obrAssets = existsSync(obrAssetsDir) ? readdirSync(obrAssetsDir) : [];
if (!obrAssets.some((file) => /^sessionWorker-.*\.js$/.test(file))) {
  fail("the OBR build did not emit a sessionWorker bundle under dist/obr/assets/.");
}
// When the full app build is present alongside /obr/, also verify shared host files.
if (existsSync(join(ROOT_DIST, "index.html"))) {
  for (const hostFile of ["_headers", "pairing-worker.js"]) {
    if (!existsSync(join(ROOT_DIST, hostFile))) {
      fail(`the app build did not emit ${hostFile} under dist/.`);
    }
  }
}

const name = manifest.name ?? "";
if (name.length === 0 || name.length > 45) fail("name must be 1–45 characters.");
if ((manifest.description ?? "").length > 128) fail("description must be 128 characters or fewer.");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const expectedVersion = pkg.version;
if (manifest.version !== expectedVersion) {
  fail(`manifest version "${manifest.version}" does not match package.json "${expectedVersion}".`);
}
for (const [relPath, pattern] of [
  ["obr/src/config.ts", /EXTENSION_VERSION\s*=\s*"([^"]+)"/],
  ["src/integration/controller.ts", /APP_VERSION\s*=\s*"([^"]+)"/],
]) {
  const source = readFileSync(join(repoRoot, relPath), "utf8");
  const match = pattern.exec(source);
  if (!match || match[1] !== expectedVersion) {
    fail(
      `${relPath} version "${match?.[1] ?? "missing"}" does not match package.json "${expectedVersion}".`,
    );
  }
}

console.log(
  `Owlbear manifest OK: ${targets.filter(([, v]) => v).length} hosted paths and version ${expectedVersion} verified.`,
);

function fail(message) {
  console.error(`Owlbear manifest check failed: ${message}`);
  process.exit(1);
}
