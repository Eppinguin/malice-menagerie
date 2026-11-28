function storageKey(key: string): string {
  return `malice-menagerie/disclosure/${key}`;
}

export function readDisclosure(key: string): string | null {
  try {
    return localStorage.getItem(storageKey(key));
  } catch {
    return null;
  }
}

export function writeDisclosure(key: string, value: string): void {
  try {
    localStorage.setItem(storageKey(key), value);
  } catch {
    // The current page can still honor the choice when storage is unavailable.
  }
}
