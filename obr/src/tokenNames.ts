/**
 * Token naming policy, kept free of the Owlbear SDK so it can be unit tested.
 *
 * Malice is authoritative for the name this integration writes, but a name the
 * GM typed into Owlbear is theirs. A rename in Malice follows through only
 * while the token still carries the name this integration last wrote (including
 * numbered minion squad slots such as `"Goblin Spinecleaver 2"`).
 */
export function syncedMinionSlot(
  currentName: string,
  lastSyncedName: string | null,
): number | null {
  if (!lastSyncedName || !currentName.startsWith(`${lastSyncedName} `)) return null;
  const suffix = currentName.slice(lastSyncedName.length + 1);
  if (!/^[1-9]\d*$/.test(suffix)) return null;
  return Number(suffix);
}

export function shouldRenameToken(
  currentName: string,
  lastSyncedName: string | null,
  isSquad = false,
): boolean {
  return (
    lastSyncedName === null ||
    currentName === lastSyncedName ||
    (isSquad && syncedMinionSlot(currentName, lastSyncedName) !== null)
  );
}

export function renamedTokenTarget(
  currentName: string,
  lastSyncedName: string | null,
  desiredName: string,
  isSquad = false,
): { name: string; slotNumber: number | null } | null {
  if (lastSyncedName === null) {
    if (isSquad) {
      const match = /\s([1-9]\d*)$/.exec(currentName);
      if (match?.[1]) {
        const slotNumber = Number(match[1]);
        return { name: `${desiredName} ${slotNumber}`, slotNumber };
      }
    }
    return { name: desiredName, slotNumber: null };
  }
  if (currentName === lastSyncedName) {
    return { name: desiredName, slotNumber: null };
  }
  if (isSquad) {
    const slotNumber = syncedMinionSlot(currentName, lastSyncedName);
    if (slotNumber !== null) {
      return { name: `${desiredName} ${slotNumber}`, slotNumber };
    }
  }
  return null;
}
