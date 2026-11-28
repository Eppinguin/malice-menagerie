import { afterEach, expect, it, vi } from "vitest";
import {
  conditionInfo,
  flushDataSignals,
  hydrateCatalogInBackground,
  hydrateConditionsInBackground,
  hydrateMaliceInBackground,
  loadMonster,
  loadSourceIndex,
  maliceLoadStatus,
  monstersVersion,
  renderGate,
} from "./data.ts";
import { blankHomebrewMalice } from "./lib/homebrew.ts";
import { homebrewMaliceId } from "./lib/id.ts";
import {
  CONDITIONS_DATA_URL,
  DATA_INDEX_URL,
  MALICE_DATA_URL,
  monsterChunkUrl,
} from "./lib/repo.ts";
import {
  activeEncounter,
  autoPickMalice,
  createEncounter,
  ensureMaliceSelection,
  maliceSelectionReady,
  mutateApp,
  relevantMaliceGroups,
  retryMalice,
  saveHomebrewMalice,
} from "./store.ts";

function indexResponse(paths: string[]): Response {
  return Response.json({ schemaVersion: 1, upstream: { sha: "test" }, paths });
}

afterEach(() => {
  renderGate.paused = false;
  flushDataSignals();
  vi.unstubAllGlobals();
});

it("keeps saved Malice pins until both the bundle and encounter statblocks load successfully", async () => {
  const malicePath = "en/unified/json/rule/monster/malice.json";
  const familyPath = "en/unified/json/monster/goblin/malice.json";
  const officialId = `${malicePath}#0`;
  const familyId = `${familyPath}#0`;
  const staleId = `${malicePath}#9`;
  const monsterPath = "en/unified/json/monster/goblin/statblock/goblin-malice-sniper.json";
  const official = { name: "Official Feature", cost: "3 Malice", body: "Gain speed." };
  const family = { name: "Family Feature", cost: "5 Malice", body: "Use a trick." };
  const fetchBundle = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(
      Response.json({
        [malicePath]: { features: [official, { ...official, cost: "three Malice" }] },
        [familyPath]: { level: 3, features: [family] },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        [malicePath]: { features: [official] },
        [familyPath]: { level: 3, features: [family] },
      }),
    );
  let resolveChunk!: (response: Response) => void;
  const chunk = new Promise<Response>((resolve) => {
    resolveChunk = resolve;
  });
  const fetchChunk = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockReturnValueOnce(chunk);
  const fetchSource = vi.fn((url: string) => {
    if (url === DATA_INDEX_URL)
      return Promise.resolve(indexResponse([malicePath, familyPath, monsterPath]));
    if (url === MALICE_DATA_URL) return fetchBundle();
    if (url === monsterChunkUrl("goblin")) return fetchChunk();
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchSource);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });

  createEncounter();
  const custom = blankHomebrewMalice("", "Custom", 1);
  custom.name = "Custom Feature";
  const customId = homebrewMaliceId(saveHomebrewMalice(custom));
  const savedIds = [officialId, familyId, staleId, customId];
  mutateApp(() => {
    const encounter = activeEncounter();
    encounter.items = [
      { id: "goblin", sourcePath: monsterPath + "@3", groupId: encounter.groups[0]!.id, count: 1 },
    ];
    encounter.combat.selectedMaliceFeatureIds = savedIds;
    encounter.combat.maliceSelectionInitialized = true;
  });

  await loadSourceIndex();
  await hydrateMaliceInBackground();
  expect(maliceLoadStatus.value).toBe("failed");
  expect(relevantMaliceGroups().map((group) => group.id)).toEqual(["custom"]);
  ensureMaliceSelection();
  autoPickMalice();
  expect(activeEncounter().combat.selectedMaliceFeatureIds).toEqual(savedIds);

  await retryMalice();
  expect(maliceLoadStatus.value).toBe("failed");
  const retry = retryMalice();
  expect(maliceLoadStatus.value).toBe("loading");
  autoPickMalice();
  expect(activeEncounter().combat.selectedMaliceFeatureIds).toEqual(savedIds);
  await Promise.all([retry, retryMalice()]);
  expect(fetchSource.mock.calls.map(([url]) => url)).toEqual([
    DATA_INDEX_URL,
    MALICE_DATA_URL,
    MALICE_DATA_URL,
    MALICE_DATA_URL,
  ]);
  expect(maliceLoadStatus.value).toBe("ready");
  await expect(loadMonster(monsterPath)).rejects.toThrow("503");
  expect(maliceSelectionReady.value).toBe(false);
  ensureMaliceSelection();
  autoPickMalice();
  expect(activeEncounter().combat.selectedMaliceFeatureIds).toEqual(savedIds);

  const loading = loadMonster(monsterPath);
  expect(maliceSelectionReady.value).toBe(false);
  ensureMaliceSelection();
  expect(activeEncounter().combat.selectedMaliceFeatureIds).toEqual(savedIds);
  resolveChunk(Response.json({ [monsterPath]: { name: "Goblin Sniper", level: 2 } }));
  await loading;
  expect(maliceSelectionReady.value).toBe(true);
  ensureMaliceSelection();
  expect(activeEncounter().combat.selectedMaliceFeatureIds).toEqual([
    officialId,
    familyId,
    customId,
  ]);
});

it("publishes condition and monster hydration updates after the Prep drag ends", async () => {
  const conditionPath = "en/unified/json/condition/slowed.json";
  const monsterPath = "en/unified/json/monster/gnoll/statblock/gnoll-marauder.json";
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === DATA_INDEX_URL) return indexResponse([conditionPath, monsterPath]);
    if (url === CONDITIONS_DATA_URL) {
      return Response.json({ [conditionPath]: { name: "Slowed", text: "**Speed** is reduced." } });
    }
    if (url === monsterChunkUrl("gnoll")) {
      return Response.json({ [monsterPath]: { name: "Gnoll Marauder", level: 2 } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  const requestFrame = vi.fn<(callback: FrameRequestCallback) => number>().mockReturnValue(1);
  vi.stubGlobal("requestAnimationFrame", requestFrame);

  await loadSourceIndex();
  const version = monstersVersion.value;
  renderGate.paused = true;
  await hydrateConditionsInBackground();
  await hydrateCatalogInBackground();
  expect(requestFrame).toHaveBeenCalledTimes(1);
  requestFrame.mock.calls[0]![0](0);
  expect(conditionInfo("Slowed")?.description).toBeNull();
  expect(monstersVersion.value).toBe(version);

  renderGate.paused = false;
  flushDataSignals();
  expect(conditionInfo("Slowed")?.description).toBe("Speed is reduced.");
  expect(monstersVersion.value).toBe(version + 1);
});
