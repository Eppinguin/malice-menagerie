import { watchScene } from "./sceneGuard.ts";
import { createTokenArtworkLoader, hasMappedArtwork, isLegacyTokenImage } from "./tokenArtwork.ts";
import { isBrokenInitialsImage } from "./placeholder.ts";
import { syncConditionLabels } from "./conditionLabels.ts";
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import {
  SEAMUS_TOKEN_METADATA_KEY,
  TOKEN_METADATA_KEY,
  type DesiredCombatant,
  type ImportRequest,
  type ImportResult,
  type StatblockRef,
} from "../../shared/obr/protocol.ts";
import { STATBLOCK_INDEX } from "../../shared/obr/statblockIndex.generated.ts";
import { ITEM_BATCH_SIZE, withRateLimitRetry } from "./requests.ts";
import { describeError } from "./errors.ts";
import {
  buildMappings,
  buildToken,
  collectAttachedIds,
  tokenPlacement,
  tokenScaleForSize,
  getItems,
  integrationData,
  readIntegrationToken,
  sceneSummary,
  updateTokensMetadata,
  type TokenMetadataUpdate,
  type IntegrationTokenData,
} from "./scene.ts";
import { tokenInitials, usesTokenArtwork } from "./settings.ts";
import {
  mergeRawMinionGroups,
  minionTokenData,
  monsterData,
  readMinionGroups,
  readSeamusMinionGroupId,
  readSeamusToken,
  removeMinionGroups,
  writeMinionGroups,
  type SeamusMinionGroup,
} from "./seamus.ts";

const KNOWN_STATBLOCKS = new Set(STATBLOCK_INDEX.map((entry) => entry.id));

export type ProgressFn = (
  phase: "prepare" | "tokens" | "groups" | "observe",
  done: number,
  total: number,
) => void;

interface ExistingToken {
  item: Item;
  data: IntegrationTokenData;
}

function statblockRef(combatant: DesiredCombatant, warnings: string[]): StatblockRef | null {
  const ref = combatant.statblock;
  if (!ref) return null;
  if (!KNOWN_STATBLOCKS.has(ref.resourceId)) {
    warnings.push(
      `${combatant.name}: the statblock id ${ref.resourceId} is not in the Draw Steel Tools index.`,
    );
    return null;
  }
  return ref;
}

function isImage(item: Item): boolean {
  return item.type === "IMAGE";
}

/**
 * Idempotently materialise a Malice roster on the Owlbear map.
 *
 * Identity is the integration token metadata, not the token name. Existing
 * tokens are updated in place; missing tokens are created; tokens Malice no
 * longer knows about are never deleted by an import.
 */
