import type { Body, CollisionFilter } from "./body.ts";

/** A point of `bodyA` found inside `bodyB`, to be pushed out through edge `edge`. */
export interface Contact {
  bodyA: Body;
  point: number;
  bodyB: Body;
  /** Edge from `edge` to `bodyB.next[edge]`. */
  edge: number;
  /** Position of the closest point along the edge, from 0 to 1. */
  t: number;
  /** Outward normal of the edge. */
  nx: number;
  ny: number;
  /** Penetration depth when detected. */
  depth: number;
  /** Accumulated normal / tangent impulses during the current sub-step. */
  jn: number;
  jt: number;
  /** Normal velocity to reach (restitution). */
  targetVn: number;
}

/** Pool of contacts, reused across steps to avoid allocations. */
export class ContactList {
  readonly items: Contact[] = [];
  count = 0;

  clear() {
    this.count = 0;
  }

  push(bodyA: Body, point: number, bodyB: Body, edge: number, t: number, nx: number, ny: number, depth: number) {
    let c = this.items[this.count];
    if (!c) {
      c = { bodyA, point, bodyB, edge, t, nx, ny, depth, jn: 0, jt: 0, targetVn: 0 };
      this.items.push(c);
    } else {
      c.jn = 0;
      c.jt = 0;
      c.targetVn = 0;
      c.bodyA = bodyA;
      c.point = point;
      c.bodyB = bodyB;
      c.edge = edge;
      c.t = t;
      c.nx = nx;
      c.ny = ny;
      c.depth = depth;
    }
    this.count++;
  }
}

export function canCollide(a: CollisionFilter, b: CollisionFilter) {
  if (a.group === b.group && a.group !== 0) return a.group > 0;
  return (a.mask & b.category) !== 0 && (b.mask & a.category) !== 0;
}

/**
 * Finds the points of A that are inside B (even-odd ray casting, like
 * JellyCar) and, for each of them, the edge of B it should be pushed out
 * through, in order of preference:
 *
 * 1. Entry edge: the edge crossed, from the outside, by the point's motion
 *    relative to B during the last sub-step (`h`). Robust for thin bodies,
 *    where the closest edge may be on the far side.
 * 2. Previous edge: if the point was already touching B at the previous
 *    sub-step (`prevStamp`), the same edge or one of its neighbours (sliding).
 *    Keeps resting and crushed contacts on the right side.
 * 3. Closest edge.
 */
