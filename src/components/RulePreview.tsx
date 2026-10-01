import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { loadRule, rulePreview } from "../lib/rulePreview.ts";
import type { RuleDoc } from "../lib/rulePreview.ts";
import { escapeHtml } from "../lib/text.ts";
import { ExternalIcon } from "./Icons.tsx";

/** Mirrors `.rule-preview` in the stylesheet. */
const CARD_W = 320;
const GUTTER = 12;
const HOVER_DELAY = 200;
const HIDE_DELAY = 140;
/** Longer once pinned: the pointer has a gap to cross on its way in. */
const PINNED_HIDE_DELAY = 320;
/**
 * Pressed to take hold of the card with a mouse; it is inert to the pointer
 * otherwise. A press, not a hold: the card stays pinned until the pointer
 * leaves it, because Shift held over a wheel turns the scroll sideways.
 */
const PIN_KEY = "Shift";

/**
 * The rule, read in place. One delegated set of listeners covers every
 * cross-reference on the page: they arrive as HTML inside statblock and
 * Malice text, so there are thousands of them and no component per link.
 * Controls that stand for a rule (a condition ringed on a slip) opt in with
 * `data-rule-preview`, `data-rule-path` and `data-rule-url`: they preview on
 * hover and focus like a term, but a click stays theirs.
 *
 * The app's own short hints use the same card: an element with `data-hint`
 * (the card's heading) and `data-hint-body` opens it on hover and focus, and
 * on a touch screen a tap opens it and a second tap puts it away.
 *
 * Hover or focus opens it; the second tap on a touch screen (or a click) still
 * goes to the page, so the full rule is never more than one gesture away.
 *
 * With a mouse the card is a glance: the pointer passes through it, so it never
 * sits in the way of the statblock underneath. Pressing Shift pins it, and a
 * pinned card takes the pointer until it leaves, so it can be scrolled and its link followed.
 * A tap pins it from the start — on a touch screen there is no hover to lose.
 */
