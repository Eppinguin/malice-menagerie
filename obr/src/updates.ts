import { syncConditionLabels } from "./conditionLabels.ts";
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import {
  SEAMUS_TOKEN_METADATA_KEY,
  TOKEN_METADATA_KEY,
  type CombatantUpdate,
  type StatblockRef,
} from "../../shared/obr/protocol.ts";
import { STATBLOCK_INDEX } from "../../shared/obr/statblockIndex.generated.ts";
import {
  getItems,
  integrationData,
  readIntegrationToken,
  updateTokensMetadata,
  type TokenMetadataUpdate,
} from "./scene.ts";
import {
  mergeRawMinionGroups,
  minionTokenData,
  monsterData,
  readMinionGroups,
  readSeamusMinionGroupId,
  readSeamusToken,
  writeMinionGroups,
  type SeamusMinionGroup,
} from "./seamus.ts";
import { withRateLimitRetry } from "./requests.ts";
import { watchScene } from "./sceneGuard.ts";
import { individualStaminaFor } from "./minionStamina.ts";

const KNOWN_STATBLOCKS = new Set(STATBLOCK_INDEX.map((entry) => entry.id));

export interface AppliedUpdate {
  instanceId: string;
  kind: "creature" | "minion-squad";
  currentStamina: number;
  maxStamina: number;
  name: string;
  tokenIds: string[];
  conditions?: string[];
}

function knownStatblock(ref: StatblockRef | null): StatblockRef | null {
  return ref && KNOWN_STATBLOCKS.has(ref.resourceId) ? ref : null;
}

/**
 * Push Malice values into the tokens and Seamus metadata.
 *
 * A squad's total Stamina is split back into the per-minion value Seamus
 * stores. Missing tokens are reported, never recreated here; recovery is an
 * explicit import.
 */
export async function applyUpdates(
  encounterId: string,
  updates: readonly CombatantUpdate[],
  expectedSceneId: string,
): Promise<{ applied: AppliedUpdate[]; warnings: string[]; groupChanged: boolean }> {
  const guard = watchScene();
  try {
    guard.bind(expectedSceneId);
    await withRateLimitRetry(() => guard.check());
    const items = await withRateLimitRetry(() => getItems());
    const groupUpdates = new Map<
      string,
      Pick<
        SeamusMinionGroup,
        "name" | "currentStamina" | "individualStamina" | "statblock" | "resourceId"
      >
    >();
    const byInstance = new Map<string, Item[]>();
    for (const item of items) {
      const data = readIntegrationToken(item);
      if (!data || data.encounterId !== encounterId) continue;
      const list = byInstance.get(data.instanceId) ?? [];
      list.push(item);
      byInstance.set(data.instanceId, list);
    }

    // Deduplicate by instanceId (last-wins) so duplicate entries in one batch
    // never spawn duplicate condition labels or redundant writes.
    const uniqueUpdates = [...new Map(updates.map((u) => [u.instanceId, u])).values()];

    const applied: AppliedUpdate[] = [];
    const changes: TokenMetadataUpdate[] = [];
    const warnings: string[] = [];
    let groupChanged = false;

    for (const update of uniqueUpdates) {
      const tokens = byInstance.get(update.instanceId) ?? [];
      if (!tokens.length) {
        warnings.push(`${update.name}: no token in this scene.`);
        continue;
      }
      const first = tokens[0] as Item;
      const data = readIntegrationToken(first);
      if (!data) continue;
      const ref = knownStatblock(update.statblock);
      const dataNext = integrationData({
        ...data,
        name: update.name,
      });

      if (data.kind === "minion-squad") {
        const groupId = readSeamusMinionGroupId(first) ?? data.minionGroupId;
        if (!groupId) {
          warnings.push(`${update.name}: the minion group is missing.`);
          continue;
        }
        const count = Math.max(1, tokens.length);
        const individual = individualStaminaFor(update, count);
        groupUpdates.set(groupId, {
          name: update.name,
          currentStamina: Math.max(0, Math.round(update.currentStamina)),
          individualStamina: individual,
          ...(ref ? { statblock: ref.name, resourceId: ref.resourceId } : {}),
        });
        groupChanged = true;
        for (const token of tokens) {
          changes.push({
            item: token,
            metadata: {
              [SEAMUS_TOKEN_METADATA_KEY]: minionTokenData(groupId),
              [TOKEN_METADATA_KEY]: dataNext,
            },
            desiredName: update.name,
          });
        }
        applied.push({
          instanceId: update.instanceId,
          kind: "minion-squad",
          currentStamina: Math.max(0, Math.round(update.currentStamina)),
          maxStamina: individual * count,
          name: update.name,
          tokenIds: tokens.map((token) => token.id),
        });
      } else {
        for (const token of tokens) {
          const previous = readSeamusToken(token);
          const priorName =
            typeof previous?.["statblockName"] === "string" ? previous["statblockName"] : "";
          const priorId =
            typeof previous?.["resourceId"] === "string" ? previous["resourceId"] : "";
          changes.push({
            item: token,
            metadata: {
              [SEAMUS_TOKEN_METADATA_KEY]: monsterData(previous, {
                name: update.name,
                stamina: update.currentStamina,
                staminaMaximum: update.maxStamina,
                statblockName: ref?.name ?? priorName,
                resourceId: ref?.resourceId ?? priorId,
              }),
              [TOKEN_METADATA_KEY]: dataNext,
            },
            desiredName: update.name,
          });
        }
        applied.push({
          ...(update.conditions !== undefined ? { conditions: update.conditions } : {}),
          instanceId: update.instanceId,
          kind: "creature",
          currentStamina: Math.max(0, Math.round(update.currentStamina)),
          maxStamina: Math.max(0, Math.round(update.maxStamina)),
          name: update.name,
          tokenIds: tokens.map((token) => token.id),
        });
      }
    }

    await updateTokensMetadata(changes, guard.check);
    const conditionTargets = uniqueUpdates.flatMap((update) => {
      if (update.conditions === undefined) return [];
      const tokens = byInstance.get(update.instanceId) ?? [];
      const first = tokens[0];
      if (!first || readIntegrationToken(first)?.kind === "minion-squad") return [];
      return [{ tokenIds: tokens.map((token) => token.id), conditions: update.conditions }];
    });
    if (conditionTargets.length) {
      const dpi = await withRateLimitRetry(() => OBR.scene.grid.getDpi());
      await syncConditionLabels(
        items,
        conditionTargets,
        dpi,
        await withRateLimitRetry(() => OBR.room.getMetadata()),
        guard.check,
      );
    }
    if (groupChanged)
      await withRateLimitRetry(async () => {
        await guard.check();
        const metadata = await OBR.scene.getMetadata();
        const freshGroups = readMinionGroups(metadata);
        const merged = new Map(freshGroups.map((group) => [group.id, group]));
        for (const [id, patch] of groupUpdates) {
          merged.set(id, {
            nameTagsEnabled: true,
            gmOnly: true,
            ...merged.get(id),
            ...patch,
            type: "MINION",
            id,
          });
        }
        await guard.check();
        await writeMinionGroups(mergeRawMinionGroups(metadata, [...merged.values()]));
      });
    await guard.check();
    return { applied, warnings, groupChanged };
  } finally {
    guard.dispose();
  }
}