export function detect(
  A: Body,
  B: Body,
  contacts: ContactList,
  threshold: number,
  h: number,
  prevStamp: number,
) {
  const { px: apx, py: apy, vx: avx, vy: avy, warmStamp, warmBody, warmEdge } = A;
  const { px, py, next, prev } = B;
  const edges = B.pointCount;
  const thresholdSq = threshold * threshold;
  const { minX, minY, maxX, maxY } = B;

  for (let i = 0; i < A.pointCount; i++) {
    const x = apx[i];
    const y = apy[i];
    if (x < minX || x > maxX || y < minY || y > maxY) continue;

    let inside = false;
    for (let e = 0; e < edges; e++) {
      const j = next[e];
      const y1 = py[e];
      const y2 = py[j];
      if (y1 > y !== y2 > y && x < px[e] + ((y - y1) * (px[j] - px[e])) / (y2 - y1)) inside = !inside;
    }
    if (!inside) continue;

    // Motion of the point relative to B during the last integration:
    // from (qx, qy) to (x, y)
    const dx = (avx[i] - B.velocityX) * h;
    const dy = (avy[i] - B.velocityY) * h;
    const qx = x - dx;
    const qy = y - dy;

    // Edges touched at the previous sub-step
    const last = warmStamp[i] === prevStamp && warmBody[i] === B.id ? warmEdge[i] : -1;
    const lastNext = last >= 0 ? next[last] : -1;
    const lastPrev = last >= 0 ? prev[last] : -1;

    let entryEdge = -1;
    let entryS = Infinity;
    let entryDist = 0;
    let entryT = 0;
    let lastEdge = -1;
    let lastDist = Infinity;
    let lastT = 0;
    let closestEdge = -1;
    let closestDist = Infinity;
    let closestT = 0;

    for (let e = 0; e < edges; e++) {
      const j = next[e];
      const x1 = px[e];
      const y1 = py[e];
      const ex = px[j] - x1;
      const ey = py[j] - y1;
      const lenSq = ex * ex + ey * ey;
      let t = lenSq > 0 ? ((x - x1) * ex + (y - y1) * ey) / lenSq : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const ox = x - (x1 + ex * t);
      const oy = y - (y1 + ey * t);
      const dist = ox * ox + oy * oy;

      if (dist < closestDist) {
        closestDist = dist;
        closestEdge = e;
        closestT = t;
      }

      if ((e === last || e === lastNext || e === lastPrev) && dist < lastDist) {
        lastDist = dist;
        lastEdge = e;
        lastT = t;
      }

      // Entry: segment q->p crosses the edge while moving against its
      // normal (ey, -ex). `cross` is both d×e and d·n.
      const cross = dx * ey - dy * ex;
      if (cross < 0) {
        const s = ((x1 - qx) * ey - (y1 - qy) * ex) / cross;
        if (s >= 0 && s <= 1 && s < entryS) {
          const u = ((x1 - qx) * dy - (y1 - qy) * dx) / cross;
          if (u >= 0 && u <= 1) {
            entryS = s;
            entryEdge = e;
            entryDist = dist;
            entryT = t;
          }
        }
      }
    }

    let edge: number;
    let t: number;
    let dist: number;
    if (entryEdge >= 0) {
      edge = entryEdge;
      t = entryT;
      dist = entryDist;
    } else if (lastEdge >= 0 && lastDist <= thresholdSq) {
      edge = lastEdge;
      t = lastT;
      dist = lastDist;
    } else if (closestEdge >= 0) {
      edge = closestEdge;
      t = closestT;
      dist = closestDist;
    } else continue;

    const j = next[edge];
    const ex = px[j] - px[edge];
    const ey = py[j] - py[edge];
    const len = Math.sqrt(ex * ex + ey * ey);
    if (len === 0) continue;
    contacts.push(A, i, B, edge, t, ey / len, -ex / len, Math.sqrt(dist));
  }
}

const RESTITUTION_THRESHOLD = 40;

/** Scratch geometry of the contact being solved (avoids allocations). */
const g = {
  /** Contact point of A and its offset from A's center (rigid only). */
  ax: 0,
  ay: 0,
  arx: 0,
  ary: 0,
  /** Contact point on B's edge and its offset from B's center (rigid only). */
  bx: 0,
  by: 0,
  brx: 0,
  bry: 0,
  /** Edge interpolation weights. */
  u: 0,
  t: 0,
  e2: 0,
  /** Relative velocity, output of relativeVelocity(). */
  vx: 0,
  vy: 0,
};

/**
 * Current contact points. Rigid points are recomputed from the frame since
 * previously solved contacts may have moved it.
 */
function computeGeometry(c: Contact) {
  const A = c.bodyA;
  const B = c.bodyB;
  const i = c.point;
  const e1 = c.edge;
  const e2 = B.next[e1];
  const t = c.t;
  const u = 1 - t;
  g.u = u;
  g.t = t;
  g.e2 = e2;

  if (A.isRigid) {
    g.arx = A.cos * A.lx[i] - A.sin * A.ly[i];
    g.ary = A.sin * A.lx[i] + A.cos * A.ly[i];
    g.ax = A.x + g.arx;
    g.ay = A.y + g.ary;
  } else {
    g.arx = 0;
    g.ary = 0;
    g.ax = A.px[i];
    g.ay = A.py[i];
  }

  if (B.isRigid) {
    const lx = B.lx[e1] * u + B.lx[e2] * t;
    const ly = B.ly[e1] * u + B.ly[e2] * t;
    g.brx = B.cos * lx - B.sin * ly;
    g.bry = B.sin * lx + B.cos * ly;
    g.bx = B.x + g.brx;
    g.by = B.y + g.bry;
  } else {
    g.brx = 0;
    g.bry = 0;
    g.bx = B.px[e1] * u + B.px[e2] * t;
    g.by = B.py[e1] * u + B.py[e2] * t;
  }
}

