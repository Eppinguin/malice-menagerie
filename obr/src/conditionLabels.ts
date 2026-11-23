import {
  isMarkedRoot,
  readMarkedConditions,
  readMarkedConfig,
  syncMarkedConditions,
} from "./marked.ts";
import OBR, {
  buildLabel,
  type Image,
  type Item,
  type Label,
  type Metadata,
} from "@owlbear-rodeo/sdk";
import { conditionFromLabel } from "../../shared/obr/conditionLabels.ts";
import { newMessageId } from "../../shared/obr/protocol.ts";
import { ITEM_BATCH_SIZE, withRateLimitRetry } from "./requests.ts";
import { tokenBounds } from "./scene.ts";
import { conditionSyncMode, type ConditionSyncMode } from "./settings.ts";

/** External contract verified against condition-labels commit 7228a36f1cb7eb70717a81cab5b763c36f506a3d.
 * Upstream uses attached LABEL items with `${tokenId}-label-*` ids and no metadata.
 */
export function tokenConditionLabels(items: readonly Item[], tokenId: string): Label[] {
  return items.filter(
    (item): item is Label =>
      item.type === "LABEL" &&
      item.attachedTo === tokenId &&
      item.id.startsWith(`${tokenId}-label-`),
  );
}

export function readLabelConditions(
  items: readonly Item[],
  tokenIds: readonly string[],
  mode: ConditionSyncMode = conditionSyncMode(),
): string[] {
  if (mode === "off") return [];
  const marked = mode === "token-labels" ? [] : readMarkedConditions(items, tokenIds);
  const labels =
    mode === "marked"
      ? []
      : tokenIds.flatMap((id) =>
          tokenConditionLabels(items, id)
            .map((label) => conditionFromLabel(label.text.plainText))
            .filter((name): name is string => name !== null),
        );
  return [...new Set([...marked, ...labels])].sort();
}

/** Preserve unrelated annotations and existing emoji/duration/style choices.
 * Optional conditions keep older bridge clients from clearing existing labels.
 */
export async function syncConditionLabels(
  items: readonly Item[],
  targets: readonly { tokenIds: readonly string[]; conditions?: readonly string[] }[],
  dpi: number,
  roomMetadata: Metadata = {},
  beforeWrite: () => Promise<void> = async () => {},
  mode: ConditionSyncMode = conditionSyncMode(),
): Promise<void> {
  if (mode === "off") return;
  const markedConfig = mode === "token-labels" ? null : readMarkedConfig(roomMetadata);
  const useMarked =
    mode === "marked" || (mode === "auto" && (markedConfig !== null || items.some(isMarkedRoot)));
  if (useMarked) {
    await syncMarkedConditions(items, targets, dpi, markedConfig, beforeWrite);
  } else if (items.some(isMarkedRoot)) {
    // Switching from Marked! to Token Labels must also clear stale Marked!
    // condition markers so both representations do not coexist.
    await syncMarkedConditions(
      items,
      targets
        .filter((target) => target.conditions !== undefined)
        .map((target) => ({ tokenIds: target.tokenIds, conditions: [] })),
      dpi,
      null,
      beforeWrite,
    );
  }
  const additions: Label[] = [];
  const deletions: string[] = [];
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const target of targets) {
    if (target.conditions === undefined) continue;
    const desired = useMarked
      ? []
      : [
          ...new Set(
            target.conditions
              .map(conditionFromLabel)
              .filter((name): name is string => name !== null),
          ),
        ];
    for (const id of target.tokenIds) {
      const item = byId.get(id);
      if (item?.type !== "IMAGE") continue;
      const token = item as Image;
      const labels = tokenConditionLabels(items, id);
      const retained = labels.filter((label) => {
        const name = conditionFromLabel(label.text.plainText);
        if (!name || desired.includes(name)) return true;
        deletions.push(label.id);
        return false;
      });
      let index = 0;
      const occupied = retained.flatMap((label) => (label.position ? [label.position] : []));
      for (const name of desired) {
        if (retained.some((label) => conditionFromLabel(label.text.plainText) === name)) continue;
        const { left, top } = tokenBounds(token, dpi);
        // Match upstream's default left/top positioning and stacking order,
        // accounting for both centered and top-left-anchored tokens.
        const positionAt = (slot: number) => {
          const row = slot === 1 ? -1 : slot > 1 ? slot - 1 : 0;
          return {
            x: left,
            y: top + 15 - row * 35,
          };
        };
        let position = positionAt(index);
        while (
          occupied.some(
            (point) => Math.abs(point.x - position.x) < 1 && Math.abs(point.y - position.y) < 30,
          )
        ) {
          position = positionAt(++index);
        }
        occupied.push(position);
        additions.push(
          buildLabel()
            .id(`${id}-label-malice-${name.toLowerCase()}-${newMessageId()}`)
            .attachedTo(id)
            .position(position)
            .plainText(name)
            .fontSize(16)
            .fontFamily("Roboto, sans-serif")
            .fontWeight(400)
            .pointerHeight(0)
            .pointerDirection("LEFT")
            .minViewScale(1)
            .maxViewScale(1)
            .fillOpacity(0.87)
            .backgroundOpacity(0.9)
            .cornerRadius((dpi / 150) * 6)
            .padding((dpi / 150) * 2)
            .layer("TEXT")
            .locked(false)
            .visible(token.visible)
            .disableAttachmentBehavior(["ROTATION", "COPY", "SCALE"])
            .disableHit(false)
            .metadata({})
            .build(),
        );
        index += 1;
      }
    }
  }
  for (let offset = 0; offset < deletions.length; offset += ITEM_BATCH_SIZE) {
    const batch = deletions.slice(offset, offset + ITEM_BATCH_SIZE);
    await withRateLimitRetry(async () => {
      await beforeWrite();
      await OBR.scene.items.deleteItems(batch);
    });
  }
  for (let offset = 0; offset < additions.length; offset += ITEM_BATCH_SIZE) {
    const batch = additions.slice(offset, offset + ITEM_BATCH_SIZE);
    await withRateLimitRetry(async () => {
      await beforeWrite();
      await OBR.scene.items.addItems(batch);
    });
  }
}
