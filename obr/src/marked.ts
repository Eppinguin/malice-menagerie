import OBR, {
  buildPath,
  buildText,
  type Image,
  type Item,
  type Metadata,
} from "@owlbear-rodeo/sdk";
import { conditionFromLabel } from "../../shared/obr/conditionLabels.ts";
import { newMessageId } from "../../shared/obr/protocol.ts";
import { ITEM_BATCH_SIZE, withRateLimitRetry } from "./requests.ts";
import { tokenBounds } from "./scene.ts";

/** Marked! 1.81, verified against its public assets main-GpSq_1UL.js and
 * style-Dql21iiH.js on 2026-11-16. Root PATH items carry the marker name;
 * their TEXT and optional counter controls attach beneath that root.
 */
export const MARKED_NAMESPACE = "com.battle-system.mark";
export const MARKED_CONFIG_KEY = `${MARKED_NAMESPACE}/m`;
export const MARKED_LEGACY_CONFIG_KEY = `${MARKED_NAMESPACE}/metadata_marks`;
const DIRECTION_KEY = `${MARKED_NAMESPACE}/direction`;
const PLACE_KEY = `${MARKED_NAMESPACE}/place`;
const DIRECTIONS = { Top: 601, Bottom: 602, Right: 603, Left: 604 } as const;
type Direction = keyof typeof DIRECTIONS;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
const records = (value: unknown): RecordValue[] =>
  Array.isArray(value)
    ? value.map(record).filter((entry): entry is RecordValue => entry !== null)
    : [];
const number = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
const override = (primary: unknown, fallback: unknown): unknown =>
  primary === undefined || primary === null || primary === "" ? fallback : primary;

export interface MarkedConfig {
  labels: RecordValue[];
  groups: RecordValue[];
  fontSize: unknown;
  opacity: unknown;
  stroke: unknown;
}

/** Current compact room settings plus both legacy representations. Never write settings. */
export function readMarkedConfig(metadata: Metadata): MarkedConfig | null {
  const modern = record(record(metadata[MARKED_CONFIG_KEY])?.["s"]);
  const legacy = record(metadata[MARKED_LEGACY_CONFIG_KEY]);
  const compact = modern ?? record(legacy?.["s"]);
  if (compact && Array.isArray(compact["l"]))
    return {
      labels: records(compact["l"]).map((entry) => ({
        Name: entry["n"],
        Direction: entry["d"],
        Color: entry["c"],
        Group: entry["g"],
      })),
      groups: records(compact["g"]).map((entry) => ({
        Num: entry["n"],
        TextSizeOverride: entry["ts"],
        BgOpacityOverride: entry["bo"],
        OutlineStrokeOverride: entry["os"],
      })),
      fontSize: compact["d"],
      opacity: compact["o"],
      stroke: compact["s"],
    };
  const saved = record(legacy?.["saveData"]);
  return saved && Array.isArray(saved["Labels"])
    ? {
        labels: records(saved["Labels"]),
        groups: records(saved["Groups"]),
        fontSize: saved["Distance"],
        opacity: saved["Opacity"],
        stroke: saved["Stroke"],
      }
    : null;
}

export function isMarkedRoot(item: Item): boolean {
  return (
    item.type === "PATH" &&
    typeof item.metadata[DIRECTION_KEY] === "number" &&
    Object.values(DIRECTIONS).some((direction) => direction === item.metadata[DIRECTION_KEY]) &&
    typeof item.metadata[PLACE_KEY] === "number" &&
    typeof item.metadata[`${MARKED_NAMESPACE}/comboid`] === "string"
  );
}

export function readMarkedConditions(
  items: readonly Item[],
  tokenIds: readonly string[],
): string[] {
  const ids = new Set(tokenIds);
  return [
    ...new Set(
      items
        .filter((item) => item.attachedTo && ids.has(item.attachedTo) && isMarkedRoot(item))
        .map((item) => conditionFromLabel(item.name))
        .filter((name): name is string => name !== null),
    ),
  ].sort();
}