/**
 * Inverse mass of the contact along direction (dx, dy). Each side is either a
 * soft point, a soft edge (the point on the edge moves like a lever between
 * both ends), a rigid body (effective mass at the contact point) or a static
 * body (0).
 */
function invMassA(c: Contact, dx: number, dy: number) {
  const A = c.bodyA;
  if (!A.isRigid) return A.pointInvMass[c.point];
  const cross = g.arx * dy - g.ary * dx;
  return A.inverseMass + cross * cross * A.inverseInertia;
}

function invMassB(c: Contact, dx: number, dy: number) {
  const B = c.bodyB;
  if (!B.isRigid) return g.u * g.u * B.pointInvMass[c.edge] + g.t * g.t * B.pointInvMass[g.e2];
  const cross = g.brx * dy - g.bry * dx;
  return B.inverseMass + cross * cross * B.inverseInertia;
}

/** Relative velocity of A with respect to B at the contact. */
function relativeVelocity(c: Contact) {
  const A = c.bodyA;
  const B = c.bodyB;
  let vx: number;
  let vy: number;
  if (A.isRigid) {
    vx = A.velocityX - A.angularVelocity * g.ary;
    vy = A.velocityY + A.angularVelocity * g.arx;
  } else {
    vx = A.vx[c.point];
    vy = A.vy[c.point];
  }
  if (B.isRigid) {
    vx -= B.velocityX - B.angularVelocity * g.bry;
    vy -= B.velocityY + B.angularVelocity * g.brx;
  } else {
    vx -= B.vx[c.edge] * g.u + B.vx[g.e2] * g.t;
    vy -= B.vy[c.edge] * g.u + B.vy[g.e2] * g.t;
  }
  g.vx = vx;
  g.vy = vy;
}

/** Applies impulse (jx, jy) to A and its opposite to B. */
function applyImpulse(c: Contact, jx: number, jy: number) {
  const A = c.bodyA;
  const B = c.bodyB;
  if (A.isRigid) {
    A.velocityX += jx * A.inverseMass;
    A.velocityY += jy * A.inverseMass;
    A.angularVelocity += (g.arx * jy - g.ary * jx) * A.inverseInertia;
  } else {
    const w = A.pointInvMass[c.point];
    A.vx[c.point] += jx * w;
    A.vy[c.point] += jy * w;
  }
  if (B.isRigid) {
    B.velocityX -= jx * B.inverseMass;
    B.velocityY -= jy * B.inverseMass;
    B.angularVelocity -= (g.brx * jy - g.bry * jx) * B.inverseInertia;
  } else {
    const w1 = B.pointInvMass[c.edge] * g.u;
    const w2 = B.pointInvMass[g.e2] * g.t;
    B.vx[c.edge] -= jx * w1;
    B.vy[c.edge] -= jy * w1;
    B.vx[g.e2] -= jx * w2;
    B.vy[g.e2] -= jy * w2;
  }
}

/**
 * Pushes the point of A out of B. The depth is measured on current positions,
 * so several contacts on the same body don't over-correct it.
 */
