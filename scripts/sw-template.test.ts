import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * The service worker is hand-written (not a module), so exercise its lifecycle
 * handlers in a sandbox. These tests pin the update contract: an incomplete
 * install must never activate, and an update must never take over or clear the
 * build an open tab is still running.
 */

const TEMPLATE = readFileSync(new URL("./sw-template.js", import.meta.url), "utf8");
const CACHE = "malice-menagerie-test";
const BUILD_RESPONSE = "build response";

interface CacheStore {
  entries: Map<string, unknown>;
}

interface Harness {
  install: () => Promise<unknown>;
  activate: () => Promise<unknown>;
  fetch: (path: string, mode?: string) => Promise<Response> | undefined;
  stores: Map<string, CacheStore>;
  installRequests: Request[];
  deleted: string[];
  claims: number;
  skips: number;
}

function harness(options: {
  precache?: string[];
  fetchImpl?: (request: string | Request) => Promise<Response>;
  existing?: string[];
  cacheFailure?: "match";
}): Harness {
  type Handler = (event: {
    waitUntil: (p: Promise<unknown>) => void;
    request: { url: string; mode: string; method: string };
    respondWith: (p: Promise<Response>) => void;
  }) => void;
  const handlers = new Map<string, Handler>();
  const origin = "https://menagerie.example";
  const stores = new Map<string, CacheStore>(
    (options.existing ?? []).map((name) => [name, { entries: new Map() }]),
  );
  const deleted: string[] = [];
  const installRequests: Request[] = [];
  let claims = 0;
  let skips = 0;
  const cacheKey = (request: string | Request): string =>
    new URL(typeof request === "string" ? request : request.url, origin).pathname;

  const cacheStorage = {
    keys: async () => [...stores.keys()],
    match: async (request: string | Request, matchOptions: { cacheName?: string }) => {
      if (options.cacheFailure === "match") throw new Error("cache unavailable");
      const key = cacheKey(request);
      if (matchOptions.cacheName) return stores.get(matchOptions.cacheName)?.entries.get(key);
      return [...stores.values()].find((store) => store.entries.has(key))?.entries.get(key);
    },
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, { entries: new Map() });
      const store = stores.get(name) as CacheStore;
      return {
        keys: async () =>
          [...store.entries.keys()].map((path) => new Request(new URL(path, origin))),
        addAll: async (requests: Request[]) => {
          installRequests.push(...requests);
          const entries = await Promise.all(
            requests.map(async (request) => {
              const path = cacheKey(request);
              const response = await fetchImpl(path);
              if (!response.ok) throw new Error(`Precache request failed for ${path}`);
              // Check the supplied digest with native Fetch before committing the batch.
              const bytes = Buffer.from(await response.arrayBuffer()).toString("base64");
              const checked = await fetch(`data:application/octet-stream;base64,${bytes}`, {
                integrity: request.integrity,
              });
              return [path, checked] as const;
            }),
          );
          for (const [path, response] of entries) store.entries.set(path, response);
        },
      };
    },
    delete: async (name: string) => {
      deleted.push(name);
      return stores.delete(name);
    },
  };

  const self = {
    location: { origin },
    addEventListener: (type: string, handler: Handler) => {
      handlers.set(type, handler);
    },
    clients: {
      claim: async () => {
        claims += 1;
      },
    },
    skipWaiting: async () => {
      skips += 1;
    },
  };

  const fetchImpl = options.fetchImpl ?? (async () => new Response(BUILD_RESPONSE));
  const context = createContext({
    self,
    caches: cacheStorage,
    fetch: fetchImpl,
    console,
    URL,
    Request,
    Response,
  });
  const source = TEMPLATE.replace("__VERSION__", "test").replace(
    "__PRECACHE__",
    JSON.stringify(
      (options.precache ?? ["/"]).map((url) => ({
        url,
        integrity: `sha256-${createHash("sha256").update(BUILD_RESPONSE).digest("base64")}`,
      })),
    ),
  );
  runInContext(source, context);

  const dispatch = (type: string): Promise<unknown> => {
    const handler = handlers.get(type);
    if (!handler) throw new Error(`no ${type} handler`);
    const waits: Promise<unknown>[] = [];
    handler({
      waitUntil: (promise) => waits.push(promise),
      request: { url: origin, mode: "navigate", method: "GET" },
      respondWith: () => {},
    });
    return Promise.all(waits);
  };

  return {
    install: () => dispatch("install"),
    activate: () => dispatch("activate"),
    fetch: (path, mode = "same-origin") => {
      let response: Promise<Response> | undefined;
      handlers.get("fetch")?.({
        request: { url: new URL(path, origin).href, mode, method: "GET" },
        respondWith: (promise) => {
          response = promise;
        },
        waitUntil: () => {},
      });
      return response;
    },
    stores,
    installRequests,
    deleted,
    get claims() {
      return claims;
    },
    get skips() {
      return skips;
    },
  };
}