export async function importCombatants(
  request: ImportRequest,
  onProgress: ProgressFn,
): Promise<ImportResult> {
  const guard = watchScene();
  const loadArtwork = createTokenArtworkLoader();
  try {
    guard.bind(request.expectedSceneId);
    await withRateLimitRetry(() => guard.check());
    const summary = await withRateLimitRetry(() => sceneSummary());
    if (!summary.sceneReady || summary.sceneId !== request.expectedSceneId) {
      throw new Error("The Owlbear scene changed. Reconnect, then send again.");
    }
    await guard.check();

    const warnings: string[] = [];
    const total = request.combatants.length;
    onProgress("prepare", 0, total);

    const [initialItems, initialMetadata] = await withRateLimitRetry(() =>
      Promise.all([getItems(), OBR.scene.getMetadata()]),
    );
    const place = await tokenPlacement(initialItems, summary.gridDpi);
    const additions: { item: Item; instanceId: string }[] = [];
    const changes: TokenMetadataUpdate[] = [];
    const groups = new Map<string, SeamusMinionGroup>(
      readMinionGroups(initialMetadata).map((group) => [group.id, group]),
    );
    const changedGroups = new Set<string>();
    const byInstance = groupExisting(initialItems, request.encounterId);
    const createdInstanceIds = new Set<string>();
    const missing: { instanceId: string; tokenIds: string[] }[] = [];
    let created = 0;
    let updated = 0;

    // Prefetch distinct mapped token images concurrently before building tokens
    // so multi-monster encounters do not serialize 10s network fetches.
    if (usesTokenArtwork()) {
      const artworkToLoad = new Map<string, string>();
      for (const combatant of request.combatants) {
        if (!combatant.sourcePath || !hasMappedArtwork(combatant.sourcePath)) continue;
        const existing = ensureExisting(
          byInstance.get(combatant.instanceId) ?? [],
          initialItems,
          combatant,
          request.encounterId,
        );
        const needsNew =
          request.mode !== "reconcile" &&
          combatant.currentStamina > 0 &&
          (combatant.kind === "creature"
            ? existing.length === 0
            : existing.length < combatant.count);
        const needsRepair = existing.some((entry) => {
          if (entry.item.type !== "IMAGE") return false;
          const url = (entry.item as { image?: { url?: string } }).image?.url ?? "";
          return isLegacyTokenImage(url) || isBrokenInitialsImage(url);
        });
        if ((needsNew || needsRepair) && !artworkToLoad.has(combatant.sourcePath)) {
          artworkToLoad.set(combatant.sourcePath, combatant.name);
        }
      }
      const queue = [...artworkToLoad.entries()];
      const concurrency = Math.min(5, queue.length);
      let cursor = 0;
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (cursor < queue.length) {
            const [sourcePath, name] = queue[cursor++]!;
            try {
              await loadArtwork(sourcePath);
            } catch {
              warnings.push(`${name}: token artwork could not load; using initials instead.`);
            }
          }
        }),
      );
    }

    for (let index = 0; index < request.combatants.length; index += 1) {
      const combatant = request.combatants[index] as DesiredCombatant;
      onProgress("tokens", index, total);
      try {
        const existing = ensureExisting(
          byInstance.get(combatant.instanceId) ?? [],
          initialItems,
          combatant,
          request.encounterId,
        );
        const ref = statblockRef(combatant, warnings);
        const groupId =
          combatant.kind === "minion-squad"
            ? (combatant.minionGroupId ?? `mm-${combatant.instanceId}`)
            : null;
        const data = integrationData({
          encounterId: request.encounterId,
          instanceId: combatant.instanceId,
          entryId: combatant.entryId,
          slot: combatant.slot,
          kind: combatant.kind,
          name: combatant.name,
          minionGroupId: groupId,
        });

        if (combatant.kind === "creature") {
          if (existing.length > 1)
            warnings.push(
              `${combatant.name}: ${existing.length} tokens are linked; all of them will be kept in sync.`,
            );
          const targets = [...existing];
          if (!targets.length && combatant.currentStamina <= 0) continue;
          if (!targets.length && request.mode === "reconcile") {
            missing.push({ instanceId: combatant.instanceId, tokenIds: [] });
            continue;
          }
          if (!targets.length) {
            const { cells } = tokenScaleForSize(combatant.size);
            const item = await buildToken({
              loadArtwork,
              name: combatant.name,
              position: await place(cells),
              integration: data,
              sourcePath: combatant.sourcePath,
              size: combatant.size,
              visible: !request.hidden,
              metadata: { [SEAMUS_TOKEN_METADATA_KEY]: metadataForCreature(null, combatant, ref) },
            });
            additions.push({ item, instanceId: combatant.instanceId });
          } else {
            updated += 1;
          }
          for (const target of existing) {
            changes.push({
              item: target.item,
              metadata: {
                [SEAMUS_TOKEN_METADATA_KEY]: metadataForCreature(
                  readSeamusToken(target.item),
                  combatant,
                  ref,
                ),
                [TOKEN_METADATA_KEY]: data,
              },
              desiredName: combatant.name,
              sourcePath: combatant.sourcePath,
              repairLegacy: true,
            });
          }
        } else {
          const totalCount = Math.max(1, combatant.count);
          const individual = Math.max(
            1,
            combatant.individualStamina ?? Math.round(combatant.maxStamina / totalCount),
          );
          const desiredCount =
            combatant.currentStamina <= 0
              ? 0
              : Math.min(totalCount, Math.ceil(combatant.currentStamina / individual));
          if (existing.length > totalCount)
            warnings.push(
              `${combatant.name}: ${existing.length - totalCount} extra token${
                existing.length - totalCount === 1 ? "" : "s"
              } left on the map. Remove them by hand if the squad shrank.`,
            );
          const targets = [...existing];
          if (!targets.length && desiredCount === 0) continue;
          if (!targets.length && request.mode === "reconcile") {
            missing.push({ instanceId: combatant.instanceId, tokenIds: [] });
            continue;
          }
          if (request.mode === "reconcile" && targets.length < desiredCount) {
            warnings.push(
              `${combatant.name}: ${desiredCount - targets.length} token${
                desiredCount - targets.length === 1 ? " is" : "s are"
              } missing. Send the encounter again to recover them.`,
            );
          } else {
            const { cells } = tokenScaleForSize(combatant.size);
            const usedNumbers = new Set<number>();
            for (const entry of targets) {
              const match = /\s(\d+)$/.exec(entry.item.name);
              if (match?.[1]) usedNumbers.add(Number(match[1]));
            }
            let nextNumber = 1;
            while (targets.length < desiredCount) {
              while (usedNumbers.has(nextNumber)) nextNumber += 1;
              const slotNumber = nextNumber;
              usedNumbers.add(slotNumber);
              nextNumber += 1;
              const item = await buildToken({
                loadArtwork,
                name: `${combatant.name} ${slotNumber}`,
                position: await place(cells),
                integration: data,
                sourcePath: combatant.sourcePath,
                size: combatant.size,
                visible: !request.hidden,
                initials: tokenInitials(combatant.name, slotNumber),
                metadata: { [SEAMUS_TOKEN_METADATA_KEY]: minionTokenData(groupId as string) },
              });
              additions.push({ item, instanceId: combatant.instanceId });
              targets.push({ item, data });
            }
          }
          if (existing.length) updated += 1;
          for (const target of existing) {
            changes.push({
              item: target.item,
              metadata: {
                [SEAMUS_TOKEN_METADATA_KEY]: minionTokenData(groupId as string),
                [TOKEN_METADATA_KEY]: data,
              },
              desiredName: combatant.name,
              sourcePath: combatant.sourcePath,
              isSquad: true,
              repairLegacy: true,
            });
          }
          const previous = groups.get(groupId as string);
          changedGroups.add(groupId as string);
          groups.set(groupId as string, {
            ...previous,
            type: "MINION",
            id: groupId as string,
            name: combatant.name,
            nameTagsEnabled: previous?.nameTagsEnabled ?? true,
            currentStamina: Math.max(0, Math.round(combatant.currentStamina)),
            individualStamina: individual,
            gmOnly: previous?.gmOnly ?? true,
            ...(ref ? { statblock: ref.name, resourceId: ref.resourceId } : {}),
          });
        }
      } catch (error) {
        // Owlbear rejects through `postMessage` with a plain string or object,
        // so log the raw value: it carries the validation message.
        console.error(`Malice Menagerie: could not import ${combatant.name}`, error);
        const message = describeError(error, "the token could not be added to Owlbear");
        warnings.push(`${combatant.name}: ${message}`);
        missing.push({ instanceId: combatant.instanceId, tokenIds: [] });
      }
    }

    // Keep item ids stable across rate-limit retries. Count only confirmed writes.
    for (let offset = 0; offset < additions.length; offset += ITEM_BATCH_SIZE) {
      const batch = additions.slice(offset, offset + ITEM_BATCH_SIZE);
      try {
        await withRateLimitRetry(async () => {
          await guard.check();
          await OBR.scene.items.addItems(batch.map((entry) => entry.item));
        });
        created += batch.length;
        for (const entry of batch) createdInstanceIds.add(entry.instanceId);
      } catch (error) {
        await guard.check();
        const message = describeError(error, "Tokens could not be added to Owlbear.");
        warnings.push(message);
        for (const instanceId of new Set(batch.map((entry) => entry.instanceId))) {
          if (!missing.some((entry) => entry.instanceId === instanceId))
            missing.push({ instanceId, tokenIds: [] });
        }
      }
    }
    await updateTokensMetadata(changes, guard.check, loadArtwork);

    onProgress("groups", total, total);
    // A group may belong to another encounter still present in this scene. Only
    // retire minted groups that no token references at all.
    await withRateLimitRetry(async () => {
      await guard.check();
      const [metadata, currentItems] = await Promise.all([OBR.scene.getMetadata(), getItems()]);
      const freshGroups = readMinionGroups(metadata);
      const groupsWithTokens = new Set(
        currentItems.map(readSeamusMinionGroupId).filter((id) => id !== null),
      );
      const merged = new Map(freshGroups.map((group) => [group.id, group]));
      for (const id of changedGroups) {
        const next = groups.get(id)!;
        const fresh = merged.get(id);
        // Do not create an orphaned 0-token minion group if token creation failed.
        if (!fresh && !groupsWithTokens.has(id)) continue;
        // Only roster-owned fields change; preserve fresh display preferences.
        merged.set(id, {
          ...next,
          ...fresh,
          type: next.type,
          id: next.id,
          name: next.name,
          currentStamina: next.currentStamina,
          individualStamina: next.individualStamina,
          ...(next.statblock !== undefined ? { statblock: next.statblock } : {}),
          ...(next.resourceId !== undefined ? { resourceId: next.resourceId } : {}),
          nameTagsEnabled: fresh?.nameTagsEnabled ?? next.nameTagsEnabled,
          gmOnly: fresh?.gmOnly ?? next.gmOnly ?? true,
        });
      }
      const staleGroups = freshGroups
        .filter(
          (group) =>
            groups.has(group.id) &&
            group.id.startsWith("mm-") &&
            !changedGroups.has(group.id) &&
            !groupsWithTokens.has(group.id),
        )
        .map((group) => group.id);
      const nextGroups = removeMinionGroups([...merged.values()], staleGroups);
      if (JSON.stringify(nextGroups) !== JSON.stringify(freshGroups)) {
        await guard.check();
        await writeMinionGroups(mergeRawMinionGroups(metadata, nextGroups));
      }
    });

    onProgress("observe", total, total);
    const [items, metadata] = await withRateLimitRetry(() =>
      Promise.all([getItems(), OBR.scene.getMetadata()]),
    );
    const targets = request.combatants.filter(
      (combatant) => combatant.kind !== "minion-squad" && combatant.conditions !== undefined,
    );
    if (targets.length) {
      await syncConditionLabels(
        items,
        targets.map((combatant) => ({
          tokenIds: items
            .filter((item) => {
              const data = readIntegrationToken(item);
              return (
                data?.encounterId === request.encounterId &&
                data.instanceId === combatant.instanceId
              );
            })
            .map((item) => item.id),
          conditions: combatant.conditions!,
        })),
        summary.gridDpi,
        await withRateLimitRetry(() => OBR.room.getMetadata()),
        guard.check,
      );
    }
    await guard.check();
    const mappings = buildMappings({
      items: targets.length ? await withRateLimitRetry(() => getItems()) : items,
      groups: readMinionGroups(metadata),
      encounterId: request.encounterId,
      sceneId: summary.sceneId,
    });

    return {
      mode: request.mode,
      scene: summary,
      mappings,
      createdInstanceIds: [...createdInstanceIds],
      created,
      updated,
      missing,
      warnings,
    };
  } finally {
    guard.dispose();
  }
}

