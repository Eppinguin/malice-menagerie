import { monstersVersion } from "../data.ts";
import { qtyFor, setQtyDraft } from "../store.ts";

export function QtyControl({ path }: { path: string }) {
  void monstersVersion.value; // subscribe: defaultQty settles as the statblock hydrates
  const qty = qtyFor(path);
  return (
    <div class="qty-control">
      <button onClick={() => setQtyDraft(path, qty - 1)}>−</button>
      <input
        value={qty}
        inputMode="numeric"
        aria-label="Quantity"
        onChange={(event) => setQtyDraft(path, Number(event.currentTarget.value))}
      />
      <button onClick={() => setQtyDraft(path, qty + 1)}>+</button>
    </div>
  );
}
