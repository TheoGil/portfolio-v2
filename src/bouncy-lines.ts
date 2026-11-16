import { gsap } from "gsap";

/**
 * Elastic horizontal lines: the pointer "pinches" a line when it crosses it,
 * drags a bump along, and the line snaps back with a few damped bounces.
 *
 * Each line is a single damped spring (the bump amplitude), rendered as an SVG
 * path with a normalized viewBox (x in [0, 100], y in px, see index.html).
 */

/** Distance (px) at which a grabbed line lets go of the pointer. */
const MAX_PULL = 32;
/** Half width of the bump, in % of the line width. */
const HALF_WIDTH = 40;
/** Keeps the bump away from the pinned ends, in % of the line width. */
const EDGE = 25;
/** Initial velocity (px/s) when the pointer crosses a line too fast to grab it. */
const PLUCK_VELOCITY = 350;
/** Lines passing under a still pointer while scrolling get pinched too. */
const PINCH_ON_SCROLL = true;

/** Spring while grabbed: critically damped, so the bump follows without bouncing. */
const GRAB_STIFFNESS = 5000;
const GRAB_DAMPING = 2 * Math.sqrt(GRAB_STIFFNESS);
/** Spring once released: ~3.5 Hz, a few bounces. */
const STIFFNESS = 2000;
const DAMPING = 7;
const SUBSTEPS = 2;
const MAX_DELTA = 1 / 30;

const REST_PATH = "M0 1 H100";

interface Line {
  svg: SVGSVGElement;
  path: SVGPathElement;
  /** Bump position, in % of the line width. */
  cx: number;
  /** Bump height in px (positive is down). */
  amp: number;
  vel: number;
  target: number;
  grabbed: boolean;
  /** Pointer to line signed distance at the previous update. */
  prevDy: number | null;
}

const lines: Line[] = [];
const active = new Set<Line>();
let ticking = false;
let pointerX: number | null = null;
let pointerY: number | null = null;

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

function draw(line: Line) {
  const { cx } = line;
  const wl = Math.min(HALF_WIDTH, cx);
  const wr = Math.min(HALF_WIDTH, 100 - cx);
  const y = (1 + line.amp).toFixed(2);
  const f = (n: number) => n.toFixed(2);

  line.path.setAttribute(
    "d",
    `M0 1 L${f(cx - wl)} 1 ` +
      `C${f(cx - wl / 2)} 1 ${f(cx - wl / 2)} ${y} ${f(cx)} ${y} ` +
      `C${f(cx + wr / 2)} ${y} ${f(cx + wr / 2)} 1 ${f(cx + wr)} 1 L100 1`,
  );
}

function tick(_time: number, deltaTime: number) {
  const h = Math.min(deltaTime / 1000, MAX_DELTA) / SUBSTEPS;

  for (const line of active) {
    const k = line.grabbed ? GRAB_STIFFNESS : STIFFNESS;
    const c = line.grabbed ? GRAB_DAMPING : DAMPING;

    for (let s = 0; s < SUBSTEPS; s++) {
      line.vel += (k * (line.target - line.amp) - c * line.vel) * h;
      line.amp += line.vel * h;
    }

    if (!line.grabbed && Math.abs(line.amp) < 0.1 && Math.abs(line.vel) < 1) {
      line.amp = 0;
      line.vel = 0;
      line.path.setAttribute("d", REST_PATH);
      active.delete(line);
    } else {
      draw(line);
    }
  }

  if (active.size === 0) {
    gsap.ticker.remove(tick);
    ticking = false;
  }
}

function wake(line: Line) {
  active.add(line);

  if (!ticking) {
    gsap.ticker.add(tick);
    ticking = true;
  }
}

function release(line: Line) {
  line.grabbed = false;
  line.target = 0;
}

function update(x: number, y: number) {
  for (const line of lines) {
    const rect = line.svg.getBoundingClientRect();

    // Hidden line (e.g. bottom line of an item that is not the last one)
    if (rect.width === 0) continue;

    const dy = y - (rect.top + rect.height / 2);
    const inside = x >= rect.left && x <= rect.right;
    const prevDy = line.prevDy;
    line.prevDy = dy;

    if (!line.grabbed) {
      const crossed = prevDy !== null && prevDy < 0 !== dy < 0;

      if (!inside || !crossed) continue;

      line.cx = clamp(((x - rect.left) / rect.width) * 100, EDGE, 100 - EDGE);

      if (Math.abs(dy) > MAX_PULL) {
        // Crossed too fast to be grabbed: pluck it
        line.vel += Math.sign(dy) * PLUCK_VELOCITY;
      } else {
        line.grabbed = true;
      }

      wake(line);
    }

    if (!line.grabbed) continue;

    if (!inside || Math.abs(dy) > MAX_PULL) {
      release(line);
      continue;
    }

    line.cx = clamp(((x - rect.left) / rect.width) * 100, EDGE, 100 - EDGE);
    line.target = dy;
  }
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerType === "touch") return;

  pointerX = e.clientX;
  pointerY = e.clientY;
  update(pointerX, pointerY);
}

function onScroll() {
  if (pointerX === null || pointerY === null) return;

  if (PINCH_ON_SCROLL) {
    update(pointerX, pointerY);
  } else {
    lines.forEach(release);
  }
}

function onPointerLeave() {
  pointerX = pointerY = null;
  lines.forEach((line) => {
    release(line);
    line.prevDy = null;
  });
}

export const BOUNCY_LINES = {
  enable() {
    const canHover = window.matchMedia(
      "(hover: hover) and (prefers-reduced-motion: no-preference)",
    ).matches;

    if (!canHover) return;

    document.querySelectorAll<SVGSVGElement>(".bouncy-line").forEach((svg) => {
      const path = svg.querySelector("path");

      if (!path) return;

      lines.push({
        svg,
        path,
        cx: 50,
        amp: 0,
        vel: 0,
        target: 0,
        grabbed: false,
        prevDy: null,
      });
    });

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
  },
  disable() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("scroll", onScroll);
    document.documentElement.removeEventListener(
      "pointerleave",
      onPointerLeave,
    );
    gsap.ticker.remove(tick);
    ticking = false;
    active.clear();
    lines.forEach((line) => line.path.setAttribute("d", REST_PATH));
    lines.length = 0;
    pointerX = pointerY = null;
  },
};
