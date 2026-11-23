import type { Encounter } from "../types.ts";
import { LIMITS, type InitiativeState } from "../../shared/obr/protocol.ts";

const MAX_TURNS = 9;

export function desiredInitiative(
  encounter: Encounter,
  linkedIds: ReadonlySet<string>,
): InitiativeState {
  const round = Number.isFinite(encounter.combat.round)
    ? Math.min(10_000, Math.max(1, Math.round(encounter.combat.round)))
    : 1;
  return {
    encounterId: encounter.id,
    round,
    combatants: encounter.combat.instances
      .filter((instance) => linkedIds.has(instance.id))
      .map((instance) => {
        const turns = Number.isFinite(instance.turns)
          ? Math.min(100, Math.max(1, Math.round(instance.turns)))
          : 1;
        const turnsTaken = Number.isFinite(instance.turnsTaken)
          ? Math.min(turns, Math.max(0, Math.round(instance.turnsTaken)))
          : 0;
        const rawGroupName =
          encounter.groups.find((group) => group.id === instance.groupId)?.name ?? "Ungrouped";
        return {
          instanceId: instance.id,
          groupId: instance.groupId,
          groupName: (rawGroupName.trim() || "Ungrouped").slice(0, LIMITS.groupNameLength),
          turns,
          turnsTaken,
        };
      })
      .sort((a, b) => a.instanceId.localeCompare(b.instanceId)),
  };
}

/** Apply a round correction with the same Malice gain/refund as the round
 * controls. Expired effects cannot be restored when the round moves backwards. */
export function applyInitiative(encounter: Encounter, incoming: InitiativeState): void {
  const combat = encounter.combat;
  const oldRound = combat.round;
  const newRound = incoming.round;
  if (newRound !== oldRound) {
    const gain = (round: number) => round * encounter.party.heroes + (round * (round + 1)) / 2;
    combat.malice = Math.max(0, combat.malice + gain(newRound) - gain(oldRound));
    if (newRound > oldRound)
      combat.activeEffects = combat.activeEffects.filter(
        (effect) => effect.expiresRound >= newRound,
      );
    combat.round = newRound;
    for (const instance of combat.instances) {
      instance.turnsTaken = 0;
      instance.reactions = [];
    }
  }
  for (const update of incoming.combatants) {
    const instance = combat.instances.find((instance) => instance.id === update.instanceId);
    if (!instance) continue;
    let group = encounter.groups.find((group) => group.id === update.groupId);
    if (!group) {
      group = { id: update.groupId, name: update.groupName };
      encounter.groups.push(group);
    } else group.name = update.groupName;
    instance.groupId = group.id;
    const turns = Math.max(1, Math.min(MAX_TURNS, Math.round(update.turns)));
    instance.turns = turns;
    instance.turnsTaken = Math.max(0, Math.min(turns, Math.round(update.turnsTaken)));
  }
  // Carry regrouping back to Prep when all copies of an entry moved together.
  for (const entry of encounter.items) {
    const copies = combat.instances.filter((instance) => instance.entryId === entry.id);
    if (copies.length && copies.every((instance) => instance.groupId === copies[0]!.groupId))
      entry.groupId = copies[0]!.groupId;
  }
  encounter.updatedAt = Date.now();
}
