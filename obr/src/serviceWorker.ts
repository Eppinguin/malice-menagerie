export function registerExtensionWorker(): void {
  const base = import.meta.env.BASE_URL;
  if (import.meta.env.PROD && base === "/obr/" && "serviceWorker" in navigator) {
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // Extension requests still work if storage or service workers are blocked.
    });
  }
}