function groupExisting(items: readonly Item[], encounterId: string): Map<string, ExistingToken[]> {
  const byInstance = new Map<string, ExistingToken[]>();
  for (const item of items) {
    if (!isImage(item)) continue;
    const data = readIntegrationToken(item);
    if (!data || data.encounterId !== encounterId) continue;
    const list = byInstance.get(data.instanceId) ?? [];
    list.push({ item, data });
    byInstance.set(data.instanceId, list);
  }
  return byInstance;
}

/** Adopt tokens named by Malice's cache when their metadata is missing (for
    example a token created by an older build of this extension). Never hijack a
    token already owned by another encounter or combatant instance. */
function ensureExisting(
  existing: ExistingToken[],
  items: readonly Item[],
  combatant: DesiredCombatant,
  encounterId: string,
): ExistingToken[] {
  if (existing.length || !combatant.existingTokenIds.length) return existing;
  const wanted = new Set(combatant.existingTokenIds);
  return items
    .filter((item) => {
      if (!wanted.has(item.id) || !isImage(item)) return false;
      const owned = readIntegrationToken(item);
      if (!owned) return true;
      return owned.encounterId === encounterId && owned.instanceId === combatant.instanceId;
    })
    .map((item) => ({
      item,
      data:
        readIntegrationToken(item) ??
        integrationData({
          encounterId,
          instanceId: combatant.instanceId,
          entryId: combatant.entryId,
          slot: combatant.slot,
          kind: combatant.kind,
          name: combatant.name,
          minionGroupId: combatant.minionGroupId,
        }),
    }));
}

