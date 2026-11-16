import type { Loop, Vec2 } from "./physics/index.ts";

/**
 * Shapes of the bodies with a face, other than plain blobs, redrawn from a
 * mockup. Coordinates are mockup pixels (y down).
 * - `size`: half width of the shape. Bodies are scaled so that it matches the
 *   radius of a blob, and the face is sized like a blob of that radius.
 * - `face`: where the face should be centered.
 */
export interface Creature {
  outline: Loop;
  face: Vec2;
  size: number;
}

/** Arc sampling step, in mockup pixels. Long straight edges are subdivided by the body. */
const STEP = 6;

/** Appends an arc from angle `from` to `to` (radians, y down: -π/2 is up). */
function arc(points: Loop, cx: number, cy: number, r: number, from: number, to: number) {
  const n = Math.max(2, Math.ceil((Math.abs(to - from) * r) / STEP));
  for (let k = 0; k <= n; k++) {
    const a = from + ((to - from) * k) / n;
    points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
}

/** Polygon whose corners are replaced by circular arcs of radius r (0 keeps a sharp corner). */
function roundedPolygon(corners: [x: number, y: number, r: number][]) {
  const points: Loop = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const [px, py, r] = corners[i];
    const [ax, ay] = corners[(i + n - 1) % n];
    const [bx, by] = corners[(i + 1) % n];
    const l1 = Math.hypot(ax - px, ay - py);
    const l2 = Math.hypot(bx - px, by - py);
    const d1x = (ax - px) / l1;
    const d1y = (ay - py) / l1;
    const d2x = (bx - px) / l2;
    const d2y = (by - py) / l2;
    const half = Math.acos(Math.max(-1, Math.min(1, d1x * d2x + d1y * d2y))) / 2;
    if (r <= 0 || half < 1e-3) {
      points.push({ x: px, y: py });
      continue;
    }
    // Tangent points on both edges, center on the bisector
    const t = r / Math.tan(half);
    const bl = Math.hypot(d1x + d2x, d1y + d2y);
    const cx = px + ((d1x + d2x) / bl) * (r / Math.sin(half));
    const cy = py + ((d1y + d2y) / bl) * (r / Math.sin(half));
    const from = Math.atan2(py + d1y * t - cy, px + d1x * t - cx);
    let delta = Math.atan2(py + d2y * t - cy, px + d2x * t - cx) - from;
    delta -= Math.round(delta / (Math.PI * 2)) * Math.PI * 2;
    arc(points, cx, cy, r, from, from + delta);
  }
  return points;
}

/** Red: two rounded bars crossed at ±45° (length 148, width 78). */
function cross(): Creature {
  const length = 148;
  const width = 78;
  const notch = width / Math.SQRT2;
  const tip = (length + width) / (2 * Math.SQRT2);
  const side = (length - width) / (2 * Math.SQRT2);
  // Top notch and the top right arm, then rotated by 90° for the other arms
  const quarter: [number, number, number][] = [
    [0, -notch, 8],
    [side, -tip, 20],
    [tip, -side, 20],
  ];
  const corners: [number, number, number][] = [];
  for (let k = 0; k < 4; k++) {
    for (const [x, y, r] of quarter) {
      // Rotate k quarter turns clockwise (y down): (x, y) -> (-y, x)
      let rx = x;
      let ry = y;
      for (let q = 0; q < k; q++) [rx, ry] = [-ry, rx];
      corners.push([rx, ry, r]);
    }
  }
  return { outline: roundedPolygon(corners), face: { x: 0, y: 0 }, size: tip };
}

/** Blue: two tombstones side by side, the left one taller. */
function tombstones(): Creature {
  const points: Loop = [];
  arc(points, 360.5, 125.5, 42.5, Math.PI, Math.PI * 2);
  arc(points, 434, 139, 31, Math.PI, Math.PI * 2);
  arc(points, 457, 220, 8, 0, Math.PI / 2);
  arc(points, 326, 220, 8, Math.PI / 2, Math.PI);
  return { outline: points, face: { x: 387, y: 208 }, size: (465 - 318) / 2 };
}

/** Green: an arch, with a rounded slot open at the bottom. */
function arch(): Creature {
  const points: Loop = [];
  arc(points, 632, 173, 78, Math.PI, Math.PI * 2);
  arc(points, 704, 221, 6, 0, Math.PI / 2);
  arc(points, 652, 221, 6, Math.PI / 2, Math.PI);
  arc(points, 632, 159, 14, 0, -Math.PI);
  arc(points, 612, 221, 6, 0, Math.PI / 2);
  arc(points, 560, 221, 6, Math.PI / 2, Math.PI);
  // Face slightly lower than the mockup (105): the eyes would cross the edge
  return { outline: points, face: { x: 632, y: 116 }, size: 78 };
}

export const CREATURES: Creature[] = [cross(), tombstones(), arch()];