export function solvePosition(c: Contact, slop: number) {
  computeGeometry(c);
  const nx = c.nx;
  const ny = c.ny;
  const depth = (g.bx - g.ax) * nx + (g.by - g.ay) * ny - slop;
  if (depth <= 0) return;
  const wSum = invMassA(c, nx, ny) + invMassB(c, nx, ny);
  if (wSum <= 0) return;

  const l = depth / wSum;
  const dx = nx * l;
  const dy = ny * l;
  const A = c.bodyA;
  const B = c.bodyB;
  if (A.isRigid) {
    A.x += dx * A.inverseMass;
    A.y += dy * A.inverseMass;
    A.angle += (g.arx * dy - g.ary * dx) * A.inverseInertia;
    A.cos = Math.cos(A.angle);
    A.sin = Math.sin(A.angle);
  } else {
    const w = A.pointInvMass[c.point];
    A.px[c.point] += dx * w;
    A.py[c.point] += dy * w;
  }
  if (B.isRigid) {
    B.x -= dx * B.inverseMass;
    B.y -= dy * B.inverseMass;
    B.angle -= (g.brx * dy - g.bry * dx) * B.inverseInertia;
    B.cos = Math.cos(B.angle);
    B.sin = Math.sin(B.angle);
  } else {
    const w1 = B.pointInvMass[c.edge] * g.u;
    const w2 = B.pointInvMass[g.e2] * g.t;
    B.px[c.edge] -= dx * w1;
    B.py[c.edge] -= dy * w1;
    B.px[g.e2] -= dx * w2;
    B.py[g.e2] -= dy * w2;
  }
}

/**
 * Computes the restitution target, then warm starts the contact: if the same
 * point touched the same edge during the previous sub-step (`stamp - 1`), its
 * impulses are applied right away. The solver then only has to correct them,
 * which makes resting contacts and stacks converge much better.
 */
export function prepareVelocity(c: Contact, stamp: number) {
  computeGeometry(c);
  const A = c.bodyA;
  const B = c.bodyB;
  const i = c.point;
  relativeVelocity(c);
  const vn = g.vx * c.nx + g.vy * c.ny;
  const restitution = Math.max(A.restitution, B.restitution);
  c.targetVn = vn < -RESTITUTION_THRESHOLD ? -restitution * vn : 0;

  if (A.warmStamp[i] === stamp - 1 && A.warmBody[i] === B.id && A.warmEdge[i] === c.edge) {
    c.jn = A.warmJn[i];
    c.jt = A.warmJt[i];
    applyImpulse(c, c.nx * c.jn - c.ny * c.jt, c.ny * c.jn + c.nx * c.jt);
  }
}

/** Saves the impulses of the contact for warm starting the next sub-step. */
export function storeImpulses(c: Contact, stamp: number) {
  const A = c.bodyA;
  const i = c.point;
  A.warmStamp[i] = stamp;
  A.warmBody[i] = c.bodyB.id;
  A.warmEdge[i] = c.edge;
  A.warmJn[i] = c.jn;
  A.warmJt[i] = c.jt;
}

/**
 * Normal impulse (with restitution) and Coulomb friction. Impulses are
 * accumulated and clamped over the iterations (sequential impulses), which
 * lets later iterations take back an excessive impulse.
 */
export function solveVelocity(c: Contact) {
  computeGeometry(c);
  const A = c.bodyA;
  const B = c.bodyB;
  const nx = c.nx;
  const ny = c.ny;

  // Normal
  const wn = invMassA(c, nx, ny) + invMassB(c, nx, ny);
  if (wn <= 0) return;
  relativeVelocity(c);
  const vn = g.vx * nx + g.vy * ny;
  const jn = Math.max(c.jn + (c.targetVn - vn) / wn, 0);
  const djn = jn - c.jn;
  c.jn = jn;
  if (djn !== 0) applyImpulse(c, nx * djn, ny * djn);

  // Friction, along the edge tangent
  if (jn === 0 && c.jt === 0) return;
  const tx = -ny;
  const ty = nx;
  const wt = invMassA(c, tx, ty) + invMassB(c, tx, ty);
  relativeVelocity(c);
  const vt = g.vx * tx + g.vy * ty;
  const maxFriction = Math.sqrt(A.friction * B.friction) * jn;
  const jt = Math.max(-maxFriction, Math.min(maxFriction, c.jt - vt / wt));
  const djt = jt - c.jt;
  c.jt = jt;
  if (djt !== 0) applyImpulse(c, tx * djt, ty * djt);
}