export function RulePreview() {
  const anchor = rulePreview.value;
  const [doc, setDoc] = useState<RuleDoc | null>(null);
  const [pending, setPending] = useState(false);
  const [top, setTop] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!anchor) return;
    if (anchor.inline) {
      setDoc(anchor.inline);
      setPending(false);
      return;
    }
    let live = true;
    setDoc(null);
    setPending(true);
    void loadRule(anchor.path).then((result) => {
      if (!live) return;
      setDoc(result);
      setPending(false);
    });
    return () => {
      live = false;
    };
  }, [anchor?.path]);

  // The card is as tall as the rule needs, and only the long ones scroll, so
  // which side of the term it can sit on is only known once it is measured.
  // Only ever `top` is set: pinning both edges of a fixed box would stretch it
  // to fill the space between them instead of hugging the rule.
  useLayoutEffect(() => {
    if (!anchor) {
      setTop(null);
      return;
    }
    const height = card.current?.offsetHeight ?? 0;
    const below = anchor.linkBottom + 10;
    const above = anchor.linkTop - 10 - height;
    setTop(
      below + height + GUTTER <= window.innerHeight
        ? below
        : above >= GUTTER
          ? above
          : Math.max(GUTTER, window.innerHeight - height - GUTTER),
    );
    const scroller = body.current;
    setOverflows(!!scroller && scroller.scrollHeight > scroller.clientHeight + 1);
  }, [anchor, doc, pending]);

  useEffect(() => {
    let openTimer = 0;
    let hideTimer = 0;
    let described: HTMLElement | null = null;
    /** How the last press was made, since a click event cannot report it. */
    let pointerType = "mouse";
    /** The term whose card a tap opened, so the next tap follows the link. */
    let armed = "";
    /** The hint whose card a tap opened, so the next tap puts it away. */
    let armedHint: HTMLElement | null = null;
    /** A pinned card takes the pointer and stays up while it is inside. */
    let pinned = false;
    /**
     * Whether Shift is down, as the mouse last reported it. Pointer events
     * carry the true modifier state, so a keyup lost to a focus change or the
     * window manager cannot leave every later card opening pinned.
     */
    let pinHeld = false;

    const inCard = (target: EventTarget | null): boolean =>
      target instanceof Element && !!target.closest(".rule-preview");

    const linkOf = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element) || inCard(target)) return null;
      return target.closest<HTMLElement>(
        "a.rule-link[data-rule-path], [data-rule-preview][data-rule-path], [data-hint]",
      );
    };
    const urlOf = (link: HTMLElement): string =>
      link instanceof HTMLAnchorElement ? link.href : link.dataset.ruleUrl || "";

    const stopTimers = (): void => {
      window.clearTimeout(openTimer);
      window.clearTimeout(hideTimer);
    };

    const pin = (next: boolean): void => {
      pinned = next;
      setPinned(next);
    };

    const close = (): void => {
      stopTimers();
      armed = "";
      armedHint = null;
      pin(false);
      described?.removeAttribute("aria-describedby");
      described = null;
      rulePreview.value = null;
    };

    const hide = (): void => {
      stopTimers();
      hideTimer = window.setTimeout(close, pinned ? PINNED_HIDE_DELAY : HIDE_DELAY);
    };

    const open = (link: HTMLElement, pinOpen: boolean): void => {
      stopTimers();
      const hint = link.dataset.hint;
      const path = link.dataset.rulePath ?? (hint ? `hint:${hint}|${link.dataset.hintBody ?? ""}` : "");
      if (!path) return;
      if (link !== described) pin(pinOpen);
      else if (pinOpen) pin(true);
      const rect = link.getBoundingClientRect();
      const width = Math.min(CARD_W, window.innerWidth - GUTTER * 2);
      described?.removeAttribute("aria-describedby");
      described = link;
      link.setAttribute("aria-describedby", "rule-preview");
      rulePreview.value = {
        path,
        url: urlOf(link),
        label: (link.textContent || "").trim(),
        ...(hint ? { inline: { name: hint, kind: "", html: escapeHtml(link.dataset.hintBody ?? "") } } : {}),
        x: Math.max(GUTTER, Math.min(rect.left, window.innerWidth - width - GUTTER)),
        linkTop: rect.top,
        linkBottom: rect.bottom,
      };
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerType === "mouse") pinHeld = event.shiftKey;
    };

    const onPointerOver = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse") return;
      pinHeld = event.shiftKey;
      // Back on the card, or back on its own term: whatever was leaving, isn't.
      if (inCard(event.target)) {
        if (pinned) stopTimers();
        return;
      }
      const link = linkOf(event.target);
      if (!link) return;
      if (link === described && rulePreview.value) {
        stopTimers();
        return;
      }
      // A pinned card is being reached for; terms crossed on the way are not
      // a request to swap it out.
      if (pinned) return;
      stopTimers();
      openTimer = window.setTimeout(() => open(link, pinHeld), HOVER_DELAY);
    };

    const onPointerOut = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse") return;
      const to = event.relatedTarget;
      const link = linkOf(event.target);
      if (link) {
        if (to instanceof Element && link.contains(to)) return;
        if (pinned && inCard(to)) return;
        if (link !== described) {
          window.clearTimeout(openTimer);
          return;
        }
        hide();
        return;
      }
      if (!pinned || !inCard(event.target) || inCard(to)) return;
      if (described && to instanceof Node && described.contains(to)) return;
      hide();
    };

    const onFocusIn = (event: FocusEvent): void => {
      const link = linkOf(event.target);
      if (link) open(link, false);
    };

    const onFocusOut = (event: FocusEvent): void => {
      if (!linkOf(event.target)) return;
      if (inCard(event.relatedTarget)) return;
      hide();
    };

    const onPointerDown = (event: PointerEvent): void => {
      pointerType = event.pointerType;
    };

    const onClick = (event: MouseEvent): void => {
      // Clicks inside the card belong to it — above all the link to the full
      // rule, which must not be unmounted out from under its own click.
      if (inCard(event.target)) return;
      const link = linkOf(event.target);
      // A hint: the mouse already has it up; a tap opens it, pinned, and a
      // second tap on the same hint puts it away.
      if (link?.dataset.hint) {
        if (event.detail === 0 || pointerType === "mouse") return;
        if (armedHint === link) {
          close();
          return;
        }
        open(link, true);
        armedHint = link;
        return;
      }
      // A control that previews a rule keeps its own click (crossing a
      // condition off), and the card goes with it.
      if (!(link instanceof HTMLAnchorElement)) {
        close();
        return;
      }
      // A mouse already has the card up, so the click goes to the page, and so
      // does a keypress (a click with no pointer behind it, detail 0). On a
      // touch screen the first tap shows the card instead, and a second one on
      // the same term follows the link. A tap also focuses the link, which
      // opens the card a moment earlier — hence the arming rather than simply
      // testing whether the card is already up.
      if (event.detail === 0 || pointerType === "mouse") return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (armed === link.href) {
        armed = "";
        return;
      }
      event.preventDefault();
      armed = link.href;
      open(link, true);
    };

    // The page moving leaves the card hanging off nothing; the card's own
    // scroll is the reason it was pinned.
    const onScroll = (event: Event): void => {
      if (!inCard(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
      if (event.key !== PIN_KEY) return;
      pinHeld = true;
      // Pin only a card the pointer is still with, not one already on its way out.
      if (rulePreview.value && !pinned && described?.matches(":hover")) {
        stopTimers();
        pin(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === PIN_KEY) pinHeld = false;
    };

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerover", onPointerOver, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    document.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
    document.addEventListener("click", onClick);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      stopTimers();
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointerdown", onPointerDown, { capture: true });
      document.removeEventListener("click", onClick);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  if (!anchor) return null;
  return (
    <div
      id="rule-preview"
      ref={card}
      class={pinned ? "rule-preview is-pinned" : "rule-preview"}
      role="tooltip"
      style={{
        left: `${anchor.x}px`,
        top: `${top ?? 0}px`,
        visibility: top === null ? "hidden" : undefined,
      }}
    >
      <div class="rule-preview-card">
        <header class="rule-preview-head">
          <strong>{doc?.name || anchor.label}</strong>
          {doc?.kind ? <span>{doc.kind}</span> : null}
        </header>
        {doc ? (
          <p ref={body} class="rule-preview-body" dangerouslySetInnerHTML={{ __html: doc.html }} />
        ) : (
          <p class="rule-preview-pending">{pending ? "Loading…" : "No preview for this term."}</p>
        )}
        {anchor.url || (overflows && !pinned) ? <div class="rule-preview-foot">
          {/* The full rule, one tap away on a touch screen. Kept out of the tab
              order: it belongs to the term, itself one keystroke from it. */}
          {anchor.url ? (
            <a href={anchor.url} target="_blank" rel="noreferrer" tabIndex={-1}>
              Open on SteelCompendium
              <ExternalIcon />
            </a>
          ) : null}
          {overflows && !pinned ? (
            <span class="rule-preview-hint" aria-hidden="true">
              Press <kbd>Shift</kbd> to scroll
            </span>
          ) : null}
        </div> : null}
      </div>
    </div>
  );
}