function metadataForCreature(
  previous: Record<string, unknown> | null,
  combatant: DesiredCombatant,
  ref: StatblockRef | null,
): Record<string, unknown> {
  const priorStatblockName =
    typeof previous?.["statblockName"] === "string" ? previous["statblockName"] : "";
  const priorResourceId =
    typeof previous?.["resourceId"] === "string" ? previous["resourceId"] : "";
  return {
    ...monsterData(previous, {
      name: combatant.name,
      stamina: combatant.currentStamina,
      staminaMaximum: combatant.maxStamina,
      statblockName: ref?.name ?? priorStatblockName,
      resourceId: ref?.resourceId ?? priorResourceId,
    }),
  };
}

/** Find the mapped token ids for an instance. */
export async function tokensForInstance(
  encounterId: string,
  instanceId: string,
): Promise<{ ids: string[]; kind: DesiredCombatant["kind"] | null; groupId: string | null }> {
  const items = await getItems();
  const tokens = items.filter((item) => {
    const data = readIntegrationToken(item);
    return data?.encounterId === encounterId && data.instanceId === instanceId;
  });
  const first = tokens[0];
  return {
    ids: tokens.map((token) => token.id),
    kind: first ? (readIntegrationToken(first)?.kind ?? null) : null,
    groupId: first ? readSeamusMinionGroupId(first) : null,
  };
}

