export interface Vec2 {
  x: number;
  y: number;
}

/** A closed contour. The last point is implicitly connected to the first one. */
export type Loop = Vec2[];

/**
 * A shape is a list of closed loops, interpreted with the even-odd rule:
 * - a single loop is a simple polygon
 * - a loop inside another one is a hole (e.g. the letter "O")
 * - disjoint loops form a compound shape (e.g. the letter "i")
 *
 * Loops must not intersect each other. Orientation does not matter, it is
 * normalized when a body is created.
 */
export type Shape = Loop[];

const TAU = Math.PI * 2;

/** Number of segments giving edges of roughly `segmentLength` on a circle. */
export function autoSegments(radius: number, segmentLength = 12) {
  return Math.max(8, Math.min(64, Math.round((TAU * radius) / segmentLength)));
}

function ellipseLoop(rx: number, ry: number, segments: number, offset = 0) {
  const loop: Loop = [];
  for (let i = 0; i < segments; i++) {
    const a = offset + (i / segments) * TAU;
    loop.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
  }
  return loop;
}

/** Shapes are centered on (0, 0). Use `translate` to offset them. */
export const Shapes = {
  rectangle(width: number, height: number): Shape {
    const w = width / 2;
    const h = height / 2;
    return [
      [
        { x: -w, y: -h },
        { x: w, y: -h },
        { x: w, y: h },
        { x: -w, y: h },
      ],
    ];
  },

  circle(radius: number, segments = autoSegments(radius)): Shape {
    return [ellipseLoop(radius, radius, segments)];
  },

  ellipse(rx: number, ry: number, segments = autoSegments(Math.max(rx, ry))): Shape {
    return [ellipseLoop(rx, ry, segments)];
  },

  /** Regular polygon, same orientation as Matter.Bodies.polygon. */
  polygon(sides: number, radius: number): Shape {
    const n = Math.max(3, Math.floor(sides));
    return [ellipseLoop(radius, radius, n, Math.PI / n)];
  },

  star(branches: number, outerRadius: number, innerRadius: number): Shape {
    const loop: Loop = [];
    const n = Math.max(2, Math.floor(branches)) * 2;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * TAU;
      const r = i % 2 === 0 ? outerRadius : innerRadius;
      loop.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return [loop];
  },

  /** Donut: an outer circle with a circular hole. */
  ring(outerRadius: number, innerRadius: number, segments = autoSegments(outerRadius)): Shape {
    const inner = Math.max(6, Math.round((segments * innerRadius) / outerRadius));
    return [ellipseLoop(outerRadius, outerRadius, segments), ellipseLoop(innerRadius, innerRadius, inner)];
  },

  /** Accepts a single contour or a list of contours. Points are copied. */
  fromVertices(vertices: Vec2[] | Vec2[][]): Shape {
    const loops = (Array.isArray(vertices[0]) ? vertices : [vertices]) as Vec2[][];
    return loops.map((loop) => loop.map((p) => ({ x: p.x, y: p.y })));
  },

  /** Merges several shapes into a compound one. Parts must not overlap. */
  combine(...shapes: Shape[]): Shape {
    return shapes.flatMap((shape) => shape.map((loop) => loop.map((p) => ({ x: p.x, y: p.y }))));
  },

  translate(shape: Shape, dx: number, dy: number): Shape {
    return shape.map((loop) => loop.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  },

  rotate(shape: Shape, angle: number): Shape {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return shape.map((loop) => loop.map((p) => ({ x: c * p.x - s * p.y, y: s * p.x + c * p.y })));
  },

  scale(shape: Shape, sx: number, sy = sx): Shape {
    return shape.map((loop) => loop.map((p) => ({ x: p.x * sx, y: p.y * sy })));
  },

  /** Inserts points so that no edge is longer than `maxEdgeLength`. */
  subdivide(shape: Shape, maxEdgeLength: number): Shape {
    if (!(maxEdgeLength > 0)) return Shapes.combine(shape);
    return shape.map((loop) => {
      const out: Loop = [];
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const cuts = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxEdgeLength));
        for (let k = 0; k < cuts; k++) {
          const t = k / cuts;
          out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      }
      return out;
    });
  },
};

/** Shoelace formula. Positive when the loop runs so that (dy, -dx) is its outward normal. */
export function signedArea(loop: Loop) {
  let area = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    area += loop[j].x * loop[i].y - loop[i].x * loop[j].y;
  }
  return area / 2;
}

export function loopContains(loop: Loop, x: number, y: number) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[j];
    const b = loop[i];
    if (a.y > y !== b.y > y && x < a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Copies the shape, drops degenerate loops/duplicate points, and orients
 * loops so that solid outlines are positive and holes negative. Edge normals
 * (dy, -dx) then always point out of the material.
 */
export function normalizeShape(shape: Shape): Shape {
  const loops: Shape = [];
  for (const src of shape) {
    const loop: Loop = [];
    for (const p of src) {
      const last = loop[loop.length - 1];
      if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) {
        loop.push({ x: p.x, y: p.y });
      }
    }
    while (loop.length > 1) {
      const first = loop[0];
      const last = loop[loop.length - 1];
      if (Math.abs(last.x - first.x) > 1e-9 || Math.abs(last.y - first.y) > 1e-9) break;
      loop.pop();
    }
    if (loop.length >= 3 && Math.abs(signedArea(loop)) > 1e-9) loops.push(loop);
  }

  for (let k = 0; k < loops.length; k++) {
    const probe = loops[k][0];
    let depth = 0;
    for (let o = 0; o < loops.length; o++) {
      if (o !== k && loopContains(loops[o], probe.x, probe.y)) depth++;
    }
    const isHole = depth % 2 === 1;
    const area = signedArea(loops[k]);
    if (area > 0 === isHole) loops[k].reverse();
  }
  return loops;
}
