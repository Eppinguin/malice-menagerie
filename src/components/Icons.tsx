import type { ComponentChildren } from 'preact';

/** One stroke family for every glyph in the app: 24px grid, 2px round stroke. */
type IconProps = { class?: string };

function Glyph({ class: cls, children }: IconProps & { children: ComponentChildren }) {
  return (
    <svg
      class={cls ? `icon ${cls}` : 'icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const PrepIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Glyph>
);

/** Run: two crossed blades. */
export const RunIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
    <path d="m13 19 6-6M16 16l4 4M19 21l2-2" />
    <path d="M14.5 6.5 18 3h3v3l-3.5 3.5" />
    <path d="m5 14 4 4M7 17l-3 3M3 19l2 2" />
  </Glyph>
);

export const CollapseIcon = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="3" y="4" width="18" height="16" rx="1" />
    <path d="M9 4v16" />
  </Glyph>
);

export const MenuIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Glyph>
);

export const CloseIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Glyph>
);

export const PlusIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 5v14M5 12h14" />
  </Glyph>
);

export const MinusIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M5 12h14" />
  </Glyph>
);

/** Undo: an arrow curling back, for stepping to the previous round. */
export const UndoIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Glyph>
);

/** A box struck off in pen: a spent turn. */
export const StrikeIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M5 5.5 19 18.5" />
    <path d="M18.5 5 5.5 19" />
  </Glyph>
);

export const ExternalIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Glyph>
);

export const SearchIcon = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </Glyph>
);

export const GripIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3" />
  </Glyph>
);

export const CaretIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="m6 9 6 6 6-6" />
  </Glyph>
);

export const EyeIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </Glyph>
);

export const PencilIcon = PrepIcon;

export const CopyIcon = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="9" y="9" width="12" height="12" rx="1" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </Glyph>
);

/** Night page: a crescent. */
export const MoonIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </Glyph>
);

/** Day page: a sun. */
export const SunIcon = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Glyph>
);

/** A captain's rank: two stacked chevrons. */
export const CaptainIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="m6 11 6-5 6 5" />
    <path d="m6 18 6-5 6 5" />
  </Glyph>
);