export async function syncMarkedConditions(
  items: readonly Item[],
  targets: readonly { tokenIds: readonly string[]; conditions?: readonly string[] }[],
  dpi: number,
  config: MarkedConfig | null,
  beforeWrite: () => Promise<void> = async () => {},
): Promise<void> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const additions: Item[] = [];
  const deletions = new Set<string>();
  let outline: string | undefined;
  let measureContext: CanvasRenderingContext2D | null | undefined;
  for (const target of targets) {
    if (target.conditions === undefined) continue;
    const desired = [
      ...new Set(
        target.conditions.map(conditionFromLabel).filter((name): name is string => name !== null),
      ),
    ];
    for (const id of target.tokenIds) {
      const item = byId.get(id);
      if (item?.type !== "IMAGE") continue;
      const token = item as Image;
      const roots = items.filter((entry) => entry.attachedTo === id && isMarkedRoot(entry));
      for (const root of roots) {
        const condition = conditionFromLabel(root.name);
        if (condition && !desired.includes(condition)) deletions.add(root.id);
      }
      for (const condition of desired) {
        if (roots.some((root) => conditionFromLabel(root.name) === condition)) continue;
        const label = config?.labels.find(
          (entry) =>
            typeof entry["Name"] === "string" && conditionFromLabel(entry["Name"]) === condition,
        );
        const name = typeof label?.["Name"] === "string" ? label["Name"] : condition;
        const direction: Direction =
          typeof label?.["Direction"] === "string" && Object.hasOwn(DIRECTIONS, label["Direction"])
            ? (label["Direction"] as Direction)
            : "Top";
        const group = config?.groups.find((entry) => entry["Num"] === label?.["Group"]);
        const fontSize = number(
          override(group?.["TextSizeOverride"], config?.fontSize),
          36,
          8,
          200,
        );
        const opacity =
          number(override(group?.["BgOpacityOverride"], config?.opacity), 85, 0, 100) / 100;
        const stroke = number(override(group?.["OutlineStrokeOverride"], config?.stroke), 4, 0, 20);
        const color =
          typeof label?.["Color"] === "string" &&
          /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(label["Color"])
            ? label["Color"]
            : "#FFFFFF";
        let place = 0;
        const siblings = [
          ...roots.filter((root) => !deletions.has(root.id)),
          ...additions.filter((entry) => entry.attachedTo === id && isMarkedRoot(entry)),
        ];
        while (
          siblings.some(
            (root) =>
              root.metadata[DIRECTION_KEY] === DIRECTIONS[direction] &&
              root.metadata[PLACE_KEY] === place,
          )
        )
          place += 1;
        // Measure the text once, avoiding per-marker Owlbear bounds requests.
        if (measureContext === undefined) {
          measureContext =
            typeof document === "undefined"
              ? null
              : document.createElement("canvas").getContext("2d");
        }
        if (measureContext) measureContext.font = `600 ${fontSize}px Roboto`;
        const width =
          Math.ceil(measureContext?.measureText(name).width ?? [...name].length * fontSize * 0.7) +
          20;
        const height = Math.ceil(fontSize * 1.4) + 10;
        const bounds = tokenBounds(token, dpi);
        const { left, top, width: tokenWidth, height: tokenHeight, centerX, centerY } = bounds;
        const gap = (height + 8) * place;
        const position =
          direction === "Top"
            ? { x: centerX - width / 2, y: top - height - 20 - gap }
            : direction === "Bottom"
              ? { x: centerX - width / 2, y: top + tokenHeight + 20 + gap }
              : direction === "Left"
                ? { x: left - width - 15, y: centerY - height / 2 - gap }
                : { x: left + tokenWidth + 15, y: centerY - height / 2 + gap };
        const rootId = newMessageId();
        const metadata = {
          [DIRECTION_KEY]: DIRECTIONS[direction],
          [PLACE_KEY]: place,
          [`${MARKED_NAMESPACE}/comboid`]: rootId,
        };
        outline ??= await withRateLimitRetry(() => OBR.player.getColor()).catch(() => "#ffffff");
        const root = buildPath()
          .id(rootId)
          .name(name)
          .layer("TEXT")
          .attachedTo(id)
          .position(position)
          .commands([[0, 0, 0], [1, width, 0], [1, width, height], [1, 0, height], [5]])
          .fillColor("#242424")
          .fillOpacity(opacity)
          .strokeColor(outline)
          .strokeOpacity(1)
          .strokeWidth(stroke)
          .metadata(metadata)
          .visible(token.visible)
          .locked(true)
          .disableAttachmentBehavior(["ROTATION", "SCALE"])
          .build();
        const text = buildText()
          .name(name)
          .attachedTo(rootId)
          .position(position)
          .plainText(name)
          .textType("PLAIN")
          .width(width)
          .height(height)
          .fontFamily("Roboto")
          .fontSize(fontSize)
          .fontWeight(600)
          .textAlign("CENTER")
          .textAlignVertical("MIDDLE")
          .fillColor(color)
          .fillOpacity(opacity)
          .strokeColor("#000000")
          .strokeWidth(1.75)
          .strokeOpacity(1)
          .metadata(metadata)
          .visible(token.visible)
          .locked(true)
          .disableHit(true)
          .disableAttachmentBehavior(["ROTATION", "SCALE"])
          .build();
        additions.push(root, text);
      }
    }
  }
  // Include marker text and nested counter controls, without relying on cascade deletion.
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const item of items)
      if (item.attachedTo && deletions.has(item.attachedTo) && !deletions.has(item.id)) {
        deletions.add(item.id);
        expanded = true;
      }
  }
  const ids = [...deletions];
  for (let offset = 0; offset < ids.length; offset += ITEM_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + ITEM_BATCH_SIZE);
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
