import { monstersVersion } from "../data.ts";
import { qtyFor, setQtyDraft } from "../store.ts";
import { MinusIcon, PlusIcon } from "./Icons.tsx";

export function QtyControl({ path }: { path: string }) {
  void monstersVersion.value; // subscribe: defaultQty settles as the statblock hydrates
  const qty = qtyFor(path);
  return (
    <div class="qty-control">
      <button aria-label="Fewer" onClick={() => setQtyDraft(path, qty - 1)}>
        <MinusIcon />
      </button>
      <input
        value={qty}
        inputMode="numeric"
        aria-label="Quantity"
        onChange={(event) => setQtyDraft(path, Number(event.currentTarget.value))}
      />
      <button aria-label="More" onClick={() => setQtyDraft(path, qty + 1)}>
        <PlusIcon />
      </button>
    </div>
  );
}