/** Remove this encounter's tokens for the given instances. Never touches
    tokens without this integration's metadata. */
export async function cleanupInstances(
  encounterId: string,
  instanceIds: readonly string[],
  expectedSceneId: string,
): Promise<{ deleted: number; groupIds: string[] }> {
  const guard = watchScene();
  try {
    guard.bind(expectedSceneId);
    await withRateLimitRetry(() => guard.check());
    const items = await withRateLimitRetry(() => getItems());
    const doomed = items.filter((item) => {
      const data = readIntegrationToken(item);
      return (
        data !== null && data.encounterId === encounterId && instanceIds.includes(data.instanceId)
      );
    });
    if (!doomed.length) return { deleted: 0, groupIds: [] };
    const groupIds = [
      ...new Set(
        doomed
          .map((item) => readSeamusMinionGroupId(item))
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    // Delete attached rings, labels, and Marked! descendants explicitly
    // instead of relying only on cascade deletion.
    const allIds = collectAttachedIds(
      items,
      doomed.map((item) => item.id),
    );
    for (let offset = 0; offset < allIds.length; offset += ITEM_BATCH_SIZE) {
      const ids = allIds.slice(offset, offset + ITEM_BATCH_SIZE);
      await withRateLimitRetry(async () => {
        await guard.check();
        await OBR.scene.items.deleteItems(ids);
      });
    }
    if (groupIds.length) {
      const deletedIds = new Set(allIds);
      await withRateLimitRetry(async () => {
        await guard.check();
        const [metadata, remainingItems] = await Promise.all([OBR.scene.getMetadata(), getItems()]);
        const inUse = new Set(
          remainingItems
            .filter((item) => !deletedIds.has(item.id))
            .map(readSeamusMinionGroupId)
            .filter((id): id is string => id !== null),
        );
        const unused = groupIds.filter((id) => !inUse.has(id));
        if (!unused.length) return;
        const groups = removeMinionGroups(readMinionGroups(metadata), unused);
        await guard.check();
        await writeMinionGroups(mergeRawMinionGroups(metadata, groups));
      });
    }
    return { deleted: doomed.length, groupIds };
  } finally {
    guard.dispose();
  }
}
