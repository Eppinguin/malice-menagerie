import { useLayoutEffect, useRef, useState } from "preact/hooks";

/**
 * The Director's pen. The book is printed; everything that changes during
 * play is marked on top of it by hand: circled, ticked, struck, crossed.
 * Each mark measures the box it lands on and draws its strokes in real
 * pixels, so a loop around a long row keeps round ends and a strike keeps
 * its weight. The wobble is seeded, so a mark keeps its shape across
 * re-renders and only a new mark (a new seed) looks different.
 */

type Rand = (min: number, max: number) => number;

/** A small seeded generator (mulberry32 over an FNV-1a hash of the seed). */
function penRandom(seed: string | number): Rand {
  let a = 2166136261;
  for (const char of String(seed)) {
    a ^= char.charCodeAt(0);
    a = Math.imul(a, 16777619);
  }
  return (min, max) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return min + (max - min) * (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

const pt = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/** Strokes for a mark, in the pixel space of the box it covers. */
type Draw = (w: number, h: number, r: Rand) => string[];

function PenMark({
  seed,
  draw,
  class: className,
  stagger = 0,
}: {
  seed: string | number;
  draw: Draw;
  class: string;
  /** Seconds between strokes, for marks drawn in more than one stroke. */
  stagger?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    // The layout box, not getBoundingClientRect: a mark may be turned a
    // fraction of a degree, and the rotated bounds of a wide row are several
    // pixels taller than the row, which would shrink the whole drawing.
    const measure = () => {
      const next: [number, number] = [Math.round(svg.clientWidth), Math.round(svg.clientHeight)];
      setSize((prev) => (prev && prev[0] === next[0] && prev[1] === next[1] ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const strokes = size && size[0] > 0 ? draw(size[0], size[1], penRandom(seed)) : [];
  return (
    <svg
      ref={ref}
      class={`pen-mark ${className}`}
      viewBox={size ? `0 0 ${size[0]} ${size[1]}` : undefined}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {strokes.map((d, index) => (
        <path
          key={index}
          pathLength={1}
          d={d}
          style={stagger ? { animationDelay: `calc(var(--pen-delay, 0s) + ${index * stagger}s)` } : undefined}
        />
      ))}
    </svg>
  );
}

/** A loose egg around a box: the right end a little tighter, long sides that
    bow, and a tail that crosses its own start at the top left. With two
    laps, the second swings wide of the first so they visibly cross, the way
    a pen circles the line that matters. */
function loopStroke(w: number, h: number, r: Rand, laps: 1 | 2): string {
  const rl = Math.min(h / 2, 20);
  const rr = rl * 0.8;
  const j = () => r(-1.2, 1.2);
  // A short ring starts on its top edge, so the pen's landing never reads
  // as a dash in front of the words it circles.
  const startY = laps === 1 ? Math.min(5, h * 0.08) : 5;
  const path = [
    `M${pt(rl * 1.1, startY + j())}`,
    `C${pt(w * 0.3, 0.5 + j())} ${pt(w * 0.72, j())} ${pt(w - rr, 2.5 + j())}`,
    `C${pt(w + 0.5 + j(), 4)} ${pt(w + j(), h - 3.5)} ${pt(w - rr * 1.2, h - 1 + j())}`,
    `C${pt(w * 0.62, h + 1 + j())} ${pt(w * 0.28, h + j())} ${pt(rl, h - 1.5 + j())}`,
    `C${pt(-2 + j(), h - 3)} ${pt(-1.5 + j(), 4.5)} ${pt(rl * 0.9, 2 + j())}`,
  ];
  if (laps === 1) {
    path.push(`C${pt(rl * 1.7, 0.3)} ${pt(rl * 2.6, -0.5 + j())} ${pt(rl * 3.4, 1 + j())}`);
    return path.join(" ");
  }
  // How far the second lap drifts from the first, so the two cross visibly.
  const d = Math.max(4.5, h * 0.2);
  const top = Math.min(d, 6);
  path.push(
    `C${pt(w * 0.32, -1 + j())} ${pt(w * 0.68, top + j())} ${pt(w - rr * 0.6, top + 0.5)}`,
    `C${pt(w + 3.5 + j(), top + 1)} ${pt(w + 1.5 + j(), h + 1)} ${pt(w - rr * 1.4, h + 2 + j())}`,
    `C${pt(w * 0.64, h + 3.5 + j())} ${pt(w * 0.3, h - d * 0.7)} ${pt(rl * 1.4, h - d * 0.8)}`,
    `C${pt(-5 + j(), h - d)} ${pt(-3.5 + j(), 0)} ${pt(rl * 1.4, -2)}`,
    `C${pt(rl * 2.1, -2.9)} ${pt(rl * 2.9, -3.3 + j())} ${pt(rl * 3.6, -3.4 + j())}`,
  );
  return path.join(" ");
}

/** The rolled tier, circled twice. */
export function PenLoop({ seed }: { seed: string | number }) {
  return <PenMark seed={seed} class="pen-loop" draw={(w, h, r) => [loopStroke(w, h, r, 2)]} />;
}

/** A single quick ring around a short note: a condition, a finished tally. */
export function PenRing({ seed }: { seed: string | number }) {
  return <PenMark seed={seed} class="pen-ring" draw={(w, h, r) => [loopStroke(w, h, r, 1)]} />;
}

/** A line struck through a box, rising a touch left to right. */
export function PenStrike({ seed }: { seed: string | number }) {
  return (
    <PenMark
      seed={seed}
      class="pen-strike"
      draw={(w, h, r) => {
        const y = h / 2;
        return [
          `M${pt(-2, y + r(0.5, 2))} C${pt(w * 0.3, y + r(-1, 1))} ${pt(w * 0.66, y + r(-1.5, 0.5))} ${pt(w + 2, y - r(0.5, 2.5))}`,
        ];
      }}
    />
  );
}

/** The answer, ruled off twice. */
export function PenDoubleRule({ seed }: { seed: string | number }) {
  return (
    <PenMark
      seed={seed}
      class="pen-double-rule"
      stagger={0.07}
      draw={(w, h, r) => [
        `M${pt(1, 1.5 + r(0, 1))} C${pt(w * 0.28, r(0, 1))} ${pt(w * 0.65, 1 + r(0, 1))} ${pt(w - 1, r(0, 1))}`,
        `M${pt(3, h - 1 + r(-0.6, 0.6))} C${pt(w * 0.36, h - 2 + r(0, 1))} ${pt(w * 0.68, h - 1)} ${pt(w - 2.5, h - 2.5 + r(-0.5, 0.5))}`,
      ]}
    />
  );
}

/** A d10 sketched beside a sum, the way a d10 is always drawn: a tall kite
    face from the top point down past the die's widest line, short edges
    from its side corners out to the silhouette, one more from its foot to
    the bottom point, and the rolled number written in the kite. The
    silhouette goes down in one stroke and runs a touch past its start; the
    kite follows at once. Each die is its own sketch (seeded), so two dice
    never match. */
type Pt = [number, number];
export function PenD10({ seed, value }: { seed: string | number; value: number }) {
  const r = penRandom(seed);
  const j = (): number => r(-0.5, 0.5);
  const at = (x: number, y: number): Pt => [x + j(), y + j()];
  const top = at(16, 1.4);
  const west = at(1.4, 19.5);
  const southWest = at(4.6, 26);
  const foot = at(16, 32.6);
  const southEast = at(27.4, 26);
  const east = at(30.6, 19.5);
  const kiteWest = at(6.2, 21.8);
  const kiteFoot = at(16, 27.8);
  const kiteEast = at(25.8, 21.8);
  const p = ([x, y]: Pt) => pt(x, y);
  const outline = [top, west, southWest, foot, southEast, east, top].map((point, i) => `${i ? "L" : "M"}${p(point)}`);
  // The pen runs on past where it started, a little way down the west edge.
  outline.push(`L${pt(top[0] - 2.4, top[1] + 3.2)}`);
  const kite = `M${p(top)} L${p(kiteWest)} L${p(kiteFoot)} L${p(kiteEast)} Z`;
  const edges = `M${p(west)} L${p(kiteWest)} M${p(east)} L${p(kiteEast)} M${p(kiteFoot)} L${p(foot)}`;
  return (
    <span class="d10">
      <svg viewBox="0 0 32 34" aria-hidden="true">
        <path class="d10-outline" pathLength={1} d={outline.join(" ")} />
        <path class="d10-kite" pathLength={1} d={kite} />
        <path class="d10-edge" d={edges} />
      </svg>
      <b class={value >= 10 ? "d10-wide" : undefined}>{value}</b>
    </span>
  );
}

/** A tick that starts inside its box and flicks out past the top right. */
export function PenTick({ seed }: { seed: string | number }) {
  return (
    <PenMark
      seed={seed}
      class="pen-tick"
      draw={(w, h, r) => [
        `M${pt(w * 0.16, h * 0.52 + r(-1, 1))} C${pt(w * 0.28, h * 0.6)} ${pt(w * 0.36, h * 0.72)} ${pt(w * 0.42, h * 0.84 + r(-0.5, 0.8))} C${pt(w * 0.56, h * 0.5)} ${pt(w * 0.78, h * 0.18)} ${pt(w * 1.08 + r(0, 2), -h * 0.08 + r(-1, 1))}`,
      ]}
    />
  );
}

/** Down: two loose strokes crossing the whole slip, first ↘ then ↙. */
export function PenCross({ seed }: { seed: string | number }) {
  return (
    <PenMark
      seed={seed}
      class="pen-cross"
      stagger={0.16}
      draw={(w, h, r) => [
        `M${pt(r(2, 8), r(2, 7))} C${pt(w * 0.3, h * 0.28 + r(-3, 3))} ${pt(w * 0.66, h * 0.7 + r(-3, 3))} ${pt(w - r(2, 6), h - r(1, 5))}`,
        `M${pt(w - r(3, 9), r(1, 6))} C${pt(w * 0.68, h * 0.32 + r(-3, 3))} ${pt(w * 0.34, h * 0.66 + r(-3, 3))} ${pt(r(1, 6), h - r(2, 7))}`,
      ]}
    />
  );
}
