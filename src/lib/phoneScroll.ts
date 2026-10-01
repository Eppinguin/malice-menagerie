/**
 * On a phone the whole app is one page that scrolls, like any other page on
 * the device: no scroller inside a scroller, so a flick always moves what is
 * under the finger and a flick back up always comes home. The running head
 * (Round, Malice, Next round) steps out of the way while reading down and
 * returns on the first flick up, so it is never more than a gesture away.
 */
export const PHONE = '(max-width: 620px)';

/** Travel in one direction before the head hides or returns, so a finger
    resting on the glass never makes it flicker. A deliberate flick up clears
    the return distance easily; a nudge while reading does not. */
const HIDE_AFTER = 40;
const SHOW_AFTER = 24;

/** How long after the last input (or the last scroll it caused) the page's
    movement still belongs to the Director: long enough to carry a fling's
    momentum from frame to frame, short enough that a layout change a moment
    later is not mistaken for it. */
const DRIVEN_MS = 160;

/** Keys that scroll the page when no field has focus. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

let quietUntil = 0;

/** Keep the head where it is while the app itself moves the page. */
export function holdChrome(ms = 700): void {
  quietUntil = performance.now() + ms;
}

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Height the pinned chrome covers at the top of the page right now. */
export function chromeOffset(): number {
  const root = document.documentElement;
  const read = (name: string) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;
  return root.classList.contains('chrome-hidden') ? 0 : read('--chrome-h');
}

export function installPhoneScroll(): () => void {
  const root = document.documentElement;
  const phone = matchMedia(PHONE);
  let last = window.scrollY;
  let lastHeight = root.scrollHeight;
  let travel = 0;
  let frame = 0;
  // Only the Director moves the head. The page also moves when content above
  // grows or shrinks (scroll anchoring), when a shorter statblock lands, at
  // the rubber band past either end, and when the app scrolls it; none of
  // those may make the head pop up or vanish.
  let drivenUntil = 0;
  let sidewaysUntil = 0;
  const drive = () => {
    drivenUntil = performance.now() + DRIVEN_MS;
  };

  const setHidden = (hidden: boolean) => {
    root.classList.toggle('chrome-hidden', hidden);
    travel = 0;
  };

  const update = () => {
    frame = 0;
    // Clamped to the page, so the rubber band's spring back reads as no move.
    const y = Math.max(0, Math.min(window.scrollY, root.scrollHeight - window.innerHeight));
    const dy = y - last;
    last = y;
    const height = root.scrollHeight;
    const resized = height !== lastHeight;
    lastHeight = height;
    if (!phone.matches) return setHidden(false);
    const head = document.querySelector<HTMLElement>('.topbar');
    // Near the top the head is simply part of the page.
    if (!head || y <= head.offsetHeight) return setHidden(false);
    if (dy === 0) return;
    const now = performance.now();
    // A move the Director did not make, or made while swiping between
    // statblocks, starts the count again instead of adding to it.
    if (now >= drivenUntil || resized || now < quietUntil || now < sidewaysUntil) {
      travel = 0;
      return;
    }
    // Momentum carries on after the finger lifts: each frame it moves keeps
    // the page the Director's for another moment.
    drive();
    // Count travel in one direction; turning around starts the count again.
    travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy;
    if (travel > HIDE_AFTER && !root.classList.contains('chrome-hidden')) {
      // Never pull the controls away from under a focused field.
      if (!head.contains(document.activeElement)) setHidden(true);
    } else if (travel < -SHOW_AFTER) setHidden(false);
  };
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const onKey = (event: KeyboardEvent) => {
    const field = (event.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]');
    if (!field && SCROLL_KEYS.has(event.key)) drive();
  };
  // Scroll events from inner scrollers (the board, filter
  // rows) are sideways swipes; the page's own come from the document.
  const onInnerScroll = (event: Event) => {
    if (event.target !== document) sidewaysUntil = performance.now() + DRIVEN_MS;
  };
  const onFocus = (event: FocusEvent) => {
    if ((event.target as Element | null)?.closest?.('.topbar')) setHidden(false);
  };

  // The pinned head's height feeds scroll padding and the pinned name bands' offset.
  const measure = new ResizeObserver(entries => {
    for (const entry of entries) {
      root.style.setProperty('--chrome-h', `${(entry.target as HTMLElement).offsetHeight}px`);
    }
  });
  const watchHead = () => {
    const head = document.querySelector('.topbar');
    if (head) measure.observe(head);
  };
  watchHead();

  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('scroll', onInnerScroll, { capture: true, passive: true });
  // Only a finger that moves drives the page, never a tap, so a tap that
  // opens or closes something is not read as a scroll.
  window.addEventListener('touchmove', drive, { passive: true });
  window.addEventListener('wheel', drive, { passive: true });
  window.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocus);
  phone.addEventListener('change', onScroll);
  return () => {
    cancelAnimationFrame(frame);
    measure.disconnect();
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('scroll', onInnerScroll, { capture: true });
    window.removeEventListener('touchmove', drive);
    window.removeEventListener('wheel', drive);
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocus);
    phone.removeEventListener('change', onScroll);
    root.classList.remove('chrome-hidden');
  };
}