describe("service worker lifecycle", () => {
  it("reuses the HTTP cache for fingerprinted assets and reloads mutable URLs", async () => {
    const sw = harness({
      precache: [
        "/",
        "/malice-menagerie-mark.svg",
        "/assets/app.js",
        "/assets/compendium-v1/index.json",
      ],
    });
    await sw.install();
    expect(
      sw.installRequests.map((request) => [new URL(request.url).pathname, request.cache]),
    ).toEqual([
      ["/", "reload"],
      ["/malice-menagerie-mark.svg", "reload"],
      ["/assets/app.js", "default"],
      ["/assets/compendium-v1/index.json", "default"],
    ]);
  });

  it("rejects an incomplete install without committing any entries", async () => {
    const sw = harness({
      precache: ["/", "/assets/app.js"],
      fetchImpl: async (url) => {
        if (url === "/assets/app.js") throw new Error("network down");
        return new Response(BUILD_RESPONSE);
      },
    });
    await expect(sw.install()).rejects.toThrow("network down");
    expect(sw.stores.get(CACHE)?.entries.size).toBe(0);
    expect(sw.deleted).toEqual([]);
  });

  it("leaves the previous cache untouched when an install fails", async () => {
    const sw = harness({
      existing: ["malice-menagerie-old"],
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    await expect(sw.install()).rejects.toThrow();
    expect(sw.stores.has("malice-menagerie-old")).toBe(true);
  });

  it("reuses a complete same-version cache during a rollback", async () => {
    const sw = harness({
      existing: [CACHE, "malice-menagerie-next"],
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    const response = new Response(BUILD_RESPONSE);
    sw.stores.get(CACHE)?.entries.set("/", response);
    await sw.install();
    expect(sw.stores.get(CACHE)?.entries.get("/")).toBe(response);
    expect(sw.deleted).toEqual([]);
  });

  it("preserves the active same-version cache when a rollback repair fails", async () => {
    const sw = harness({
      existing: [CACHE, "malice-menagerie-next"],
      precache: ["/", "/assets/app.js", "/assets/studio.js"],
      fetchImpl: async (path) => {
        if (path === "/assets/studio.js") throw new Error("network down");
        return new Response(BUILD_RESPONSE);
      },
    });
    const response = new Response(BUILD_RESPONSE);
    sw.stores.get(CACHE)?.entries.set("/", response);
    await expect(sw.install()).rejects.toThrow("network down");
    expect([...sw.stores.get(CACHE)!.entries]).toEqual([["/", response]]);
    expect(sw.deleted).toEqual([]);
  });

  it.each([
    ["/", "a newer app shell"],
    ["/data/index.json", "newer compendium data"],
    ["/assets/app.js", "<html>SPA fallback for a missing asset</html>"],
  ])("rejects unexpected 200 response bytes at %s", async (path, body) => {
    const previous = "malice-menagerie-old";
    const sw = harness({
      precache: ["/", "/data/index.json", "/assets/app.js"],
      existing: [previous],
      fetchImpl: async (request) => new Response(request === path ? body : BUILD_RESPONSE),
    });
    await expect(sw.install()).rejects.toThrow();
    expect(sw.stores.get(CACHE)?.entries.size).toBe(0);
    expect(sw.stores.has(previous)).toBe(true);
  });

  it("never skips waiting, so an open tab keeps the build it loaded", async () => {
    const sw = harness({});
    await sw.install();
    expect(sw.skips).toBe(0);
    expect(sw.stores.get(CACHE)?.entries.has("/")).toBe(true);
  });

  it("claims the first open tab after precaching and cleans up old caches on activation", async () => {
    const first = harness({});
    await first.install();
    await first.activate();
    expect(first.claims).toBe(1);
    expect(first.stores.has(CACHE)).toBe(true);

    const update = harness({ existing: ["malice-menagerie-old"] });
    await update.install();
    await update.activate();
    expect(update.claims).toBe(1);
    expect(update.stores.has("malice-menagerie-old")).toBe(false);
    expect(update.stores.has(CACHE)).toBe(true);
  });
});

describe("service worker fetch", () => {
  it("leaves Owlbear navigations to the host, including the bare extension path", async () => {
    const sw = harness({});
    await sw.install();
    expect(sw.fetch("/obr?room=1", "navigate")).toBeUndefined();
    expect(sw.fetch("/obr/", "navigate")).toBeUndefined();
    expect(sw.fetch("/obr/manifest.json")).toBeUndefined();
    expect(sw.fetch("/pairing-worker.js")).toBeUndefined();
    expect(await (await sw.fetch("/obr-guide", "navigate"))?.text()).toBe(BUILD_RESPONSE);
  });

  it("serves navigation and data from the active build during an update", async () => {
    const dataPath = "/assets/compendium-current/index.json";
    const futurePath = "/assets/compendium-next/index.json";
    const sw = harness({
      precache: ["/", dataPath],
      existing: ["malice-menagerie-next"],
      fetchImpl: async (request) =>
        new Response(typeof request === "string" ? BUILD_RESPONSE : "deployed build"),
    });
    const next = sw.stores.get("malice-menagerie-next")?.entries;
    next?.set("/", new Response("next shell"));
    next?.set(futurePath, new Response("next data"));
    await sw.install();

    expect(await (await sw.fetch("/?encounter=1", "navigate"))?.text()).toBe(BUILD_RESPONSE);
    expect(await (await sw.fetch(dataPath))?.text()).toBe(BUILD_RESPONSE);
    expect(sw.fetch(futurePath)).toBeUndefined();
    expect(sw.fetch("/data/index.json")).toBeUndefined();
  });

  it("serves direct asset navigations from their own cache entries", async () => {
    const icon = "/malice-menagerie-mark.svg";
    const data = "/assets/compendium-current/index.json";
    const sw = harness({ precache: ["/", icon, data] });
    await sw.install();
    const cached = sw.stores.get(CACHE)?.entries;
    cached?.set(icon, new Response("SVG bytes"));
    cached?.set(data, new Response("JSON bytes"));

    expect(await (await sw.fetch(icon, "navigate"))?.text()).toBe("SVG bytes");
    expect(await (await sw.fetch(data, "navigate"))?.text()).toBe("JSON bytes");
    expect(await (await sw.fetch("/index.html", "navigate"))?.text()).toBe(BUILD_RESPONSE);
    expect(sw.fetch(`${icon}?download=1`, "navigate")).toBeUndefined();
    expect(sw.fetch("/assets/unknown", "navigate")).toBeUndefined();
    expect(sw.fetch("/sw.js", "navigate")).toBeUndefined();
  });

  it.each(["missing", "unavailable"])(
    "fetches the original navigation when cache is %s",
    async (state) => {
      const network = new Response("network shell");
      const sw = harness({
        ...(state === "unavailable" ? { cacheFailure: "match" } : {}),
        fetchImpl: async (request) => {
          expect(request).toEqual({
            url: "https://menagerie.example/encounter?view=1",
            mode: "navigate",
            method: "GET",
          });
          return network;
        },
      });
      expect(await sw.fetch("/encounter?view=1", "navigate")).toBe(network);
    },
  );

  it("serves missing data from the network without adding it to the verified cache", async () => {
    const sw = harness({ existing: [CACHE], precache: ["/", "/data/index.json"] });
    expect(await (await sw.fetch("/data/index.json"))?.text()).toBe(BUILD_RESPONSE);
    expect(sw.stores.get(CACHE)?.entries.size).toBe(0);
  });
});
