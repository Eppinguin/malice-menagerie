// Own /obr/ so open Owlbear pages never hold the app's worker active.
// With no fetch handler, all extension requests use the browser's network stack.
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
