import { signal } from '@preact/signals';

/** Day page (printed book) or night page (dark stock for dim rooms). */
export type PageTheme = 'day' | 'night';

const KEY = 'malice-menagerie:page';

function initialTheme(): PageTheme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'day' || saved === 'night') return saved;
  } catch {
    /* storage unavailable: fall through to the system preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
}

export const pageTheme = signal<PageTheme>(initialTheme());

function apply(theme: PageTheme): void {
  document.documentElement.dataset.theme = theme;
  // Browser chrome takes the page stock, read from the role token once the
  // stylesheet has applied.
  requestAnimationFrame(() => {
    const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
    if (page) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', page);
  });
}

apply(pageTheme.value);

export function togglePageTheme(): void {
  const next: PageTheme = pageTheme.value === 'night' ? 'day' : 'night';
  pageTheme.value = next;
  apply(next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* non-persistent is fine */
  }
}
